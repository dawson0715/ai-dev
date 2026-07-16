import {ObjectId} from 'mongodb'

export function clientsController({clientsService}) {
    function parseId(raw) {
        try {
            return new ObjectId(raw)
        } catch {
            return null
        }
    }

    async function handle(action, reply) {
        try {
            return await action()
        } catch (err) {
            if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
            throw err
        }
    }

    return {
        async list(req, reply) {
            return clientsService.findAll()
        },

        async get(req, reply) {
            const id = parseId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid client id'})
            const client = await clientsService.findById(id)
            if (!client) return reply.code(404).send({error: 'client not found'})
            return client
        },

        async create(req, reply) {
            try {
                const client = await clientsService.create(req.body ?? {})
                return reply.code(201).send(client)
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async update(req, reply) {
            const id = parseId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid client id'})
            let client
            try {
                client = await clientsService.update(id, req.body ?? {})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
            if (!client) return reply.code(404).send({error: 'client not found'})
            return client
        },

        async remove(req, reply) {
            const id = parseId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid client id'})
            const result = await clientsService.delete(id)
            if (result.deletedCount === 0) return reply.code(404).send({error: 'client not found'})
            return {ok: true}
        },

        async upsert(req, reply) {
            return handle(() => clientsService.upsert(req.body ?? {}), reply)
        }
    }
}
