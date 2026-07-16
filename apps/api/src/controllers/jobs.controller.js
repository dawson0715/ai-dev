import {ObjectId} from 'mongodb'

export function jobsController({jobsService}) {
    return {
        async list(req, reply) {
            const limit = req.query?.limit ? Number(req.query.limit) : 100
            const status = req.query?.status || undefined
            return jobsService.findAll({limit, status})
        },

        async billable(req, reply) {
            const {client_id} = req.query ?? {}
            if (!client_id) return reply.code(400).send({error: 'client_id is required'})
            try {
                return await jobsService.findBillable(client_id)
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async get(req, reply) {
            const id = new ObjectId(req.params.id)
            const job = await jobsService.findById(id)
            if (!job) return reply.code(404).send({error: 'job not found'})
            return job
        },

        async retry(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.retry(id)
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async claim(req, reply) {
            const result = await jobsService.claim()
            if (!result) return reply.code(204).send()
            return result
        },

        async update(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                const res = await jobsService.update(id, req.body ?? {})
                if (res.matchedCount === 0) return reply.code(404).send({error: 'job not found'})
                return {ok: true}
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async addComment(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.addComment(id, req.body?.text)
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
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

        async heartbeat(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.heartbeat(id)
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async merged(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.markMerged(id, req.body ?? {})
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
