import {ObjectId} from 'mongodb'

export function jobsController({jobsService}) {
    return {
        async list(req, reply) {
            const limit = req.query?.limit ? Number(req.query.limit) : 100
            return jobsService.findAll({limit})
        },

        async create(req, reply) {
            const {project_id, title, description} = req.body ?? {}
            if (!project_id) return reply.code(400).send({error: 'project_id is required'})
            if (!title && !description) {
                return reply.code(400).send({error: 'title or description is required'})
            }

            let projectId
            try {
                projectId = new ObjectId(project_id)
            } catch {
                return reply.code(400).send({error: 'invalid project_id'})
            }

            try {
                return await jobsService.createManual(projectId, {title, description})
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
