import assert from 'node:assert/strict'
import test from 'node:test'

process.env.GITLAB_SERVICE_ACCOUNTS = JSON.stringify({group: 'bot:token'})

const project = {
    gitlab: {
        url: 'https://gitlab.example.com/group/project.git',
        service_account: 'group'
    }
}

test('does not reuse an already merged MR for a newer commit on the same branch', async () => {
    const originalFetch = global.fetch
    const calls = []
    global.fetch = async (url, options = {}) => {
        calls.push({url: String(url), options})
        if ((options.method ?? 'GET') === 'GET') {
            return new Response(JSON.stringify([{
                iid: 7,
                state: 'merged',
                sha: 'old-commit',
                web_url: 'https://gitlab.example.com/mr/7'
            }]), {status: 200})
        }
        return new Response(JSON.stringify({
            iid: 8,
            state: 'opened',
            sha: 'new-commit',
            web_url: 'https://gitlab.example.com/mr/8'
        }), {status: 201})
    }

    try {
        const {ensureMergeRequest} = await import('../src/services/gitlab.service.js')
        const mergeRequest = await ensureMergeRequest({
            project,
            sourceBranch: 'feature/TASK-184',
            targetBranch: 'develop',
            title: 'Task 184',
            expectedCommitSha: 'new-commit'
        })

        assert.equal(mergeRequest.mr_iid, 8)
        assert.equal(mergeRequest.head_sha, 'new-commit')
        assert.equal(calls.length, 2)
        assert.equal(calls[1].options.method, 'POST')
    } finally {
        global.fetch = originalFetch
    }
})
