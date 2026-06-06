import {ObjectId} from 'mongodb'

export function clientsController({clientsService}) {
    return {
        async list(req, reply) {
            return clientsService.findAll()
        },

        async get(req, reply) {
            let id
            try {
                id = new ObjectId(req.params.id)
            } catch {
                return reply.code(400).send({error: 'invalid client id'})
            }
            const client = await clientsService.findById(id)
            if (!client) return reply.code(404).send({error: 'client not found'})
            return client
        },

        async upsert(req, reply) {
            try {
                return await clientsService.upsert(req.body ?? {})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        }
    }
}
