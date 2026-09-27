import {ObjectId} from 'mongodb'

function toObjectId(value) {
    try {
        return new ObjectId(value)
    } catch {
        return null
    }
}

export function chatsController({chatsService}) {
    async function handle(reply, fn) {
        try {
            return await fn()
        } catch (err) {
            if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
            throw err
        }
    }

    return {
        async listByProject(req, reply) {
            const projectId = toObjectId(req.params.id)
            if (!projectId) return reply.code(400).send({error: 'invalid project id'})
            return handle(reply, () => chatsService.findByProject(projectId, {job_id: req.query?.job_id}))
        },

        async create(req, reply) {
            const projectId = toObjectId(req.params.id)
            if (!projectId) return reply.code(400).send({error: 'invalid project id'})
            return handle(reply, () => chatsService.create(projectId, req.body ?? {}))
        },

        async get(req, reply) {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid chat id'})
            const chat = await chatsService.findById(id)
            if (!chat) return reply.code(404).send({error: 'chat not found'})
            return chat
        },

        async addMessage(req, reply) {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid chat id'})
            return handle(reply, () => chatsService.addMessage(id, req.body ?? {}))
        },

        async draftJob(req, reply) {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid chat id'})
            return handle(reply, () => chatsService.requestJobDraft(id))
        },

        async progress(req, reply) {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid chat id'})
            return chatsService.progress(id, req.body ?? {})
        },

        async claim(req, reply) {
            const result = await chatsService.claim()
            if (!result) return reply.code(204).send()
            return result
        },

        async reply(req, reply) {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid chat id'})
            return handle(reply, () => chatsService.reply(id, req.body ?? {}))
        },

        async remove(req, reply) {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid chat id'})
            const res = await chatsService.delete(id)
            if (res.deletedCount === 0) return reply.code(404).send({error: 'chat not found'})
            return {ok: true}
        }
    }
}
