import path from 'path'
import {apiClient} from './services/api.service.js'
import {commitAll, createWorktree, ensureClone, pruneWorktrees, pushBranch, removeWorktree} from './services/git.service.js'
import {buildPrompt, parseEstimatedMinutes, runClaude} from './services/agent.service.js'
import {ensureMergeRequest, getMergeRequest, mergeMergeRequest} from './services/gitlab.service.js'
import {pollProjectJobs} from './services/project-sync.service.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000)
const WORKER_CONCURRENCY = Math.max(1, Number.parseInt(process.env.WORKER_CONCURRENCY ?? '4', 10) || 1)
const JOB_HEARTBEAT_MS = Math.max(5000, Number.parseInt(process.env.JOB_HEARTBEAT_MS ?? '30000', 10) || 30000)
const WORKSPACE = process.env.WORKSPACE ?? ''

const api = apiClient()

console.log(`worker started (concurrency: ${WORKER_CONCURRENCY}, max per project: 1)`)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function pruneAll() {
    const projects = await api.listProjects()
    for (const p of projects) {
        try {
            const repoPath = await ensureClone(p, WORKSPACE)
            await pruneWorktrees(repoPath)
        } catch (err) {
            console.error(`prune failed for project ${p._id}:`, err.message)
        }
    }
}

await pruneAll()

async function reconcileMerges(projects) {
    const projectById = new Map(projects.map((project) => [String(project._id), project]))
    const jobs = await api.listAwaitingMergeJobs()

    for (const job of jobs) {
        const project = projectById.get(String(job.project_id))
        if (!project || !job.gitlab?.branch) continue

        const targetBranch = project.gitlab?.default_branch?.trim() || 'main'
        try {
            let mergeRequest = job.gitlab.mr_iid
                ? await getMergeRequest(project, job.gitlab.mr_iid)
                : await ensureMergeRequest({
                    project,
                    sourceBranch: job.gitlab.branch,
                    targetBranch,
                    title: job.title ?? job.clickup?.title ?? job.gitlab_issue?.title ?? `Job ${job._id}`,
                    expectedCommitSha: job.gitlab.commit_sha
                })

            if (job.merge_requested_at && mergeRequest.mr_iid && mergeRequest.mr_state === 'opened') {
                mergeRequest = await mergeMergeRequest(project, mergeRequest.mr_iid)
                console.log(`job ${job._id}: merge eseguito su richiesta manuale`)
            }

            const gitlab = {...job.gitlab, ...mergeRequest}
            if (mergeRequest.mr_state === 'merged'
                && (!mergeRequest.head_sha || mergeRequest.head_sha === job.gitlab.commit_sha)) {
                await api.markJobMerged(job._id, {gitlab})
                console.log(`job ${job._id}: merge rilevato, slot progetto rilasciato`)
            } else if (!job.gitlab.mr_iid && mergeRequest.mr_iid) {
                await api.updateJob(job._id, {gitlab})
            }
        } catch (err) {
            console.error(`merge check failed for job ${job._id}:`, err.message)
        }
    }
}

async function processNextJob(executorId) {
    const claimed = await api.claimJob()

    if (!claimed) return false

    const {job, project} = claimed

    console.log(`executor ${executorId}: processing job`, job._id, job.clickup?.task_id ?? 'manual')

    const logs = []
    const log = msg => {
        logs.push(`[${new Date().toISOString()}] ${msg}`)
        console.log(`job ${job._id}: ${msg}`)
    }

    const startedAt = new Date()

    if (!project) {
        log('project non trovato')
        await api.failJob(job._id, {
            execution: {
                outcome: 'failed',
                started_at: startedAt,
                completed_at: new Date(),
                duration_ms: 0,
                logs,
                error: 'project not found'
            }
        })
        return true
    }

    const taskId = job.clickup?.task_id ?? (job.gitlab_issue?.iid ? `gl-${job.gitlab_issue.iid}` : job._id)
    const baseBranch = project.gitlab?.default_branch?.trim() || 'main'
    // Progetti con gitlab.direct_branch=true lavorano direttamente sul branch di
    // default: nessun feature branch, nessuna merge request, push diretto.
    const directBranch = project.gitlab?.direct_branch === true
    const branch = directBranch ? baseBranch : `feature/${taskId}`
    const worktreePath = path.join(WORKSPACE, 'worktrees', job._id)
    const prompt = buildPrompt(job)
    const heartbeatTimer = setInterval(() => {
        api.heartbeatJob(job._id).catch((err) => {
            console.error(`heartbeat failed for job ${job._id}:`, err.message)
        })
    }, JOB_HEARTBEAT_MS)

    let repoPath = null
    let worktreeCreated = false
    let stdout = ''
    let stderr = ''
    // Popolati dal JSON strutturato di Claude (--output-format json), se il
    // parsing va a buon fine: costo reale ed uso token dell'esecuzione.
    let responseText = ''
    let inputTokens = null
    let outputTokens = null
    let totalCostUsd = null

    try {
        repoPath = await ensureClone(project, WORKSPACE)
        await createWorktree(repoPath, worktreePath, branch, baseBranch)
        worktreeCreated = true
        log(`worktree pronto su ${branch} (base ${baseBranch})`)

        const claudeResult = await runClaude({cwd: worktreePath, prompt})
        stdout = claudeResult.stdout
        stderr = claudeResult.stderr
        responseText = claudeResult.text
        inputTokens = claudeResult.inputTokens
        outputTokens = claudeResult.outputTokens
        totalCostUsd = claudeResult.totalCostUsd
        log(`claude completato (response ${responseText.length} char, stderr ${stderr.length} char${totalCostUsd != null ? `, costo $${totalCostUsd.toFixed(4)}` : ''})`)

        const commitMessage = job.title ?? job.clickup?.title ?? `task ${taskId}`
        const commitSha = await commitAll(worktreePath, commitMessage)

        if (commitSha === null) {
            const questionText = responseText.trim() || '(Claude non ha modificato file e non ha lasciato output)'
            const completedAt = new Date()
            log('nessuna modifica ai file → ramo domande')

            await api.askQuestion(job._id, {
                question_text: questionText,
                execution: {
                    outcome: 'question',
                    prompt,
                    response: responseText,
                    stderr,
                    started_at: startedAt,
                    completed_at: completedAt,
                    duration_ms: completedAt - startedAt,
                    worktree_path: worktreePath,
                    logs,
                    question_text: questionText,
                    input_tokens: inputTokens ?? undefined,
                    output_tokens: outputTokens ?? undefined,
                    cost_usd: totalCostUsd ?? undefined
                }
            })
        } else {
            log(`commit ${commitSha}`)
            await pushBranch(worktreePath, branch)
            log(`branch ${branch} pushato`)

            let mergeRequest = null
            if (!directBranch) {
                try {
                    mergeRequest = await ensureMergeRequest({
                        project,
                        sourceBranch: branch,
                        targetBranch: baseBranch,
                        title: commitMessage,
                        expectedCommitSha: commitSha
                    })
                    log(`merge request ${mergeRequest.mr_url} (${mergeRequest.mr_state})`)
                } catch (err) {
                    // Il branch resta in awaiting_merge. Il poller ritenterà la creazione
                    // o rileverà una MR aperta manualmente senza sbloccare il progetto.
                    log(`merge request non disponibile: ${err.message}`)
                }
            } else {
                log(`push diretto su ${branch}, nessuna merge request`)
            }
            const completedAt = new Date()
            const estimatedMinutes = parseEstimatedMinutes(responseText)
            if (estimatedMinutes) log(`stima tempo umano: ${estimatedMinutes} min`)

            await api.completeJob(job._id, {
                execution: {
                    outcome: 'implementation',
                    prompt,
                    response: responseText,
                    stderr,
                    started_at: startedAt,
                    completed_at: completedAt,
                    duration_ms: completedAt - startedAt,
                    worktree_path: worktreePath,
                    logs,
                    branch,
                    commit_sha: commitSha,
                    pushed: true,
                    input_tokens: inputTokens ?? undefined,
                    output_tokens: outputTokens ?? undefined,
                    cost_usd: totalCostUsd ?? undefined
                },
                gitlab: {
                    branch,
                    commit_sha: commitSha,
                    pushed: true,
                    ...mergeRequest
                },
                minutes: estimatedMinutes ?? undefined,
                cost_usd: totalCostUsd ?? undefined
            })

            if (directBranch) {
                await api.markJobMerged(job._id, {
                    gitlab: {branch, commit_sha: commitSha, pushed: true}
                })
                log('job segnato come merged (push diretto)')
            } else if (mergeRequest?.mr_state === 'merged') {
                await api.markJobMerged(job._id, {
                    gitlab: {branch, commit_sha: commitSha, pushed: true, ...mergeRequest}
                })
            }
        }
    } catch (err) {
        console.error(`job ${job._id} failed:`, err.message)
        logs.push(`[${new Date().toISOString()}] errore: ${err.message}`)
        const completedAt = new Date()
        await api.failJob(job._id, {
            execution: {
                outcome: 'failed',
                prompt,
                response: responseText || stdout,
                stderr,
                started_at: startedAt,
                completed_at: completedAt,
                duration_ms: completedAt - startedAt,
                worktree_path: worktreePath,
                logs,
                error: err.message,
                input_tokens: inputTokens ?? undefined,
                output_tokens: outputTokens ?? undefined,
                cost_usd: totalCostUsd ?? undefined
            }
        })
    } finally {
        clearInterval(heartbeatTimer)
        if (repoPath && worktreeCreated) {
            try {
                await removeWorktree(repoPath, worktreePath)
            } catch (err) {
                console.error(`worktree cleanup failed for job ${job._id}:`, err.message)
            }
        }
    }

    return true
}

;(async function pollerLoop() {
    while (true) {
        try {
            const projects = await api.listProjects()
            await reconcileMerges(projects)
            await pollProjectJobs(projects, api)
        } catch (err) {
            console.error('poll error:', err)
        }
        await sleep(POLL_INTERVAL_MS)
    }
})()

async function executorLoop(executorId) {
    while (true) {
        try {
            const processed = await processNextJob(executorId)
            if (!processed) await sleep(5000)
        } catch (err) {
            console.error('executor error:', err)
            await sleep(5000)
        }
    }
}

for (let executorId = 1; executorId <= WORKER_CONCURRENCY; executorId++) {
    executorLoop(executorId)
}
