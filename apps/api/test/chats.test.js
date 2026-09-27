import assert from 'node:assert/strict'
import test from 'node:test'
import {ObjectId} from 'mongodb'
import {chatsService} from '../src/services/chats.service.js'

function fixture({project = {_id: new ObjectId(), name: 'Demo'}, chat = null} = {}) {
    const calls = {chats: [], projects: []}
    const chats = {
        async insertOne() {
            return {insertedId: new ObjectId()}
        },
        async findOne() {
            return chat
        },
        async findOneAndUpdate(filter, update, options) {
            calls.chats.push({filter, update, options})
            return chat
        },
        async updateOne(filter, update) {
            calls.chats.push({filter, update})
            return {matchedCount: chat ? 1 : 0}
        }
    }
    const projects = {
        async findOne() {
            return project
        }
    }
    const db = {collection: (name) => (name === 'chats' ? chats : projects)}
    return {service: chatsService(db), calls}
}

test('creates a pending chat with the first user message as title', async () => {
    const {service} = fixture()
    const chat = await service.create(new ObjectId(), {text: '  Dove si gestisce il login?\naltro  '})

    assert.equal(chat.status, 'pending')
    assert.equal(chat.title, 'Dove si gestisce il login?')
    assert.deepEqual(chat.messages.map(m => m.role), ['user'])
})

test('rejects empty messages and unknown projects', async () => {
    await assert.rejects(fixture().service.create(new ObjectId(), {text: '   '}), {statusCode: 400})
    await assert.rejects(fixture({project: null}).service.create(new ObjectId(), {text: 'ciao'}), {statusCode: 404})
})

test('refuses a new message while the previous one is still waiting for a reply', async () => {
    // Il findOneAndUpdate non matcha (chat in running) ma la chat esiste → 409, non 404.
    const chat = {_id: new ObjectId(), status: 'running', messages: []}
    const db = {
        collection: () => ({
            async findOneAndUpdate() { return null },
            async findOne() { return chat }
        })
    }
    await assert.rejects(chatsService(db).addMessage(chat._id, {text: 'ancora'}), {statusCode: 409})
})

test('claim also recovers stale running chats', async () => {
    const chat = {_id: new ObjectId(), project_id: new ObjectId(), status: 'running'}
    const {service, calls} = fixture({chat})
    const result = await service.claim()

    assert.equal(result.chat, chat)
    const {filter, update} = calls.chats[0]
    assert.deepEqual(filter.$or[0], {status: 'pending'})
    assert.equal(filter.$or[1].status, 'running')
    assert.ok(filter.$or[1].claimed_at.$lt instanceof Date)
    assert.equal(update.$set.status, 'running')
})

test('a worker error marks the chat as failed', async () => {
    const {service, calls} = fixture({chat: {_id: new ObjectId()}})
    await service.reply(new ObjectId(), {text: '', error: 'boom'})

    const {filter, update} = calls.chats[0]
    assert.equal(filter.status, 'running')
    assert.equal(update.$set.status, 'failed')
    assert.equal(update.$push.messages.error, 'boom')
})

test('a chat linked to a job must belong to the same project', async () => {
    const projectId = new ObjectId()
    const job = {_id: new ObjectId(), project_id: new ObjectId(), title: 'Altro progetto'}
    const db = {
        collection: (name) => ({
            async findOne() { return name === 'jobs' ? job : {_id: projectId} },
            async insertOne() { return {insertedId: new ObjectId()} }
        })
    }
    await assert.rejects(chatsService(db).create(projectId, {text: 'ciao', job_id: String(job._id)}), {statusCode: 400})

    job.project_id = projectId
    const chat = await chatsService(db).create(projectId, {text: 'ciao', job_id: String(job._id)})
    assert.equal(chat.job_id, job._id)
    assert.equal(chat.job_title, 'Altro progetto')
})

test('claim passes a compact job context to the worker', async () => {
    const jobId = new ObjectId()
    const chat = {_id: new ObjectId(), project_id: new ObjectId(), job_id: jobId}
    const job = {
        _id: jobId, title: 'Login', status: 'awaiting_merge', gitlab: {branch: 'feature/1'},
        executions: [{response: 'vecchia'}, {response: 'x'.repeat(5000)}]
    }
    const db = {
        collection: (name) => ({
            async findOneAndUpdate() { return chat },
            async findOne() { return name === 'jobs' ? job : {_id: chat.project_id} }
        })
    }
    const result = await chatsService(db).claim()
    assert.equal(result.job.gitlab.branch, 'feature/1')
    assert.equal(result.job.last_response.length, 4000)
    assert.equal(result.job.executions, undefined)
})

test('job draft replies are stored as a structured message', async () => {
    const {service, calls} = fixture({chat: {_id: new ObjectId()}})
    await service.reply(new ObjectId(), {
        kind: 'job_draft',
        job_draft: {title: ' Export CSV ', description: 'Dettagli'},
        activity: [{kind: 'tool', tool: 'Read', text: 'a.js', extra: 'x'}]
    })

    const {update} = calls.chats[0]
    assert.equal(update.$set.status, 'idle')
    assert.deepEqual(update.$push.messages.job_draft, {title: 'Export CSV', description: 'Dettagli'})
    assert.equal(update.$push.messages.activity[0].extra, undefined)
    assert.equal(update.$unset.mode, '')
    assert.equal(update.$unset.progress, '')
})

test('reply stores the CLI session and commit for the next --resume', async () => {
    const {service, calls} = fixture({chat: {_id: new ObjectId()}})
    await service.reply(new ObjectId(), {text: 'ok', session_id: 'abc-123', sha: 'a'.repeat(40)})
    const {update} = calls.chats[0]
    assert.equal(update.$set.session_id, 'abc-123')
    assert.equal(update.$set.last_sha, 'a'.repeat(40))

    // Anche su errore (es. budget superato) la sessione resta riprendibile.
    const failed = fixture({chat: {_id: new ObjectId()}})
    await failed.service.reply(new ObjectId(), {error: 'budget', session_id: 'abc-123', sha: 'non-uno-sha'})
    assert.equal(failed.calls.chats[0].update.$set.session_id, 'abc-123')
    assert.equal(failed.calls.chats[0].update.$set.last_sha, undefined)
})
