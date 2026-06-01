const BASE = import.meta.env.VITE_API_URL ?? '/api'

function buildUrl(path, query) {
    if (!query) return BASE + path
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qs.set(k, v)
    }
    const s = qs.toString()
    return s ? `${BASE}${path}?${s}` : BASE + path
}

async function request(path, {method = 'GET', body, query} = {}) {
    const res = await fetch(buildUrl(path, query), {
        method,
        headers: body ? {'Content-Type': 'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined
    })
    if (res.status === 204) return null
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
        const err = new Error(data?.error ?? `HTTP ${res.status}`)
        err.status = res.status
        throw err
    }
    return data
}

export const api = {
    health: () => request('/health'),

    projects: {
        list: () => request('/projects'),
        get: (id) => request(`/projects/${id}`),
        create: (data) => request('/projects', {method: 'POST', body: data}),
        update: (id, data) => request(`/projects/${id}`, {method: 'PATCH', body: data}),
        remove: (id) => request(`/projects/${id}`, {method: 'DELETE'}),
        jobs: (id) => request(`/projects/${id}/jobs`),
        sync: (id) => request(`/projects/${id}/jobs/sync`, {method: 'POST'})
    },

    jobs: {
        list: (params) => request('/jobs', {query: params}),
        get: (id) => request(`/jobs/${id}`),
        create: (projectId, data) => request(`/projects/${projectId}/jobs`, {method: 'POST', body: data}),
        retry: (id) => request(`/jobs/${id}/retry`, {method: 'POST'}),
        update: (id, data) => request(`/jobs/${id}`, {method: 'PATCH', body: data}),
        fail: (id, body = {}) => request(`/jobs/${id}/fail`, {method: 'POST', body})
    }
}
