import {ObjectId} from 'mongodb'

export function projectsController({projectsService, jobsService}) {
    return {
        async create(req, reply) {
            const result = await projectsService.create(req.body)
            return {ok: true, ...result}
        },

        async list(req, reply) {
            return projectsService.findAll()
        },

        async get(req, reply) {
            const id = new ObjectId(req.params.id)
            const project = await projectsService.findById(id)
            if (!project) return reply.code(404).send({error: 'project not found'})
            return project
        },

        async update(req, reply) {
            const id = new ObjectId(req.params.id)
            const project = await projectsService.update(id, req.body ?? {})
            if (!project) return reply.code(404).send({error: 'project not found'})
            return project
        },

        async remove(req, reply) {
            const id = new ObjectId(req.params.id)
            const res = await projectsService.delete(id)
            if (res.deletedCount === 0) return reply.code(404).send({error: 'project not found'})
            return {ok: true}
        },

        async listJobs(req, reply) {
            const id = new ObjectId(req.params.id)
            return jobsService.findByProject(id)
        },

        async createJob(req, reply) {
            const {title, description} = req.body ?? {}
            if (!title && !description) {
                return reply.code(400).send({error: 'title or description is required'})
            }

            let projectId
            try {
                projectId = new ObjectId(req.params.id)
            } catch {
                return reply.code(400).send({error: 'invalid project id'})
            }

            try {
                return await jobsService.createManual(projectId, {title, description})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        },

        async syncJobs(req, reply) {
            const id = new ObjectId(req.params.id)
            try {
                return await jobsService.syncProject(id)
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        }
    }
}
