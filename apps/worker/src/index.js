import path from 'path'
import {apiClient} from './services/api.service.js'
import {commitAll, createWorktree, ensureClone, pushBranch, removeWorktree} from './services/git.service.js'
import {buildPrompt, runClaude} from './services/agent.service.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000)
const WORKSPACE = process.env.WORKSPACE ?? ''

const api = apiClient()

console.log('worker started')

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function pollAll() {
    const projects = await api.listProjects()

    for (const p of projects) {
        try {
            const {created, warning} = await api.syncProjectJobs(p._id)
            if (warning) console.warn(`sync warning for project ${p._id}: ${warning}`)
            if (created > 0) console.log(`ingested ${created} new task(s) for project ${p._id}`)
        } catch (err) {
            console.error(`sync failed for project ${p._id}:`, err.message)
        }
    }
}

async function processNextJob() {
    const claimed = await api.claimJob()

    if (!claimed) return false

    const {job, project} = claimed

    console.log('processing job', job._id, job.clickup?.task_id)

    const startedAt = new Date()

    if (!project) {
        await api.failJob(job._id, {
            execution: {
                outcome: 'failed',
                started_at: startedAt,
                completed_at: new Date(),
                duration_ms: 0,
                error: 'project not found'
            }
        })
        return true
    }

    const repoPath = await ensureClone(project, WORKSPACE)

    const taskId = job.clickup?.task_id ?? job._id
    const branch = `feature/${taskId}`
    const baseBranch = project.gitlab?.default_branch ?? 'main'
    const worktreePath = path.join(WORKSPACE, 'opt/worktrees', job._id)
    const prompt = buildPrompt(job)

    let stdout = ''
    let stderr = ''

    try {
        await createWorktree(repoPath, worktreePath, branch, baseBranch)

        const claudeResult = await runClaude({cwd: worktreePath, prompt})
        stdout = claudeResult.stdout
        stderr = claudeResult.stderr

        const commitMessage = job.clickup?.title ?? `task ${taskId}`
        const commitSha = await commitAll(worktreePath, commitMessage)

        if (commitSha === null) {
            const questionText = stdout.trim() || '(Claude non ha modificato file e non ha lasciato output)'
            const completedAt = new Date()

            await api.askQuestion(job._id, {
                question_text: questionText,
                execution: {
                    outcome: 'question',
                    prompt,
                    response: stdout,
                    stderr,
                    started_at: startedAt,
                    completed_at: completedAt,
                    duration_ms: completedAt - startedAt,
                    worktree_path: worktreePath,
                    question_text: questionText
                }
            })
        } else {
            await pushBranch(worktreePath, branch)
            const completedAt = new Date()

            await api.completeJob(job._id, {
                execution: {
                    outcome: 'implementation',
                    prompt,
                    response: stdout,
                    stderr,
                    started_at: startedAt,
                    completed_at: completedAt,
                    duration_ms: completedAt - startedAt,
                    worktree_path: worktreePath,
                    branch,
                    commit_sha: commitSha,
                    pushed: true
                },
                gitlab: {branch, commit_sha: commitSha, pushed: true}
            })
        }
    } catch (err) {
        console.error(`job ${job._id} failed:`, err.message)
        const completedAt = new Date()
        await api.failJob(job._id, {
            execution: {
                outcome: 'failed',
                prompt,
                response: stdout,
                stderr,
                started_at: startedAt,
                completed_at: completedAt,
                duration_ms: completedAt - startedAt,
                worktree_path: worktreePath,
                error: err.message
            }
        })
    } finally {
        try {
            await removeWorktree(repoPath, worktreePath)
        } catch (err) {
            console.error(`worktree cleanup failed for job ${job._id}:`, err.message)
        }
    }

    return true
}

;(async function pollerLoop() {
    while (true) {
        try {
            await pollAll()
        } catch (err) {
            console.error('poll error:', err)
        }
        await sleep(POLL_INTERVAL_MS)
    }
})()

;(async function executorLoop() {
    while (true) {
        try {
            const processed = await processNextJob()
            if (!processed) await sleep(5000)
        } catch (err) {
            console.error('executor error:', err)
            await sleep(5000)
        }
    }
})()
