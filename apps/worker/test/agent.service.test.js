import assert from 'node:assert/strict'
import test from 'node:test'
import {buildPrompt, liquibaseIdForJob} from '../src/services/agent.service.js'

test('uses the immutable Liquibase id stored on the job', () => {
    const job = {
        _id: 'job-id',
        title: 'Add a table',
        created_at: '2026-07-16T14:35:22.987Z',
        liquibase_id: '260716143522_TASK-184'
    }

    assert.equal(liquibaseIdForJob(job), '260716143522_TASK-184')
    const prompt = buildPrompt(job)
    assert.match(prompt, /260716143522_TASK-184_descrizione_breve\.sql/)
    assert.match(prompt, /--changeset ai-worker:260716143522_TASK-184/)
})

test('derives a stable legacy id without milliseconds', () => {
    const job = {
        _id: 'legacy-job',
        created_at: '2026-07-16T14:35:22.987Z',
        clickup: {task_id: 'TASK-184'}
    }

    assert.equal(liquibaseIdForJob(job), '260716143522_TASK-184')
})
