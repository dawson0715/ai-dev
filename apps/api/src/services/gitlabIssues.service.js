import {credentialsForServiceAccount} from './gitlabAuth.js'

function apiBase(gitlabUrl) {
    const u = new URL(gitlabUrl)
    return `${u.protocol}//${u.host}`
}

function projectPath(gitlabUrl) {
    const u = new URL(gitlabUrl)
    return u.pathname.replace(/^\//, '').replace(/\.git$/, '')
}

async function resolveProjectId(base, path, token) {
    const url = `${base}/api/v4/projects/${encodeURIComponent(path)}`
    const res = await fetch(url, {headers: {'PRIVATE-TOKEN': token}})
    if (!res.ok) {
        throw new Error(`GitLab resolveProjectId ${path} failed: ${res.status} ${await res.text()}`)
    }
    const body = await res.json()
    return body.id
}

// Issue GitLab aperte del repo del progetto (sorgente alternativa a ClickUp).
// Riusa il service_account già configurato per il clone: la password del
// service account funge da personal/project access token per le REST API v4.
export async function listOpenIssues(project) {
    const {password: token} = credentialsForServiceAccount(project.gitlab?.service_account)
    const base = apiBase(project.gitlab.url)
    const path = projectPath(project.gitlab.url)

    const projectId = await resolveProjectId(base, path, token)

    const url = `${base}/api/v4/projects/${projectId}/issues?state=opened&per_page=100`
    const res = await fetch(url, {headers: {'PRIVATE-TOKEN': token}})
    if (!res.ok) {
        throw new Error(`GitLab listOpenIssues ${path} failed: ${res.status} ${await res.text()}`)
    }

    return res.json()
}
