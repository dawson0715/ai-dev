const API_URL = process.env.API_URL ?? 'http://localhost:3000'

async function request(method, path, body) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: body ? {'Content-Type': 'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined
    })

    if (res.status === 204) return null

    const text = await res.text()
    const json = text ? JSON.parse(text) : null

    if (!res.ok) {
        throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`)
    }

    return json
}

export function apiClient() {
    return {
        listProjects: () => request('GET', '/projects'),
        syncProjectJobs: (projectId) => request('POST', `/projects/${projectId}/jobs/sync`),
        claimJob: () => request('POST', '/jobs/claim'),
        updateJob: (jobId, fields) => request('PATCH', `/jobs/${jobId}`, fields),
        askQuestion: (jobId, payload) => request('POST', `/jobs/${jobId}/ask`, payload),
        completeJob: (jobId, payload) => request('POST', `/jobs/${jobId}/complete`, payload),
        failJob: (jobId, payload) => request('POST', `/jobs/${jobId}/fail`, payload)
    }
}
