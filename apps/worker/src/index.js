import path from 'path'
import {apiClient} from './services/api.service.js'
import {commitAll, createWorktree, ensureClone, removeWorktree} from './services/git.service.js'
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

    if (!project) {
        await api.updateJob(job._id, {
            status: 'failed',
            completed_at: new Date(),
            'execution.error': 'project not found'
        })
        return true
    }

    const repoPath = await ensureClone(project, WORKSPACE)

    const taskId = job.clickup?.task_id ?? job._id
    const branch = `feature/${taskId}`
    const baseBranch = project.gitlab?.default_branch ?? 'main'
    const worktreePath = path.join(WORKSPACE, 'opt/computer/worktrees', job._id)
    const prompt = buildPrompt(job)
    const startedAt = new Date()

    try {
        await createWorktree(repoPath, worktreePath, branch, baseBranch)

        const {stdout, stderr} = await runClaude({cwd: worktreePath, prompt})

        const commitMessage = job.clickup?.title ?? `task ${taskId}`
        const commitSha = await commitAll(worktreePath, commitMessage)
        const completedAt = new Date()

        if (commitSha === null) {
            const questionText = stdout.trim() || '(Claude non ha modificato file e non ha lasciato output)'

            await api.askQuestion(job._id, {
                question_text: questionText,
                completed_at: completedAt,
                'execution.started_at': startedAt,
                'execution.duration_ms': completedAt - startedAt,
                'execution.worktree_path': worktreePath,
                'agent.prompt': prompt,
                'agent.response': stdout,
                'agent.stderr': stderr,
                'agent.question': questionText
            })
        } else {
            await api.completeJob(job._id, {
                completed_at: completedAt,
                'execution.started_at': startedAt,
                'execution.duration_ms': completedAt - startedAt,
                'execution.worktree_path': worktreePath,
                'agent.prompt': prompt,
                'agent.response': stdout,
                'agent.stderr': stderr,
                'gitlab.branch': branch,
                'gitlab.commit_sha': commitSha
            })
            // TODO Fase 3: push branch + apertura MR su GitLab
        }
    } catch (err) {
        console.error(`job ${job._id} failed:`, err.message)
        await api.updateJob(job._id, {
            status: 'failed',
            completed_at: new Date(),
            'execution.started_at': startedAt,
            'execution.worktree_path': worktreePath,
            'execution.error': err.message
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
