import {ObjectId} from 'mongodb'
import {sprintsModel} from '../models/sprints.model.js'
import {jobsModel} from '../models/jobs.model.js'
import {projectsModel} from '../models/projects.model.js'
import {clientsModel} from '../models/clients.model.js'
import {createInvoice as createInvoiceApi, updateInvoice as updateInvoiceApi} from './invoice.service.js'

// Stato commerciale dello sprint (la voce fatturabile a costo finale).
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
// projectById (opzionale) risolve project_id -> nome progetto, per raggruppare
// i job dello sprint per progetto lato UI.
function jobView(job, projectById = new Map()) {
    const project = job.project_id ? projectById.get(String(job.project_id)) : null
    return {
        _id: job._id,
        title: job.title ?? job.clickup?.title ?? '(senza titolo)',
        status: job.status,
        url: job.clickup?.url ?? null,
        estimate: job.estimate ?? 0,
        cost_usd: job.cost_usd ?? 0,
        source: job.source ?? null,
        minutes: job.minutes ?? 0,
        project_id: job.project_id ?? null,
        project_name: project?.name ?? null,
        completed_at: job.completed_at ?? job.implemented_at ?? null,
        created_at: job.created_at
    }
}

export function sprintsService(db) {
    const model = sprintsModel(db)
    const jobs = jobsModel(db)
    const projects = projectsModel(db)
    const clients = clientsModel(db)

    // Valida un set di job da assegnare a uno sprint di un dato cliente: devono
    // esistere, non essere gia' in uno sprint, e appartenere al cliente (via
    // project_id, o direttamente via client_id per i job di supporto).
    // Condivisa tra create() e addJobs().
    async function assignValidatedJobs(clientObjId, jobIds) {
        let ids
        try {
            ids = jobIds.map((j) => new ObjectId(j))
        } catch {
            throw badRequest('invalid job id in job_ids')
        }

        const found = await jobs.findByIds(ids)
        if (found.length !== ids.length) throw badRequest('uno o piu job non esistono')

        // Mappa progetto -> cliente, per validare l'appartenenza dei job. I job di
        // supporto non hanno project_id: portano il client_id direttamente.
        const projectIds = [
            ...new Set(found.filter((j) => j.project_id).map((j) => String(j.project_id)))
        ].map((s) => new ObjectId(s))
        const projectDocs = projectIds.length ? await projects.findByIds(projectIds) : []
        const clientByProject = new Map(projectDocs.map((p) => [String(p._id), p.client_id]))

        for (const job of found) {
            if (job.sprint_id) throw badRequest(`job ${job._id} gia assegnato a uno sprint`)
            const owner = job.project_id ? clientByProject.get(String(job.project_id)) : job.client_id
            if (!owner || !owner.equals(clientObjId)) {
                throw badRequest(`job ${job._id} non appartiene a questo cliente`)
            }
        }

        return ids
    }

    // Costo finale = somma delle stime dei job dello sprint, meno lo sconto.
    // Calcolato sempre dal vivo sui job correnti (mai un numero fisso salvato),
    // cosi' resta corretto anche se si aggiungono job dopo la creazione.
    function priceFrom(subtotal, discount) {
        return Math.max(0, subtotal - toNumber(discount))
    }

    // Carica e valida sprint + cliente per una operazione di fatturazione.
    async function resolveForInvoice(sprintId) {
        const sprint = await model.findById(sprintId)
        if (!sprint) throw notFound('sprint not found')

        const sprintJobs = await jobs.findBySprint(sprintId)
        const subtotal = sprintJobs.reduce((sum, j) => sum + (j.estimate ?? 0), 0)
        const price = priceFrom(subtotal, sprint.discount)
        if (price <= 0) {
            throw badRequest('costo finale dello sprint a 0: aggiungi job con stima o rivedi lo sconto prima di fatturare')
        }

        const client = await clients.findById(sprint.client_id)
        if (!client) throw notFound('client not found')

        const clientId = Number(client.external_id)
        if (!Number.isFinite(clientId)) {
            throw badRequest('il cliente non ha un external_id numerico valido per il backoffice')
        }
        return {sprint, client, price, clientId}
    }

    // Corpo fattura Deplot (riga unica, importo gia' netto sconto). Stesso shape
    // per create e update. Lo sconto e' solo un riferimento informativo per il
    // backoffice: l'importo fatturato resta price (il "costo finale" dello sprint).
    function buildInvoicePayload({sprint, client, price, clientId}, indt) {
        const description = (sprint.note ?? '').trim() || `Sprint ${client.name ?? ''}`.trim() || 'Costo finale sprint'
        return {
            clientId,
            indt,
            direction: 1,
            discount: toNumber(sprint.discount),
            // note: max 100 caratteri lato backoffice.
            note: description.slice(0, 100),
            lines: [{description, amount: price, rate: price, time: 1}]
        }
    }

    // Salva sullo sprint i riferimenti restituiti dalla fattura (create o update).
    async function persistInvoice(sprintId, invoice, indt) {
        const invoiceId = invoice?.id ?? null
        const invoiceNumber = invoice?.number ?? null
        const invoiceYear = invoice?.year ?? null

        await model.update(sprintId, {
            invoice_id: invoiceId != null ? String(invoiceId) : null,
            invoice_number: invoiceNumber,
            invoice_year: invoiceYear,
            invoice_indt: indt,
            invoiced_at: new Date()
        })
        return {ok: true, invoice_id: invoiceId, invoice_number: invoiceNumber, invoice_year: invoiceYear, invoice}
    }

    return {
        init: () => model.init(),

        // archived: 'true' -> solo storico (sprint chiusi senza fattura); default -> solo attivi.
        // Costo finale e range date (inizio/fine) sono calcolati dal rollup dei job,
        // non salvati sullo sprint.
        async findAll({client_id, archived} = {}) {
            const filter = {archived: archived === 'true' || archived === true ? true : {$ne: true}}
            if (client_id) filter.client_id = new ObjectId(client_id)
            const sprintList = await model.find(filter)
            if (!sprintList.length) return []

            const rollups = await jobs.sprintRollups(sprintList.map((s) => s._id))
            const rollupById = new Map(rollups.map((r) => [String(r._id), r]))

            return sprintList.map((s) => {
                const r = rollupById.get(String(s._id)) ?? {total: 0, start: null, end: null}
                return {
                    ...s,
                    price: priceFrom(r.total, s.discount),
                    start_date: r.start ?? null,
                    end_date: r.end ?? null
                }
            })
        },

        async findById(id) {
            const sprint = await model.findById(id)
            if (!sprint) return null
            const sprintJobs = await jobs.findBySprint(id)

            const projectIds = [
                ...new Set(sprintJobs.filter((j) => j.project_id).map((j) => String(j.project_id)))
            ].map((s) => new ObjectId(s))
            const projectDocs = projectIds.length ? await projects.findByIds(projectIds) : []
            const projectById = new Map(projectDocs.map((p) => [String(p._id), p]))

            const viewedJobs = sprintJobs.map((j) => jobView(j, projectById))
            const subtotal = viewedJobs.reduce((sum, j) => sum + (j.estimate ?? 0), 0)
            const jobDates = viewedJobs.map((j) => j.completed_at).filter(Boolean).map((d) => new Date(d))

            return {
                ...sprint,
                jobs: viewedJobs,
                subtotal,
                price: priceFrom(subtotal, sprint.discount),
                start_date: jobDates.length ? new Date(Math.min(...jobDates)) : null,
                end_date: jobDates.length ? new Date(Math.max(...jobDates)) : null
            }
        },

        // Crea uno sprint a costo finale (a consuntivo): raggruppa i job indicati,
        // valida che appartengano a progetti dello stesso cliente e non siano gia'
        // assegnati. Il costo finale non si passa: e' sempre la somma delle stime
        // dei job assegnati, meno lo sconto.
        async create({client_id, job_ids, discount, note, status}) {
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

            const ids = await assignValidatedJobs(clientObjId, job_ids)
            const cleanStatus = SPRINT_STATUSES.includes(status) ? status : 'in_lavorazione'

            const res = await model.insert({
                client_id: clientObjId,
                discount: toNumber(discount),
                status: cleanStatus,
                note: (note ?? '').trim(),
                paid: false,
                invoice_id: null,
                archived: false,
                archived_at: null,
                created_at: new Date()
            })
            const sprintId = res.insertedId

            await jobs.assignToSprint(ids, sprintId)

            return {ok: true, sprint_id: sprintId.toString()}
        },

        // Aggiunge altri job (dello stesso cliente, fatturabili) a uno sprint gia'
        // esistente, con la stessa validazione di create(). Non permesso su sprint chiusi.
        async addJobs(sprintId, jobIds) {
            const sprint = await model.findById(sprintId)
            if (!sprint) throw notFound('sprint not found')
            if (sprint.archived) throw badRequest('sprint chiuso: non modificabile')
            if (!Array.isArray(jobIds) || jobIds.length === 0) throw badRequest('job_ids is required')

            const ids = await assignValidatedJobs(sprint.client_id, jobIds)
            await jobs.assignToSprint(ids, sprint._id)
            return {ok: true}
        },

        // Modifica i campi fatturabili dello sprint: solo sconto e nota. Il costo
        // finale non e' modificabile direttamente: cambia aggiungendo/rimuovendo job
        // o lo sconto. NON tocca la fattura su Deplot: per propagare le modifiche
        // usa updateInvoice().
        async update(sprintId, {discount, note}) {
            const sprint = await model.findById(sprintId)
            if (!sprint) throw notFound('sprint not found')
            if (sprint.archived) throw badRequest('sprint chiuso: non modificabile')

            const fields = {}
            if (discount !== undefined) fields.discount = toNumber(discount)
            if (note !== undefined) fields.note = (note ?? '').trim()
            if (Object.keys(fields).length) await model.update(sprintId, fields)
            return {ok: true}
        },

        // Chiude lo sprint senza generare fattura: i job vengono archiviati (spariscono
        // dalla pagina job, restano visibili solo dal dettaglio di questo sprint) e lo
        // sprint stesso passa nello storico. Azione non reversibile da UI.
        async close(sprintId) {
            const sprint = await model.findById(sprintId)
            if (!sprint) throw notFound('sprint not found')
            if (sprint.archived) throw badRequest('sprint gia chiuso')

            await model.update(sprintId, {archived: true, archived_at: new Date()})
            await jobs.archiveBySprint(sprint._id)
            return {ok: true}
        },

        // Genera la fattura dello sprint chiamando il backoffice (admin.deplot.xyz).
        // Costo finale = riga unica con amount = somma stime job - sconto;
        // clientId = client.external_id. Numero/anno/totali li assegna il backoffice.
        async createInvoice(sprintId) {
            const ctx = await resolveForInvoice(sprintId)
            if (ctx.sprint.invoice_id) throw badRequest('sprint gia fatturato')

            const indt = new Date().toISOString().slice(0, 10)
            // createInvoiceApi ritorna l'oggetto fattura (gia' spacchettato da {data,status}).
            const invoice = await createInvoiceApi(buildInvoicePayload(ctx, indt))
            return persistInvoice(sprintId, invoice, indt)
        },

        // Ri-sincronizza la fattura esistente su Deplot con l'attuale costo finale/nota
        // dello sprint (POST /v1/invoice/{id}/update). Mantiene numero e data originali.
        async updateInvoice(sprintId) {
            const ctx = await resolveForInvoice(sprintId)
            if (!ctx.sprint.invoice_id) throw badRequest('sprint non ancora fatturato')

            // Preserva la data (e quindi l'anno) della fattura originale.
            const indt = ctx.sprint.invoice_indt ?? new Date().toISOString().slice(0, 10)
            const invoice = await updateInvoiceApi(ctx.sprint.invoice_id, buildInvoicePayload(ctx, indt))
            return persistInvoice(sprintId, invoice, indt)
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
                jobsBySprint.get(key).push(job)
            }

            return {
                client: {name: client.name},
                sprints: sprintList.map((s) => {
                    const sJobs = jobsBySprint.get(String(s._id)) ?? []
                    const subtotal = sJobs.reduce((sum, j) => sum + (j.estimate ?? 0), 0)
                    return {
                        _id: s._id,
                        note: s.note,
                        price: priceFrom(subtotal, s.discount),
                        status: s.status,
                        archived: s.archived ?? false,
                        created_at: s.created_at,
                        jobs: sJobs.map((j) => ({
                            title: j.title ?? j.clickup?.title ?? '(senza titolo)',
                            status: j.status
                        }))
                    }
                })
            }
        }
    }
}
