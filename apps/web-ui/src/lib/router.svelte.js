function parse(hash) {
    const raw = (hash || '#/').replace(/^#/, '') || '/'
    const [path, qs] = raw.split('?')
    const params = {}
    if (qs) {
        for (const [k, v] of new URLSearchParams(qs).entries()) params[k] = v
    }
    return {path, params}
}

class Router {
    current = $state(parse(window.location.hash))

    constructor() {
        window.addEventListener('hashchange', () => {
            this.current = parse(window.location.hash)
        })
    }

    navigate(path) {
        window.location.hash = path
    }
}

export const router = new Router()

export function go(path) {
    router.navigate(path)
}

export function matchRoute() {
    const {path} = router.current
    const segments = path.split('/').filter(Boolean)
    return segments
}
