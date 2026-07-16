import {ObjectId} from 'mongodb'
import {jobsModel} from '../models/jobs.model.js'
import {projectsModel} from '../models/projects.model.js'
import {listTodoTasks, postComment, setTaskStatus} from './clickup.service.js'
import {listOpenIssues} from './gitlabIssues.service.js'
import {createNextLiquibaseId} from '../liquibase.js'

const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN
const CLICKUP_QUESTION_STATUS = process.env.CLICKUP_QUESTION_STATUS ?? 'pending'
const CLICKUP_INPROGRESS_STATUS = process.env.CLICKUP_INPROGRESS_STATUS ?? 'in progress'
const RUNNING_JOB_STALE_MS = Math.max(
    60_000,
    Number.parseInt(process.env.RUNNING_JOB_STALE_MS ?? String(60 * 60 * 1000), 10) || 60 * 60 * 1000
)

// Stima (forfait) per job in EUR: input dell'utente, accumulato poi nel forfait sprint.
function toEstimate(value) {
    if (value === undefined || value === null || value === '') return 0
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : 0
}

export function jobsService(db) {
    const jobs = jobsModel(db)
    const projects = projectsModel(db)
    let lastStaleRecoveryAt = 0

    function notFound(message) {
        const err = new Error(message)
        err.statusCode = 404
        return err
    }

    function badRequest(message) {
        const err = new Error(message)
        err.statusCode = 400
        return err
    }

    function toJobIds(values) {
        if (values === undefined || values === null) return []
        if (!Array.isArray(values)) throw badRequest('depends_on_job_ids must be an array')

        try {
            return [...new Set(values.map(String))].map((id) => new ObjectId(id))
        } catch {
            throw badRequest('invalid job id in depends_on_job_ids')
        }
    }

    async function validateDependencies(projectId, dependencyIds, currentJobId = null) {
        if (currentJobId && dependencyIds.some((id) => id.equals(currentJobId))) {
            throw badRequest('a job cannot depend on itself')
        }
        if (dependencyIds.length === 0) return

        const dependencies = await jobs.findByIds(dependencyIds)
        if (dependencies.length !== dependencyIds.length) {
            throw badRequest('one or more dependency jobs do not exist')
        }
        if (dependencies.some((job) => !job.project_id?.equals(projectId))) {
            throw badRequest('dependency jobs must belong to the same project')
        }
    }

    async function liquibaseIdForClaim(job) {
        if (job.liquibase_id) return job.liquibase_id

        const taskId = job.clickup?.task_id
            ?? (job.gitlab_issue?.iid ? `GL-${job.gitlab_issue.iid}` : null)
            ?? `JOB-${job._id}`
        const previousId = await jobs.findLatestLiquibaseId(job.project_id)
        return createNextLiquibaseId(taskId, previousId)
    }

    return {
        init: () => jobs.init(),

        findAll: (opts) => jobs.findAll(opts),

        findByProject: (projectId) => jobs.findByProject(projectId),

        findById: (id) => jobs.findById(id),

        // Job fatturabili di un cliente: completati e non ancora in uno sprint.
        // Il cliente si ricava dai progetti (project.client_id), non dal job.
        async findBillable(clientId) {
            let cid
            try {
                cid = new ObjectId(clientId)
            } catch {
                const err = new Error('invalid client_id')
                err.statusCode = 400
                throw err
            }
            const clientProjects = await projects.findByClient(cid)
            const projectIds = clientProjects.map((p) => p._id)
            return jobs.findBillable({projectIds, clientId: cid})
        },

        async retry(jobId) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')
            if (['merged', 'completed'].includes(job.status)) {
                throw badRequest('a merged job cannot be retried; create a new job')
            }
            await jobs.requeue(jobId)
            return {ok: true}
        },

        async createManual(projectId, {title, description, estimate, depends_on_job_ids}) {
            const project = await projects.findById(projectId)
            if (!project) throw notFound('project not found')

            const dependencyIds = toJobIds(depends_on_job_ids)
            await validateDependencies(projectId, dependencyIds)

            const cleanTitle = (title ?? '').trim() || 'Job manuale'
            const res = await jobs.insertManual({
                projectId,
                title: cleanTitle,
                description: (description ?? '').trim(),
                estimate: toEstimate(estimate),
                dependsOnJobIds: dependencyIds
            })
            return {ok: true, job_id: res.insertedId.toString()}
        },

        async syncProject(projectId) {
            const project = await projects.findById(projectId)
            if (!project) throw notFound('project not found')

            const source = project.task_source ?? (project.clickup?.list_id ? 'clickup' : 'manual')

            if (source === 'manual') {
                return {created: 0, warning: 'progetto manuale: nessun sync esterno'}
            }

            if (source === 'gitlab_issues') {
                if (!project.gitlab?.url) return {created: 0, warning: 'project has no gitlab.url'}

                const issues = await listOpenIssues(project)
                let created = 0

                for (const issue of issues) {
                    const res = await jobs.upsertFromGitlabIssue(project._id, issue)
                    if (res.upsertedCount > 0) created++
                }

                return {created}
            }

            if (!CLICKUP_TOKEN) return {created: 0, warning: 'CLICKUP_TOKEN not set'}

            const listId = project.clickup?.list_id
            if (!listId) return {created: 0, warning: 'project has no clickup list_id'}

            const tasks = await listTodoTasks(CLICKUP_TOKEN, listId)
            let created = 0

            for (const t of tasks) {
                const res = await jobs.upsertFromTask(project._id, listId, t)
                if (res.upsertedCount > 0) created++
            }

            return {created}
        },

        async claim() {
            const now = Date.now()
            if (now - lastStaleRecoveryAt >= 60_000) {
                lastStaleRecoveryAt = now
                await jobs.recoverStaleRunning(new Date(now - RUNNING_JOB_STALE_MS))
            }

            const activeProjectIds = await jobs.findActiveProjectIds()
            const candidates = await jobs.findClaimCandidates(100, activeProjectIds)

            for (const candidate of candidates) {
                const dependencyIds = candidate.depends_on_job_ids ?? []
                if (dependencyIds.length > 0) {
                    const dependencies = await jobs.findDependencies(dependencyIds)
                    if (!jobs.dependenciesAreSuccessful(dependencies, dependencyIds.length)) continue
                }

                let job
                try {
                    const liquibaseId = await liquibaseIdForClaim(candidate)
                    job = await jobs.claimById(candidate._id, liquibaseId)
                } catch (err) {
                    // Un altro executor ha occupato atomicamente lo slot del progetto.
                    if (err.code === 11000) continue
                    throw err
                }
                if (!job) continue

                const project = await projects.findById(job.project_id)
                return {job, project}
            }

            return null
        },

        async update(id, fields) {
            const clean = {}
            for (const field of ['title', 'description', 'estimate', 'depends_on_job_ids', 'gitlab']) {
                if (field in fields) clean[field] = fields[field]
            }
            if ('estimate' in clean) clean.estimate = toEstimate(clean.estimate)

            if ('depends_on_job_ids' in clean) {
                const job = await jobs.findById(id)
                if (!job) throw notFound('job not found')
                const dependencyIds = toJobIds(clean.depends_on_job_ids)
                await validateDependencies(job.project_id, dependencyIds, job._id)
                clean.depends_on_job_ids = dependencyIds
            }

            if ('title' in clean || 'description' in clean) {
                const job = await jobs.findById(id)
                if (!job) throw notFound('job not found')
                if (job.clickup?.task_id) return jobs.detachAndUpdate(id, clean)
            }

            return jobs.update(id, clean)
        },

        async heartbeat(jobId) {
            const result = await jobs.heartbeat(jobId)
            if (result.matchedCount === 0) throw badRequest('job is not running')
            return {ok: true}
        },

        async addComment(jobId, text) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')

            const clean = (text ?? '').trim()
            if (!clean) {
                const err = new Error('text is required')
                err.statusCode = 400
                throw err
            }

            await jobs.pushComment(jobId, {text: clean, created_at: new Date()})
            return {ok: true}
        },

        async ask(jobId, {question_text, execution}) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')

            const taskId = job.clickup?.task_id
            if (CLICKUP_TOKEN && taskId) {
                try {
                    await postComment(CLICKUP_TOKEN, taskId, question_text ?? '')
                    await setTaskStatus(CLICKUP_TOKEN, taskId, CLICKUP_QUESTION_STATUS)
                } catch (err) {
                    console.error(`clickup ask failed for job ${jobId}:`, err.message)
                }
            }

            const result = await jobs.pushExecution(jobId, execution, {
                status: 'awaiting_clarification',
                completed_at: new Date()
            }, {
                releaseProject: true,
                expectedStatuses: ['running'],
                requireProjectSlot: true
            })
            if (result.matchedCount === 0) throw badRequest('job is no longer running')
            return {ok: true}
        },

        async complete(jobId, {execution, gitlab}) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')

            const taskId = job.clickup?.task_id
            if (CLICKUP_TOKEN && taskId) {
                try {
                    await setTaskStatus(CLICKUP_TOKEN, taskId, CLICKUP_INPROGRESS_STATUS)
                } catch (err) {
                    console.error(`clickup complete failed for job ${jobId}:`, err.message)
                }
            }

            const setFields = {
                status: 'awaiting_merge',
                implemented_at: new Date()
            }
            if (gitlab) setFields.gitlab = gitlab

            const result = await jobs.pushExecution(jobId, execution, setFields, {
                expectedStatuses: ['running'],
                requireProjectSlot: true
            })
            if (result.matchedCount === 0) throw badRequest('job is no longer running')
            return {ok: true}
        },

        async markMerged(jobId, {gitlab} = {}) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')
            if (job.status === 'merged') return {ok: true, job}

            const mergedGitlab = gitlab ? {...job.gitlab, ...gitlab} : job.gitlab
            const merged = await jobs.markMerged(jobId, mergedGitlab)
            if (!merged) throw badRequest('job is not awaiting merge')
            return {ok: true, job: merged}
        },

        async fail(jobId, {execution}) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')

            const result = await jobs.pushExecution(jobId, execution, {
                status: 'failed',
                completed_at: new Date()
            }, {
                releaseProject: true,
                expectedStatuses: ['pending', 'running', 'awaiting_merge', 'awaiting_clarification']
            })
            if (result.matchedCount === 0) throw badRequest('job cannot be marked as failed')
            return {ok: true}
        }
    }
}
