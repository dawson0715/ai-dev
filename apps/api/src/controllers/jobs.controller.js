import {ObjectId} from 'mongodb'

export function jobsController({jobsService}) {
    return {
        async claim(req, reply) {
            const result = await jobsService.claim()
            if (!result) return reply.code(204).send()
            return result
        },

        async update(req, reply) {
            const id = new ObjectId(req.params.id)
            const res = await jobsService.update(id, req.body ?? {})
            if (res.matchedCount === 0) return reply.code(404).send({error: 'job not found'})
            return {ok: true}
        },

        async ask(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.ask(id, req.body ?? {})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async complete(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.complete(id, req.body ?? {})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async fail(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.fail(id, req.body ?? {})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        }
    }
}
