import {ObjectId} from 'mongodb'
import {tasksModel} from '../models/tasks.model.js'
import {clientsModel} from '../models/clients.model.js'

export const TASK_STATUSES = ['preventivo', 'approvato', 'in_lavorazione', 'completato']

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

export function tasksService(db) {
    const model = tasksModel(db)
    const clients = clientsModel(db)

    return {
        init: () => model.init(),

        async findAll({client_id, status} = {}) {
            const filter = {}
            if (client_id) filter.client_id = new ObjectId(client_id)
            if (status) filter.status = status
            return model.find(filter)
        },

        findById: (id) => model.findById(id),

        async create({client_id, project_name, description, delivery_date, price, status}) {
            if (!client_id) throw badRequest('client_id is required')

            let clientObjId
            try {
                clientObjId = new ObjectId(client_id)
            } catch {
                throw badRequest('invalid client_id')
            }

            const client = await clients.findById(clientObjId)
            if (!client) throw notFound('client not found')

            const cleanStatus = TASK_STATUSES.includes(status) ? status : 'preventivo'
            const res = await model.insert({
                client_id: clientObjId,
                project_name: (project_name ?? '').trim(),
                description: (description ?? '').trim(),
                delivery_date: delivery_date ? new Date(delivery_date) : null,
                price: toNumber(price),
                paid: false,
                completed: false,
                sprint_id: null,
                status: cleanStatus,
                created_at: new Date()
            })
            return {ok: true, task_id: res.insertedId.toString()}
        },

        async update(id, fields) {
            const task = await model.findById(id)
            if (!task) throw notFound('task not found')

            const set = {}
            if (fields.project_name !== undefined) set.project_name = String(fields.project_name).trim()
            if (fields.description !== undefined) set.description = String(fields.description).trim()
            if (fields.delivery_date !== undefined) {
                set.delivery_date = fields.delivery_date ? new Date(fields.delivery_date) : null
            }
            if (fields.price !== undefined) set.price = toNumber(fields.price)
            if (fields.paid !== undefined) set.paid = Boolean(fields.paid)
            if (fields.completed !== undefined) set.completed = Boolean(fields.completed)
            if (fields.status !== undefined) {
                if (!TASK_STATUSES.includes(fields.status)) throw badRequest('invalid status')
                set.status = fields.status
            }

            await model.updateById(id, set)
            return model.findById(id)
        },

        async delete(id) {
            const task = await model.findById(id)
            if (!task) throw notFound('task not found')
            if (task.sprint_id) throw badRequest('task assegnato a uno sprint, non eliminabile')
            return model.deleteById(id)
        }
    }
}
