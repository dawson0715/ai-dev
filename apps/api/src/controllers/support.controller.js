export function supportController({supportService}) {
    return {
        async ingest(req, reply) {
            try {
                return await supportService.processCalls(req.body ?? {})
            } catch (err) {
                if (err.statusCode) return reply.code(err.statusCode).send({error: err.message})
                throw err
            }
        }
    }
}
