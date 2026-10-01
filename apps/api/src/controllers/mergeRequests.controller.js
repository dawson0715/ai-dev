import {ObjectId} from 'mongodb'

function toObjectId(value) {
    try {
        return new ObjectId(value)
    } catch {
        return null
    }
}

export function mergeRequestsController({mergeRequestsService}) {
    async function handle(reply, fn) {
        try {
            return await fn()
        } catch (err) {
            if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
            throw err
        }
    }

    function withProject(fn) {
        return async (req, reply) => {
            const projectId = toObjectId(req.params.id)
            if (!projectId) return reply.code(400).send({error: 'invalid project id'})
            return handle(reply, () => fn(projectId))
        }
    }

    function withMergeRequest(fn) {
        return async (req, reply) => {
            const id = toObjectId(req.params.id)
            if (!id) return reply.code(400).send({error: 'invalid merge request id'})
            return handle(reply, () => fn(id))
        }
    }

    return {
        listByProject: withProject((projectId) => mergeRequestsService.listByProject(projectId)),
        sync: withProject((projectId) => mergeRequestsService.sync(projectId)),
        get: withMergeRequest((id) => mergeRequestsService.get(id)),
        review: withMergeRequest((id) => mergeRequestsService.review(id)),
        merge: withMergeRequest((id) => mergeRequestsService.merge(id)),
        close: withMergeRequest((id) => mergeRequestsService.close(id))
    }
}
