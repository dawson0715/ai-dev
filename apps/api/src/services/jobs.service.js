import {ObjectId} from 'mongodb'
import {jobsModel} from '../models/jobs.model.js'
import {projectsModel} from '../models/projects.model.js'
import {listTodoTasks, postComment, setTaskStatus} from './clickup.service.js'

const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN
const CLICKUP_QUESTION_STATUS = process.env.CLICKUP_QUESTION_STATUS ?? 'pending'
const CLICKUP_INPROGRESS_STATUS = process.env.CLICKUP_INPROGRESS_STATUS ?? 'in progress'

export function jobsService(db) {
    const jobs = jobsModel(db)
    const projects = projectsModel(db)

    function notFound(message) {
        const err = new Error(message)
        err.statusCode = 404
        return err
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
            if (projectIds.length === 0) return []
            return jobs.findBillable(projectIds)
        },

        async retry(jobId) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')
            await jobs.update(jobId, {status: 'pending', started_at: null})
            return {ok: true}
        },

        async createManual(projectId, {title, description}) {
            const project = await projects.findById(projectId)
            if (!project) throw notFound('project not found')

            const cleanTitle = (title ?? '').trim() || 'Job manuale'
            const res = await jobs.insertManual({
                projectId,
                title: cleanTitle,
                description: (description ?? '').trim()
            })
            return {ok: true, job_id: res.insertedId.toString()}
        },

        async syncProject(projectId) {
            if (!CLICKUP_TOKEN) return {created: 0, warning: 'CLICKUP_TOKEN not set'}

            const project = await projects.findById(projectId)
            if (!project) throw notFound('project not found')

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
            const job = await jobs.claimNext()
            if (!job) return null

            const project = await projects.findById(job.project_id)
            return {job, project}
        },

        update: (id, fields) => jobs.update(id, fields),

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

            await jobs.pushExecution(jobId, execution, {
                status: 'awaiting_clarification',
                completed_at: new Date()
            })
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

            const setFields = {status: 'completed', completed_at: new Date()}
            if (gitlab) setFields.gitlab = gitlab

            await jobs.pushExecution(jobId, execution, setFields)
            return {ok: true}
        },

        async fail(jobId, {execution}) {
            const job = await jobs.findById(jobId)
            if (!job) throw notFound('job not found')

            await jobs.pushExecution(jobId, execution, {
                status: 'failed',
                completed_at: new Date()
            })
            return {ok: true}
        }
    }
}
