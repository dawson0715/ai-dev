import assert from 'node:assert/strict'
import test from 'node:test'
import {ObjectId} from 'mongodb'
import {projectsService} from '../src/services/projects.service.js'
import {jobsService} from '../src/services/jobs.service.js'

function cursor(result) {
    const c = {sort: () => c, limit: () => c, toArray: async () => result}
    return c
}

test('lists projects without archived ones unless include_archived is set', async () => {
    const filters = []
    const db = {collection: () => ({find: (filter) => (filters.push(filter), cursor([]))})}
    const service = projectsService(db)

    await service.findAll()
    await service.findAll({include_archived: 'true'})

    assert.deepEqual(filters, [{archived: {$ne: true}}, {}])
})

test('archiving a project sets archived and archived_at', async () => {
    const id = new ObjectId()
    let updates = null
    const db = {collection: () => ({
        findOne: async () => ({_id: id, name: 'P'}),
        updateOne: async (_filter, update) => { updates = update.$set; return {matchedCount: 1} }
    })}

    await projectsService(db).update(id, {archived: true})
    assert.equal(updates.archived, true)
    assert.ok(updates.archived_at instanceof Date)

    await projectsService(db).update(id, {archived: false})
    assert.deepEqual(updates, {archived: false, archived_at: null})
})

test('hides jobs of archived projects from the job list', async () => {
    const archivedId = new ObjectId()
    let jobsFilter = null
    const db = {collection: (name) => name === 'jobs'
        ? {find: (filter) => (jobsFilter = filter, cursor([]))}
        : {distinct: async (_field, filter) => (assert.deepEqual(filter, {archived: true}), [archivedId])}}

    await jobsService(db).findAll({limit: 10})

    assert.deepEqual(jobsFilter, {archived: {$ne: true}, project_id: {$nin: [archivedId]}})
})

test('does not claim pending jobs of archived projects', async () => {
    const activeId = new ObjectId()
    const archivedId = new ObjectId()
    let match = null
    const db = {collection: (name) => name === 'jobs'
        ? {
            distinct: async () => [activeId],
            updateMany: async () => ({modifiedCount: 0}),
            aggregate: (pipeline) => (match = pipeline[0].$match, cursor([]))
        }
        : {distinct: async () => [archivedId]}}

    assert.equal(await jobsService(db).claim(), null)
    assert.deepEqual(match.project_id.$nin, [activeId, archivedId])
})

test('rejects sync of an archived project', async () => {
    const id = new ObjectId()
    const db = {collection: () => ({findOne: async () => ({_id: id, archived: true, task_source: 'clickup'})})}

    await assert.rejects(
        jobsService(db).syncProject(id),
        (err) => err.statusCode === 409 && err.message === 'project is archived'
    )
})
