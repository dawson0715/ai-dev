export function healthController() {
    return {
        get(req, reply) {
            return {ok: true}
        }
    }
}
