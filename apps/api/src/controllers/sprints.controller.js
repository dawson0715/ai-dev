import {ObjectId} from 'mongodb'

function handle(err, reply) {
    if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
    throw err
}

export function sprintsController({sprintsService}) {
    return {
        async list(req, reply) {
            const {client_id} = req.query ?? {}
            return sprintsService.findAll({client_id})
        },

        async get(req, reply) {
            let id
            try {
                id = new ObjectId(req.params.id)
            } catch {
                return reply.code(400).send({error: 'invalid sprint id'})
            }
            const sprint = await sprintsService.findById(id)
            if (!sprint) return reply.code(404).send({error: 'sprint not found'})
            return sprint
        },

        async create(req, reply) {
            try {
                return await sprintsService.create(req.body ?? {})
            } catch (err) {
                return handle(err, reply)
            }
        },

        // Endpoint pubblico: nessuna auth, risolve il cliente dal token.
        async publicByToken(req, reply) {
            try {
                return await sprintsService.publicByToken(req.params.token)
            } catch (err) {
                return handle(err, reply)
            }
        }
    }
}
