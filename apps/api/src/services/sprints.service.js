import {ObjectId} from 'mongodb'
import {sprintsModel} from '../models/sprints.model.js'
import {jobsModel} from '../models/jobs.model.js'
import {projectsModel} from '../models/projects.model.js'
import {clientsModel} from '../models/clients.model.js'

// Stato commerciale dello sprint (la voce fatturabile a forfait).
export const SPRINT_STATUSES = ['preventivo', 'approvato', 'in_lavorazione', 'completato']

function badRequest(message) {
    const err = new Error(message)
    err.statusCode = 400
    return err
}

function notFound(message) {
    const err = new Error(message)
    err.statusCode = 404
    return err
}

function toNumber(value) {
    if (value === undefined || value === null || value === '') return 0
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
}

// Vista del job esposta nel dettaglio sprint: solo i campi utili, niente prompt/log.
function jobView(job) {
    return {
        _id: job._id,
        title: job.title ?? job.clickup?.title ?? '(senza titolo)',
        status: job.status,
        url: job.clickup?.url ?? null,
        cost_usd: job.cost_usd ?? 0,
        created_at: job.created_at
    }
}

export function sprintsService(db) {
    const model = sprintsModel(db)
    const jobs = jobsModel(db)
    const projects = projectsModel(db)
    const clients = clientsModel(db)

    return {
        init: () => model.init(),

        async findAll({client_id} = {}) {
            const filter = {}
            if (client_id) filter.client_id = new ObjectId(client_id)
            return model.find(filter)
        },

        async findById(id) {
            const sprint = await model.findById(id)
            if (!sprint) return null
            const sprintJobs = await jobs.findBySprint(id)
            return {...sprint, jobs: sprintJobs.map(jobView)}
        },

        // Crea uno sprint a forfait (a consuntivo): raggruppa i job indicati, valida
        // che appartengano a progetti dello stesso cliente e non siano gia' assegnati,
        // poi fissa il prezzo forfettario e calcola il costo AI reale (rollup dei job).
        async create({client_id, job_ids, price, delivery_date, note, status}) {
            if (!client_id) throw badRequest('client_id is required')
            if (!Array.isArray(job_ids) || job_ids.length === 0) {
                throw badRequest('job_ids is required')
            }

            let clientObjId
            try {
                clientObjId = new ObjectId(client_id)
            } catch {
                throw badRequest('invalid client_id')
            }

            const client = await clients.findById(clientObjId)
            if (!client) throw notFound('client not found')

            let ids
            try {
                ids = job_ids.map((j) => new ObjectId(j))
            } catch {
                throw badRequest('invalid job id in job_ids')
            }

            const found = await jobs.findByIds(ids)
            if (found.length !== ids.length) throw badRequest('uno o piu job non esistono')

            // Mappa progetto -> cliente, per validare l'appartenenza dei job.
            const projectIds = [...new Set(found.map((j) => String(j.project_id)))].map((s) => new ObjectId(s))
            const projectDocs = await projects.findByIds(projectIds)
            const clientByProject = new Map(projectDocs.map((p) => [String(p._id), p.client_id]))

            for (const job of found) {
                if (job.sprint_id) throw badRequest(`job ${job._id} gia assegnato a uno sprint`)
                const owner = clientByProject.get(String(job.project_id))
                if (!owner || !owner.equals(clientObjId)) {
                    throw badRequest(`job ${job._id} non appartiene a un progetto di questo cliente`)
                }
            }

            const aiCostUsd = found.reduce((sum, j) => sum + (j.cost_usd ?? 0), 0)
            const cleanStatus = SPRINT_STATUSES.includes(status) ? status : 'completato'

            const res = await model.insert({
                client_id: clientObjId,
                price: toNumber(price),
                delivery_date: delivery_date ? new Date(delivery_date) : null,
                status: cleanStatus,
                note: (note ?? '').trim(),
                ai_cost_usd: aiCostUsd,
                paid: false,
                invoice_id: null,
                created_at: new Date()
            })
            const sprintId = res.insertedId

            await jobs.assignToSprint(ids, sprintId)

            return {ok: true, sprint_id: sprintId.toString(), price: toNumber(price)}
        },

        // Vista pubblica (senza auth): risolve il cliente dal token e restituisce i suoi
        // sprint (esclusi i preventivi non ancora approvati) con i lavori (job) inclusi.
        async publicByToken(token) {
            const client = await clients.findByToken(token)
            if (!client) throw notFound('cliente non trovato')

            const sprintList = await model.find({
                client_id: client._id,
                status: {$ne: 'preventivo'}
            })

            const sprintIds = sprintList.map((s) => s._id)
            const allJobs = sprintIds.length ? await jobs.findBySprintIds(sprintIds) : []
            const jobsBySprint = new Map()
            for (const job of allJobs) {
                const key = String(job.sprint_id)
                if (!jobsBySprint.has(key)) jobsBySprint.set(key, [])
                jobsBySprint.get(key).push({
                    title: job.title ?? job.clickup?.title ?? '(senza titolo)',
                    status: job.status
                })
            }

            return {
                client: {name: client.name},
                sprints: sprintList.map((s) => ({
                    _id: s._id,
                    note: s.note,
                    price: s.price,
                    status: s.status,
                    delivery_date: s.delivery_date,
                    created_at: s.created_at,
                    jobs: jobsBySprint.get(String(s._id)) ?? []
                }))
            }
        }
    }
}
