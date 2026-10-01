import {mergeRequestsModel} from '../models/mergeRequests.model.js'
import {chatsModel} from '../models/chats.model.js'
import {projectsModel} from '../models/projects.model.js'
import {jobsModel} from '../models/jobs.model.js'
import {closeMergeRequest, getMergeRequest, listOpenMergeRequests, mergeMergeRequest} from './gitlabMergeRequests.service.js'

const BUSY_CHAT_STATUSES = ['pending', 'running']

function httpError(statusCode, message) {
    const err = new Error(message)
    err.statusCode = statusCode
    return err
}

// Errori GitLab su merge/close (MR non mergiabile, sha cambiato, conflitti):
// 409 con il messaggio di GitLab; il resto è un errore del gateway.
function gitlabError(err) {
    return httpError(err.status >= 400 && err.status < 500 ? 409 : 502, err.message)
}

const short = (sha) => String(sha ?? '').slice(0, 12)

// Testo del messaggio con cui si chiede la review al worker: completa la
// prima volta (o dopo una review fallita), sul solo delta ai push successivi.
export function reviewRequestText(mr) {
    const previous = mr.review?.verdict !== 'failed' ? mr.review?.sha : null
    if (previous && previous !== mr.sha) {
        return [
            `La merge request ha nuovi commit (${short(previous)} → ${short(mr.sha)}).`,
            `Rivedi solo le modifiche nuove (\`git diff ${previous}..HEAD\`) e aggiorna il verdetto.`
        ].join(' ')
    }
    return `Fai la code review completa della merge request !${mr.iid}.`
}

// Snapshot salvato sulla chat: il worker lo usa per il checkout e il prompt.
function chatSnapshot(mr) {
    return {
        iid: mr.iid,
        title: mr.title,
        description: mr.description,
        author: mr.author,
        web_url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        sha: mr.sha
    }
}

export function mergeRequestsService(db) {
    const model = mergeRequestsModel(db)
    const chats = chatsModel(db)
    const projects = projectsModel(db)
    const jobs = jobsModel(db)

    async function findProject(projectId) {
        const project = await projects.findById(projectId)
        if (!project) throw httpError(404, 'project not found')
        if (!project.gitlab?.url) throw httpError(400, 'project has no GitLab repository')
        return project
    }

    async function get(id) {
        const [mr] = await withChatStatus([await findMergeRequest(id)])
        return mr
    }

    async function findMergeRequest(id) {
        const mr = await model.findById(id)
        if (!mr) throw httpError(404, 'merge request not found')
        return mr
    }

    // Stato della chat di review (pending/running = review o risposta in corso).
    // chat_id azzerato se la chat è stata eliminata.
    async function withChatStatus(mrs) {
        const ids = mrs.map(mr => mr.chat_id).filter(Boolean)
        const statuses = new Map((ids.length ? await chats.findStatuses(ids) : []).map(c => [String(c._id), c.status]))
        return mrs.map(mr => {
            const status = mr.chat_id ? statuses.get(String(mr.chat_id)) : undefined
            return {...mr, chat_id: status ? mr.chat_id : null, chat_status: status ?? null}
        })
    }

    // Accoda una review nella chat della MR (creandola se serve). false se la
    // chat sta già lavorando: si riprova al prossimo sync.
    async function enqueueReview(mr, {force = false} = {}) {
        if (mr.state !== 'opened') return false
        if (!force && mr.review?.sha === mr.sha) return false

        const now = new Date()
        const message = {role: 'user', kind: 'mr_review', text: reviewRequestText(mr), created_at: now}
        const merge_request = chatSnapshot(mr)

        const existing = mr.chat_id ? await chats.findById(mr.chat_id) : null
        if (existing) {
            return Boolean(await chats.pushUserMessage(existing._id, message, {merge_request}))
        }

        const res = await chats.insert({
            project_id: mr.project_id,
            merge_request_id: mr._id,
            merge_request,
            title: `MR !${mr.iid}: ${mr.title}`.slice(0, 80),
            status: 'pending',
            messages: [message],
            created_at: now,
            updated_at: now
        })
        await model.setChat(mr._id, res.insertedId)
        return true
    }

    return {
        init: () => model.init(),

        async listByProject(projectId) {
            return withChatStatus(await model.findOpenByProject(projectId))
        },

        get,

        // Allinea le MR aperte su GitLab e accoda la review di quelle nuove o
        // con nuovi commit. Le MR dei job dell'agente sono escluse: si
        // gestiscono dalla pagina del job.
        async sync(projectId) {
            const project = await findProject(projectId)
            const remote = await listOpenMergeRequests(project)

            const agentJobs = await jobs.findByProject(projectId)
            const agentBranches = new Set(agentJobs.map(j => j.gitlab?.branch).filter(Boolean))
            const agentIids = new Set(agentJobs.map(j => j.gitlab?.mr_iid).filter(Boolean))
            const external = remote.filter(mr => !agentIids.has(mr.iid) && !agentBranches.has(mr.source_branch))

            let queued = 0
            for (const view of external) {
                const mr = await model.upsert(projectId, view)
                if (!mr.draft && await enqueueReview(mr)) queued++
            }

            // MR non più aperte: stato reale da GitLab (merged o closed).
            const openIids = new Set(remote.map(mr => mr.iid))
            for (const mr of await model.findOpenByProject(projectId)) {
                if (openIids.has(mr.iid)) continue
                const current = await getMergeRequest(project, mr.iid).catch(() => null)
                await model.setState(mr._id, current?.state ?? 'closed')
            }

            return {open: external.length, reviews_queued: queued}
        },

        // Review su richiesta (es. MR in draft, o per rifarla da capo).
        async review(id) {
            const mr = await findMergeRequest(id)
            if (mr.state !== 'opened') throw httpError(409, 'merge request is not open')
            if (!await enqueueReview(mr, {force: true})) throw httpError(409, 'chat is waiting for a reply')
            return get(id)
        },

        async merge(id) {
            const mr = await findMergeRequest(id)
            if (mr.state !== 'opened') throw httpError(409, 'merge request is not open')
            if (!mr.review?.sha) throw httpError(409, 'merge request has not been reviewed yet')
            if (mr.review.sha !== mr.sha) throw httpError(409, 'merge request has new commits since the last review')
            const chat = mr.chat_id ? await chats.findById(mr.chat_id) : null
            if (BUSY_CHAT_STATUSES.includes(chat?.status)) throw httpError(409, 'review in progress')

            const project = await findProject(mr.project_id)
            const view = await mergeMergeRequest(project, mr.iid, mr.review.sha).catch(err => {
                throw gitlabError(err)
            })
            return model.setDecision(mr._id, 'merged', view)
        },

        async close(id) {
            const mr = await findMergeRequest(id)
            if (mr.state !== 'opened') throw httpError(409, 'merge request is not open')
            const project = await findProject(mr.project_id)
            const view = await closeMergeRequest(project, mr.iid).catch(err => {
                throw gitlabError(err)
            })
            return model.setDecision(mr._id, 'closed', view)
        }
    }
}
