import {ObjectId} from 'mongodb'
import {chatsModel} from '../models/chats.model.js'
import {projectsModel} from '../models/projects.model.js'
import {jobsModel} from '../models/jobs.model.js'
import {sanitizeActivity} from '../activity.js'

// Oltre questa soglia una chat 'running' è considerata orfana e torna
// claimabile. Deve superare CLAUDE_CHAT_TIMEOUT_MS del worker.
const RUNNING_CHAT_STALE_MS = Math.max(
    60 * 1000,
    Number.parseInt(process.env.RUNNING_CHAT_STALE_MS ?? String(15 * 60 * 1000), 10) || 15 * 60 * 1000
)

const MAX_MESSAGE_LENGTH = 20000
const JOB_RESPONSE_CHARS = 4000

function httpError(statusCode, message) {
    const err = new Error(message)
    err.statusCode = statusCode
    return err
}

function normalizeText(value) {
    const text = String(value ?? '').trim()
    if (!text) throw httpError(400, 'text is required')
    if (text.length > MAX_MESSAGE_LENGTH) throw httpError(400, `text exceeds ${MAX_MESSAGE_LENGTH} characters`)
    return text
}

function titleFrom(text) {
    const firstLine = text.split('\n')[0].trim()
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine
}

function optionalNumber(value) {
    const n = Number(value)
    return value != null && Number.isFinite(n) ? n : undefined
}

function toObjectId(value, field) {
    try {
        return new ObjectId(value)
    } catch {
        throw httpError(400, `invalid ${field}`)
    }
}

function jobTitle(job) {
    return job.title ?? job.clickup?.title ?? job.gitlab_issue?.title ?? `Job ${job._id}`
}

// Contesto del job passato al worker: solo i campi utili al prompt, non
// l'intero storico delle esecuzioni.
function jobContext(job) {
    const last = job.executions?.[job.executions.length - 1]
    return {
        _id: job._id,
        title: jobTitle(job),
        description: job.description ?? job.clickup?.description ?? job.gitlab_issue?.description ?? '',
        status: job.status,
        comments: job.comments ?? [],
        gitlab: job.gitlab ?? null,
        last_response: last?.response ? String(last.response).slice(-JOB_RESPONSE_CHARS) : ''
    }
}

function normalizeDraft(draft) {
    if (!draft) return undefined
    return {
        title: String(draft.title ?? '').trim().slice(0, 200),
        description: String(draft.description ?? '').trim().slice(0, MAX_MESSAGE_LENGTH)
    }
}

export function chatsService(db) {
    const model = chatsModel(db)
    const projects = projectsModel(db)
    const jobs = jobsModel(db)

    return {
        init: () => model.init(),

        findByProject: (projectId, {job_id} = {}) =>
            model.findByProject(projectId, {jobId: job_id ? toObjectId(job_id, 'job_id') : null}),

        findById: (id) => model.findById(id),

        async create(projectId, {text, job_id}) {
            const content = normalizeText(text)
            const project = await projects.findById(projectId)
            if (!project) throw httpError(404, 'project not found')

            let job = null
            if (job_id) {
                job = await jobs.findById(toObjectId(job_id, 'job_id'))
                if (!job || String(job.project_id) !== String(projectId)) {
                    throw httpError(400, 'job does not belong to project')
                }
            }

            const now = new Date()
            const doc = {
                project_id: projectId,
                ...(job ? {job_id: job._id, job_title: jobTitle(job)} : {}),
                title: titleFrom(content),
                status: 'pending',
                messages: [{role: 'user', text: content, created_at: now}],
                created_at: now,
                updated_at: now
            }
            const res = await model.insert(doc)
            return {...doc, _id: res.insertedId}
        },

        async addMessage(id, {text}) {
            const content = normalizeText(text)
            const chat = await model.pushUserMessage(id, {role: 'user', text: content, created_at: new Date()})
            if (chat) return chat
            const existing = await model.findById(id)
            if (!existing) throw httpError(404, 'chat not found')
            throw httpError(409, 'chat is waiting for a reply')
        },

        async requestJobDraft(id) {
            const chat = await model.requestMode(id, 'draft_job')
            if (chat) return chat
            const existing = await model.findById(id)
            if (!existing) throw httpError(404, 'chat not found')
            throw httpError(409, 'chat is waiting for a reply')
        },

        async claim() {
            const chat = await model.claimNext(new Date(Date.now() - RUNNING_CHAT_STALE_MS))
            if (!chat) return null
            const project = await projects.findById(chat.project_id)
            const job = chat.job_id ? await jobs.findById(chat.job_id) : null
            return {chat, project, job: job ? jobContext(job) : null}
        },

        async progress(id, {entries}) {
            await model.setProgress(id, sanitizeActivity(entries))
            return {ok: true}
        },

        async reply(id, {text, error, kind, job_draft, activity, cost_usd, input_tokens, output_tokens, duration_ms, session_id, sha}) {
            const message = {
                role: 'assistant',
                text: String(text ?? ''),
                created_at: new Date(),
                cost_usd: optionalNumber(cost_usd),
                input_tokens: optionalNumber(input_tokens),
                output_tokens: optionalNumber(output_tokens),
                duration_ms: optionalNumber(duration_ms)
            }
            if (kind === 'job_draft') {
                message.kind = 'job_draft'
                message.job_draft = normalizeDraft(job_draft)
            }
            if (Array.isArray(activity) && activity.length) message.activity = sanitizeActivity(activity)
            if (error) message.error = String(error)
            const res = await model.pushReply(id, message, {
                error: error ? String(error) : null,
                sessionId: typeof session_id === 'string' ? session_id.slice(0, 100) : null,
                sha: typeof sha === 'string' && /^[0-9a-f]{7,64}$/.test(sha) ? sha : null
            })
            if (res.matchedCount === 0) throw httpError(409, 'chat is not running')
            return {ok: true}
        },

        delete: (id) => model.deleteById(id)
    }
}
