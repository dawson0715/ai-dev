import {ObjectId} from 'mongodb'
import {sprintsModel} from '../models/sprints.model.js'
import {tasksModel} from '../models/tasks.model.js'
import {clientsModel} from '../models/clients.model.js'

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

export function sprintsService(db) {
    const model = sprintsModel(db)
    const tasks = tasksModel(db)
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
            const sprintTasks = await tasks.find({sprint_id: id})
            return {...sprint, tasks: sprintTasks}
        },

        // Crea uno sprint raggruppando i task indicati: validano stesso cliente,
        // non gia' assegnati; calcola il totale e li assegna allo sprint.
        async create({client_id, task_ids, note}) {
            if (!client_id) throw badRequest('client_id is required')
            if (!Array.isArray(task_ids) || task_ids.length === 0) {
                throw badRequest('task_ids is required')
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
                ids = task_ids.map((t) => new ObjectId(t))
            } catch {
                throw badRequest('invalid task id in task_ids')
            }

            const found = await tasks.findByIds(ids)
            if (found.length !== ids.length) throw badRequest('uno o piu task non esistono')

            for (const t of found) {
                if (!t.client_id.equals(clientObjId)) {
                    throw badRequest('tutti i task devono appartenere allo stesso cliente')
                }
                if (t.sprint_id) throw badRequest(`task ${t._id} gia assegnato a uno sprint`)
            }

            const total = found.reduce((sum, t) => sum + (t.price ?? 0), 0)

            const res = await model.insert({
                client_id: clientObjId,
                total,
                note: (note ?? '').trim(),
                invoice_id: null,
                created_at: new Date()
            })
            const sprintId = res.insertedId

            await tasks.assignToSprint(ids, sprintId)

            return {ok: true, sprint_id: sprintId.toString(), total}
        },

        // Vista pubblica (senza auth): risolve il cliente dal token e restituisce
        // i suoi task correnti (non completati) e gli sprint.
        async publicByToken(token) {
            const client = await clients.findByToken(token)
            if (!client) throw notFound('cliente non trovato')

            const [openTasks, sprintList] = await Promise.all([
                tasks.find({client_id: client._id, completed: false}),
                model.find({client_id: client._id})
            ])

            return {
                client: {name: client.name},
                tasks: openTasks,
                sprints: sprintList
            }
        }
    }
}
