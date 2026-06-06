import {ObjectId} from 'mongodb'

function parseId(value, reply) {
    try {
        return new ObjectId(value)
    } catch {
        reply.code(400).send({error: 'invalid task id'})
        return null
    }
}

function handle(err, reply) {
    if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
    throw err
}

export function tasksController({tasksService}) {
    return {
        async list(req, reply) {
            const {client_id, status} = req.query ?? {}
            return tasksService.findAll({client_id, status})
        },

        async get(req, reply) {
            const id = parseId(req.params.id, reply)
            if (!id) return
            const task = await tasksService.findById(id)
            if (!task) return reply.code(404).send({error: 'task not found'})
            return task
        },

        async create(req, reply) {
            try {
                return await tasksService.create(req.body ?? {})
            } catch (err) {
                return handle(err, reply)
            }
        },

        async update(req, reply) {
            const id = parseId(req.params.id, reply)
            if (!id) return
            try {
                return await tasksService.update(id, req.body ?? {})
            } catch (err) {
                return handle(err, reply)
            }
        },

        async remove(req, reply) {
            const id = parseId(req.params.id, reply)
            if (!id) return
            try {
                await tasksService.delete(id)
                return {ok: true}
            } catch (err) {
                return handle(err, reply)
            }
        }
    }
}
