import assert from 'node:assert/strict'
import test from 'node:test'
import {ObjectId} from 'mongodb'

process.env.GITLAB_SERVICE_ACCOUNTS = JSON.stringify({group: 'bot:token'})

const {mergeRequestsService, reviewRequestText} = await import('../src/services/mergeRequests.service.js')
const {chatsService, parseVerdict} = await import('../src/services/chats.service.js')

const project = {_id: new ObjectId(), name: 'Demo', gitlab: {url: 'https://gitlab.example.com/group/app.git', service_account: 'group'}}

function gitlabMr(iid, extra = {}) {
    return {iid, title: `MR ${iid}`, description: '', author: {username: 'mario'}, web_url: `https://gitlab/mr/${iid}`,
        source_branch: `feat/${iid}`, target_branch: 'main', state: 'opened', sha: `sha${iid}`, draft: false, ...extra}
}

// Mock minimale delle collection usate dal service.
function fakeDb({mergeRequests = [], chats = [], jobs = []} = {}) {
    const calls = {inserted: [], pushed: [], states: [], decisions: []}
    const db = {
        collection(name) {
            if (name === 'projects') return {findOne: async () => project}
            if (name === 'jobs') return {find: () => ({sort: () => ({toArray: async () => jobs})})}
            if (name === 'chats') return {
                findOne: async ({_id}) => chats.find(c => String(c._id) === String(_id)) ?? null,
                find: () => ({toArray: async () => chats}),
                insertOne: async (doc) => {
                    calls.inserted.push(doc)
                    return {insertedId: new ObjectId()}
                },
                findOneAndUpdate: async (filter, update) => {
                    calls.pushed.push({filter, update})
                    return chats.find(c => String(c._id) === String(filter._id)) ?? null
                }
            }
            return {
                findOne: async ({_id}) => mergeRequests.find(m => String(m._id) === String(_id)) ?? null,
                find: (filter) => ({sort: () => ({toArray: async () => mergeRequests.filter(m => m.state === filter.state)})}),
                findOneAndUpdate: async (filter, update) => {
                    if (filter.iid) {
                        let mr = mergeRequests.find(m => m.iid === filter.iid)
                        if (!mr) mergeRequests.push(mr = {_id: new ObjectId(), project_id: filter.project_id})
                        return Object.assign(mr, update.$set)
                    }
                    calls.decisions.push(update.$set)
                    return {...mergeRequests.find(m => String(m._id) === String(filter._id)), ...update.$set}
                },
                updateOne: async (filter, update) => {
                    calls.states.push(update.$set)
                    return {matchedCount: 1}
                }
            }
        }
    }
    return {db, calls}
}

function mockFetch(handler) {
    const original = global.fetch
    const requests = []
    global.fetch = async (url, options = {}) => {
        const request = {url: String(url), method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null}
        requests.push(request)
        const {status = 200, body} = handler(request)
        return new Response(JSON.stringify(body), {status})
    }
    return {requests, restore: () => { global.fetch = original }}
}

test('sync ignores agent MRs and drafts, queues a review chat for new external MRs', async () => {
    const gone = {_id: new ObjectId(), project_id: project._id, iid: 1, state: 'opened'}
    const {db, calls} = fakeDb({
        mergeRequests: [gone],
        jobs: [{gitlab: {branch: 'feature/TASK-1', mr_iid: 5}}]
    })
    const fetch = mockFetch(({url}) => url.endsWith('/merge_requests/1')
        ? {body: gitlabMr(1, {state: 'merged'})}
        : {body: [gitlabMr(5, {source_branch: 'feature/TASK-1'}), gitlabMr(6, {draft: true}), gitlabMr(7)]})
    try {
        const result = await mergeRequestsService(db).sync(project._id)

        assert.deepEqual(result, {open: 2, reviews_queued: 1})
        assert.equal(calls.inserted.length, 1)
        const chat = calls.inserted[0]
        assert.equal(chat.status, 'pending')
        assert.equal(chat.merge_request.iid, 7)
        assert.equal(chat.messages[0].kind, 'mr_review')
        // La MR sparita dalla lista aperta prende lo stato reale da GitLab.
        assert.ok(calls.states.some(s => s.state === 'merged'))
    } finally {
        fetch.restore()
    }
})

test('a reviewed MR is not queued again until it gets new commits', async () => {
    const chatId = new ObjectId()
    const mr = {_id: new ObjectId(), project_id: project._id, iid: 7, state: 'opened', chat_id: chatId, review: {sha: 'sha7', verdict: 'ok'}}
    const {db, calls} = fakeDb({mergeRequests: [mr], chats: [{_id: chatId, status: 'idle'}]})

    let sha = 'sha7'
    const fetch = mockFetch(() => ({body: [gitlabMr(7, {sha})]}))
    try {
        const service = mergeRequestsService(db)
        assert.equal((await service.sync(project._id)).reviews_queued, 0)

        sha = 'sha7b'
        assert.equal((await service.sync(project._id)).reviews_queued, 1)
        const {update} = calls.pushed[0]
        assert.equal(update.$push.messages.kind, 'mr_review')
        assert.match(update.$push.messages.text, /git diff sha7\.\.HEAD/)
        assert.equal(update.$set.merge_request.sha, 'sha7b')
    } finally {
        fetch.restore()
    }
})

test('review request is incremental only after a successful review of an older commit', () => {
    assert.match(reviewRequestText({iid: 3, sha: 'b'}), /completa/)
    assert.match(reviewRequestText({iid: 3, sha: 'b', review: {sha: 'a', verdict: 'ok'}}), /git diff a\.\.HEAD/)
    assert.match(reviewRequestText({iid: 3, sha: 'b', review: {sha: 'a', verdict: 'failed'}}), /completa/)
    assert.match(reviewRequestText({iid: 3, sha: 'b', review: {sha: 'b', verdict: 'ok'}}), /completa/)
})

test('merge passes the reviewed sha to GitLab and refuses unreviewed commits', async () => {
    const mr = {_id: new ObjectId(), project_id: project._id, iid: 7, state: 'opened', sha: 'new', review: {sha: 'old', verdict: 'ok'}}
    const {db, calls} = fakeDb({mergeRequests: [mr]})
    const service = mergeRequestsService(db)
    await assert.rejects(service.merge(mr._id), {statusCode: 409})

    mr.sha = 'old'
    const fetch = mockFetch(() => ({body: gitlabMr(7, {state: 'merged', sha: 'old'})}))
    try {
        await service.merge(mr._id)
        assert.equal(fetch.requests[0].method, 'PUT')
        assert.match(fetch.requests[0].url, /merge_requests\/7\/merge$/)
        assert.equal(fetch.requests[0].body.sha, 'old')
        assert.equal(calls.decisions[0].decision.action, 'merged')
        assert.equal(calls.decisions[0].state, 'merged')
    } finally {
        fetch.restore()
    }
})

test('GitLab refusals on merge become 409 with the GitLab message', async () => {
    const mr = {_id: new ObjectId(), project_id: project._id, iid: 7, state: 'opened', sha: 'a', review: {sha: 'a'}}
    const {db} = fakeDb({mergeRequests: [mr]})
    const fetch = mockFetch(() => ({status: 405, body: {message: '405 Method Not Allowed'}}))
    try {
        await assert.rejects(mergeRequestsService(db).merge(mr._id), {statusCode: 409, message: /Method Not Allowed/})
    } finally {
        fetch.restore()
    }
})

test('the reply to a review request stores sha and verdict on the merge request', async () => {
    const mrId = new ObjectId()
    const chat = {
        _id: new ObjectId(), status: 'running', merge_request_id: mrId, merge_request: {iid: 7, sha: 'abc1234'},
        messages: [{role: 'user', kind: 'mr_review', text: 'review'}]
    }
    const reviews = []
    const db = {
        collection: (name) => name === 'merge_requests'
            ? {updateOne: async (filter, update) => reviews.push({filter, review: update.$set.review})}
            : {findOne: async () => chat, updateOne: async () => ({matchedCount: 1})}
    }
    await chatsService(db).reply(chat._id, {text: '...\nVERDETTO: issues', sha: 'def5678', cost_usd: 0.4})

    assert.equal(reviews.length, 1)
    assert.equal(String(reviews[0].filter._id), String(mrId))
    assert.equal(reviews[0].review.sha, 'def5678')
    assert.equal(reviews[0].review.verdict, 'issues')
    assert.equal(reviews[0].review.cost_usd, 0.4)

    // Risposta a una domanda dell'utente: la review non cambia.
    chat.messages.push({role: 'assistant', text: 'x'}, {role: 'user', text: 'Perché?'})
    await chatsService(db).reply(chat._id, {text: 'perché sì'})
    assert.equal(reviews.length, 1)
})

test('verdict parsing tolerates markdown around the final line', () => {
    assert.equal(parseVerdict('**VERDETTO: Blocking**'), 'blocking')
    assert.equal(parseVerdict('`VERDETTO: ok`'), 'ok')
    assert.equal(parseVerdict('nessun verdetto'), 'unknown')
})
