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
