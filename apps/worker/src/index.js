import path from 'path'
import fs from 'fs/promises'
import {apiClient} from './services/api.service.js'
import {alignCheckout, commitAll, createWorktree, ensureClone, fetchMergeRequestRef, fetchOrigin, prepareReadWorktree, pruneWorktrees, pushBranch, removeWorktree, resolveRef, sweepIdleWorktrees} from './services/git.service.js'
import {buildPrompt, parseEstimatedMinutes, runClaude} from './services/agent.service.js'
import {ensureMergeRequest, getMergeRequest, mergeMergeRequest} from './services/gitlab.service.js'
import {pollProjectJobs} from './services/project-sync.service.js'
import {buildChatPrompt, buildJobDraftPrompt, CHAT_PERMISSION_ARGS, chatClaudeArgs, chatRefs, isBudgetExceeded, isMissingSession, parseJobDraft} from './services/chat.service.js'
import {createActivityRecorder} from './services/activity.service.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000)
// Sync delle MR esterne (e accodamento delle review automatiche).
const MR_POLL_INTERVAL_MS = Number(process.env.MR_POLL_INTERVAL_MS ?? 10 * 60 * 1000)
const WORKER_CONCURRENCY = Math.max(1, Number.parseInt(process.env.WORKER_CONCURRENCY ?? '4', 10) || 1)
const JOB_HEARTBEAT_MS = Math.max(5000, Number.parseInt(process.env.JOB_HEARTBEAT_MS ?? '30000', 10) || 30000)
const WORKSPACE = process.env.WORKSPACE ?? ''
const CHAT_CONCURRENCY = Math.max(0, Number.parseInt(process.env.CHAT_CONCURRENCY ?? '2', 10) || 0)
const CLAUDE_CHAT_TIMEOUT_MS = Number(process.env.CLAUDE_CHAT_TIMEOUT_MS ?? 10 * 60 * 1000)
// Fetch per le chat al più ogni CHAT_FETCH_INTERVAL_MS per progetto; i
// worktree delle chat sui branch dei job, se inattivi, rimossi dopo CHAT_WORKTREE_TTL_MS.
const CHAT_FETCH_INTERVAL_MS = Number(process.env.CHAT_FETCH_INTERVAL_MS ?? 60 * 1000)
const CHAT_WORKTREE_TTL_MS = Number(process.env.CHAT_WORKTREE_TTL_MS ?? 6 * 60 * 60 * 1000)
const CHAT_SWEEP_INTERVAL_MS = 10 * 60 * 1000
// Sessioni del CLI per le chat (--resume): sotto WORKSPACE, così persistono
// insieme ai cloni se WORKSPACE è su un volume. Se si perdono, il worker
// ripiega sulla cronologia nel prompt.
const CHAT_CLAUDE_CONFIG_DIR = process.env.CHAT_CLAUDE_CONFIG_DIR ?? path.join(WORKSPACE || '/', 'claude-chats')

const api = apiClient()

await fs.mkdir(CHAT_CLAUDE_CONFIG_DIR, {recursive: true}).catch((err) => {
    console.error(`impossibile creare ${CHAT_CLAUDE_CONFIG_DIR}:`, err.message)
})

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

    const activity = createActivityRecorder({flush: (entries) => api.jobProgress(job._id, entries)})

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

        const claudeResult = await runClaude({cwd: worktreePath, prompt, onActivity: activity.push})
        await activity.stop()
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
                    cost_usd: totalCostUsd ?? undefined,
                    activity: activity.entries()
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
                    cost_usd: totalCostUsd ?? undefined,
                    activity: activity.entries()
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
        await activity.stop()
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
                // Su timeout/errore il costo arriva dal risultato parziale del CLI.
                cost_usd: totalCostUsd ?? err.result?.totalCostUsd ?? undefined,
                // Conservata anche su timeout: mostra dove l'agente si è bloccato.
                activity: activity.entries()
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

let lastMergeRequestSyncAt = 0

async function syncMergeRequests(projects) {
    if (Date.now() - lastMergeRequestSyncAt < MR_POLL_INTERVAL_MS) return
    lastMergeRequestSyncAt = Date.now()
    for (const project of projects) {
        if (!project.gitlab?.url) continue
        try {
            const {reviews_queued} = await api.syncMergeRequests(project._id)
            if (reviews_queued > 0) console.log(`project ${project._id}: ${reviews_queued} review di MR accodate`)
        } catch (err) {
            console.error(`merge request sync failed for project ${project._id}:`, err.message)
        }
    }
}

;(async function pollerLoop() {
    while (true) {
        try {
            const projects = await api.listProjects()
            await reconcileMerges(projects)
            await pollProjectJobs(projects, api)
            await syncMergeRequests(projects)
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

// Chat di sola lettura: executor separati dai job, così una domanda non aspetta
// lo slot del progetto. Le chat sul branch di default leggono direttamente il
// clone in cache (le chat non scrivono), riallineato a origin/<default> solo se
// nessun'altra chat dello stesso progetto lo sta leggendo. Le chat sul branch
// di un job usano un worktree per chat, riusato tra le domande.
const lastChatFetchAt = new Map()
const cacheReaders = new Map()
const busyChatWorktrees = new Set()
let lastChatSweepAt = 0

async function fetchForChat(project, repoPath) {
    const key = String(project._id)
    if (Date.now() - (lastChatFetchAt.get(key) ?? 0) < CHAT_FETCH_INTERVAL_MS) return
    if (await fetchOrigin(repoPath)) lastChatFetchAt.set(key, Date.now())
}

// Registra un lettore del checkout in cache; se è il primo, prima lo
// riallinea. Serializzato per progetto, così due chat che arrivano insieme non
// fanno checkout in parallelo. Ritorna la funzione di rilascio.
async function acquireCacheCheckout(project, repoPath, sha) {
    const key = String(project._id)
    let state = cacheReaders.get(key)
    if (!state) cacheReaders.set(key, state = {readers: 0, queue: Promise.resolve()})

    const acquired = state.queue.then(async () => {
        if (state.readers === 0) await alignCheckout(repoPath, sha)
        state.readers++
    })
    state.queue = acquired.catch(() => {})
    await acquired
    return () => {
        state.readers--
    }
}

async function sweepChatWorktrees() {
    if (Date.now() - lastChatSweepAt < CHAT_SWEEP_INTERVAL_MS) return
    lastChatSweepAt = Date.now()
    const removed = await sweepIdleWorktrees(path.join(WORKSPACE, 'worktrees'), {
        prefix: 'chat-',
        maxIdleMs: CHAT_WORKTREE_TTL_MS,
        busy: busyChatWorktrees
    })
    if (removed) console.log(`rimossi ${removed} worktree di chat inattivi`)
}

async function processNextChat() {
    const claimed = await api.claimChat()
    if (!claimed) return false

    const {chat, project, job} = claimed
    const draftMode = chat.mode === 'draft_job'
    const startedAt = Date.now()
    const activity = createActivityRecorder({flush: (entries) => api.chatProgress(chat._id, entries)})
    let release = () => {}

    try {
        if (!project) throw new Error('project non trovato')
        const repoPath = await ensureClone(project, WORKSPACE)
        await fetchForChat(project, repoPath)
        if (chat.merge_request) await fetchMergeRequestRef(repoPath, chat.merge_request.iid)

        const baseBranch = project.gitlab?.default_branch?.trim() || 'main'
        const {ref, sha} = await resolveRef(repoPath, chatRefs(project, job, chat.merge_request))
        let cwd = repoPath
        if (ref === `origin/${baseBranch}`) {
            // Branch di default: checkout condiviso del clone in cache.
            release = await acquireCacheCheckout(project, repoPath, sha)
        } else {
            cwd = path.join(WORKSPACE, 'worktrees', `chat-${chat._id}`)
            busyChatWorktrees.add(cwd)
            release = () => busyChatWorktrees.delete(cwd)
            await prepareReadWorktree(repoPath, cwd, sha)
        }

        const buildPrompt = draftMode ? buildJobDraftPrompt : buildChatPrompt
        const run = (resume) => runClaude({
            cwd,
            prompt: buildPrompt(chat, project, job, {
                ref,
                resumed: resume,
                codeChangedTo: resume && chat.last_sha && chat.last_sha !== sha ? sha : null
            }),
            permissionArgs: CHAT_PERMISSION_ARGS,
            extraArgs: chatClaudeArgs({resumeSessionId: resume ? chat.session_id : null}),
            env: {CLAUDE_CONFIG_DIR: CHAT_CLAUDE_CONFIG_DIR},
            timeoutMs: CLAUDE_CHAT_TIMEOUT_MS,
            onActivity: activity.push
        })

        let result
        try {
            result = await run(Boolean(chat.session_id))
        } catch (err) {
            if (!chat.session_id || !isMissingSession(err)) throw err
            console.log(`chat ${chat._id}: sessione ${chat.session_id} non trovata, riparto dalla cronologia`)
            result = await run(false)
        }
        await activity.stop()

        const usage = {
            cost_usd: result.totalCostUsd,
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            duration_ms: Date.now() - startedAt,
            activity: activity.entries(),
            session_id: result.sessionId,
            sha
        }
        if (draftMode) {
            const draft = parseJobDraft(result.text)
            if (!draft) throw Object.assign(new Error(`bozza job non valida: ${result.text.slice(0, 300)}`), {result})
            await api.replyChat(chat._id, {text: '', kind: 'job_draft', job_draft: draft, ...usage})
        } else {
            await api.replyChat(chat._id, {text: result.text.trim(), ...usage})
        }
        console.log(`chat ${chat._id}: ${draftMode ? 'bozza job' : 'risposta'} inviata`)
    } catch (err) {
        console.error(`chat ${chat._id} failed:`, err.message)
        await activity.stop()
        const error = isBudgetExceeded(err)
            ? `Limite di spesa per domanda superato: risposta interrotta. Prova una domanda più circoscritta (es. indica file o modulo).`
            : err.message
        // La sessione resta valida anche dopo un errore (es. budget): la
        // prossima domanda la riprende con quanto già letto.
        await api.replyChat(chat._id, {
            text: '',
            error,
            duration_ms: Date.now() - startedAt,
            activity: activity.entries(),
            cost_usd: err.result?.totalCostUsd ?? undefined,
            session_id: err.result?.sessionId ?? undefined
        }).catch((e) => console.error(`chat ${chat._id}: reply failed:`, e.message))
    } finally {
        release()
    }
    return true
}

async function chatLoop() {
    while (true) {
        try {
            const processed = await processNextChat()
            if (!processed) {
                await sweepChatWorktrees()
                await sleep(3000)
            }
        } catch (err) {
            console.error('chat executor error:', err)
            await sleep(5000)
        }
    }
}

for (let i = 0; i < CHAT_CONCURRENCY; i++) {
    chatLoop()
}
