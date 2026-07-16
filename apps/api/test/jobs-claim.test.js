import assert from 'node:assert/strict'
import test from 'node:test'
import {ObjectId} from 'mongodb'
import {jobsService} from '../src/services/jobs.service.js'

function cursor(result) {
    return {toArray: async () => result}
}

test('skips a project slot won by another executor and claims another project', async () => {
    const first = {_id: new ObjectId(), project_id: new ObjectId(), status: 'pending', liquibase_id: '260716143522_TASK-1'}
    const second = {_id: new ObjectId(), project_id: new ObjectId(), status: 'pending', liquibase_id: '260716143522_TASK-2'}
    const claimedSecond = {...second, status: 'running', project_slot: true}
    const project = {_id: second.project_id, name: 'second'}

    const jobsCollection = {
        distinct: async () => [],
        aggregate: () => cursor([first, second]),
        updateMany: async () => ({modifiedCount: 0}),
        findOneAndUpdate: async (filter) => {
            if (filter._id.equals(first._id)) throw Object.assign(new Error('duplicate slot'), {code: 11000})
            return claimedSecond
        }
    }
    const projectsCollection = {
        findOne: async (filter) => filter._id.equals(project._id) ? project : null
    }
    const db = {
        collection: (name) => name === 'jobs' ? jobsCollection : projectsCollection
    }

    const claimed = await jobsService(db).claim()

    assert.equal(claimed.job._id.toString(), second._id.toString())
    assert.equal(claimed.project._id.toString(), project._id.toString())
})

test('does not claim a job while one of its dependencies is pending', async () => {
    const dependencyId = new ObjectId()
    const candidate = {
        _id: new ObjectId(),
        project_id: new ObjectId(),
        status: 'pending',
        depends_on_job_ids: [dependencyId]
    }
    let claimAttempted = false
    const jobsCollection = {
        distinct: async () => [],
        aggregate: () => cursor([candidate]),
        updateMany: async () => ({modifiedCount: 0}),
        find: () => cursor([{_id: dependencyId, status: 'pending'}]),
        findOneAndUpdate: async () => {
            claimAttempted = true
            return candidate
        }
    }
    const db = {collection: () => jobsCollection}

    const claimed = await jobsService(db).claim()

    assert.equal(claimed, null)
    assert.equal(claimAttempted, false)
})
