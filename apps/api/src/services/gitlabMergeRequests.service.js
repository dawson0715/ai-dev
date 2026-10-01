import {credentialsForServiceAccount} from './gitlabAuth.js'

// REST API v4 del repo del progetto, indirizzato per path URL-encoded (nessuna
// risoluzione dell'id numerico). Stessa auth del clone: la password del
// service account funge da access token.
function projectApiUrl(project) {
    const u = new URL(project.gitlab.url)
    const path = u.pathname.replace(/^\//, '').replace(/\.git$/, '')
    return `${u.protocol}//${u.host}/api/v4/projects/${encodeURIComponent(path)}`
}

async function gitlabRequest(project, method, path, body) {
    const {password: token} = credentialsForServiceAccount(project.gitlab?.service_account)
    const res = await fetch(`${projectApiUrl(project)}${path}`, {
        method,
        headers: {
            'PRIVATE-TOKEN': token,
            ...(body ? {'Content-Type': 'application/json'} : {})
        },
        body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    if (!res.ok) {
        let message = text
        try {
            message = JSON.parse(text).message ?? text
        } catch {}
        const err = new Error(`GitLab ${method} ${path} failed: ${res.status} ${typeof message === 'string' ? message : JSON.stringify(message)}`)
        err.status = res.status
        throw err
    }
    return text ? JSON.parse(text) : null
}

// Campi della MR salvati in `merge_requests`.
export function mergeRequestView(mr) {
    return {
        iid: mr.iid,
        title: mr.title ?? '',
        description: mr.description ?? '',
        author: mr.author?.username ?? mr.author?.name ?? '',
        web_url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        draft: mr.draft === true || mr.work_in_progress === true,
        state: mr.state,
        sha: mr.sha,
        has_conflicts: mr.has_conflicts === true,
        merge_status: mr.detailed_merge_status ?? mr.merge_status ?? null
    }
}

export async function listOpenMergeRequests(project) {
    const mrs = await gitlabRequest(project, 'GET', '/merge_requests?state=opened&per_page=100')
    return mrs.map(mergeRequestView)
}

export async function getMergeRequest(project, iid) {
    return mergeRequestView(await gitlabRequest(project, 'GET', `/merge_requests/${iid}`))
}

// `sha`: GitLab rifiuta il merge se la MR ha ricevuto commit dopo quello
// revisionato.
export async function mergeMergeRequest(project, iid, sha) {
    return mergeRequestView(await gitlabRequest(project, 'PUT', `/merge_requests/${iid}/merge`, {
        sha,
        should_remove_source_branch: true
    }))
}

export async function closeMergeRequest(project, iid) {
    return mergeRequestView(await gitlabRequest(project, 'PUT', `/merge_requests/${iid}`, {state_event: 'close'}))
}
