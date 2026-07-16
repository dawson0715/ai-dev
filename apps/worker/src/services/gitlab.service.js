import {credentialsForServiceAccount} from './git.service.js'

function projectApiUrl(project) {
    const url = new URL(project.gitlab.url)
    const path = url.pathname.replace(/^\//, '').replace(/\.git$/, '')
    return `${url.protocol}//${url.host}/api/v4/projects/${encodeURIComponent(path)}`
}

async function gitlabRequest(project, method, path, body) {
    const {password: token} = credentialsForServiceAccount(project.gitlab?.service_account)
    const response = await fetch(`${projectApiUrl(project)}${path}`, {
        method,
        headers: {
            'PRIVATE-TOKEN': token,
            ...(body ? {'Content-Type': 'application/json'} : {})
        },
        body: body ? JSON.stringify(body) : undefined
    })
    const text = await response.text()
    let data = null
    if (text) {
        try {
            data = JSON.parse(text)
        } catch {
            data = text
        }
    }

    if (!response.ok) {
        const error = new Error(`GitLab ${method} ${path} failed: ${response.status} ${text}`)
        error.status = response.status
        throw error
    }

    return data
}

function mergeRequestView(mr) {
    if (!mr) return null
    return {
        mr_iid: mr.iid,
        mr_url: mr.web_url,
        mr_state: mr.state,
        head_sha: mr.sha ?? null,
        merged_at: mr.merged_at ?? null,
        merge_commit_sha: mr.merge_commit_sha ?? null,
        squash_commit_sha: mr.squash_commit_sha ?? null
    }
}

export async function findMergeRequest(project, sourceBranch, targetBranch, expectedCommitSha = null) {
    const query = new URLSearchParams({
        scope: 'all',
        source_branch: sourceBranch,
        target_branch: targetBranch,
        order_by: 'updated_at',
        sort: 'desc',
        per_page: '20'
    })
    const mergeRequests = await gitlabRequest(project, 'GET', `/merge_requests?${query}`)
    const relevant = mergeRequests.find((mr) => {
        if (mr.state === 'opened') return true
        return mr.state === 'merged' && (!expectedCommitSha || mr.sha === expectedCommitSha)
    })
    return mergeRequestView(relevant)
}

export async function ensureMergeRequest({project, sourceBranch, targetBranch, title, expectedCommitSha = null}) {
    const existing = await findMergeRequest(project, sourceBranch, targetBranch, expectedCommitSha)
    if (existing) return existing

    try {
        const created = await gitlabRequest(project, 'POST', '/merge_requests', {
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title,
            remove_source_branch: true
        })
        return mergeRequestView(created)
    } catch (err) {
        // Una richiesta concorrente può aver creato la stessa MR tra GET e POST.
        if (err.status !== 409) throw err
        const raced = await findMergeRequest(project, sourceBranch, targetBranch, expectedCommitSha)
        if (raced) return raced
        throw err
    }
}

export async function getMergeRequest(project, iid) {
    const mergeRequest = await gitlabRequest(project, 'GET', `/merge_requests/${iid}`)
    return mergeRequestView(mergeRequest)
}
