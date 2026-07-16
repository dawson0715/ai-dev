import assert from 'node:assert/strict'
import test from 'node:test'
import {ObjectId} from 'mongodb'
import {projectsService} from '../src/services/projects.service.js'

function setPath(target, path, value) {
    const parts = path.split('.')
    const leaf = parts.pop()
    let current = target
    for (const part of parts) current = current[part] ??= {}
    current[leaf] = value
}

function projectsDb(initialProject = null) {
    let stored = initialProject ? structuredClone(initialProject) : null
    let inserted = null

    const collection = {
        async insertOne(doc) {
            inserted = structuredClone(doc)
            stored = {...structuredClone(doc), _id: new ObjectId()}
            return {insertedId: stored._id}
        },
        async findOne() {
            return stored ? structuredClone(stored) : null
        },
        async updateOne(_filter, update) {
            for (const [path, value] of Object.entries(update.$set)) setPath(stored, path, value)
            return {matchedCount: stored ? 1 : 0}
        }
    }

    return {
        db: {collection: () => collection},
        inserted: () => inserted,
        stored: () => stored
    }
}

test('creates a manual project without a ClickUp list', async () => {
    const fixture = projectsDb()

    await projectsService(fixture.db).create({
        name: 'Manuale',
        task_source: 'manual',
        gitlab_url: 'https://gitlab.example/acme/repo.git',
        gitlab_service_account: 'acme'
    })

    assert.equal(fixture.inserted().task_source, 'manual')
    assert.equal(fixture.inserted().clickup.list_id, null)
})

test('requires a ClickUp list only for ClickUp projects', async () => {
    const fixture = projectsDb()

    await assert.rejects(
        projectsService(fixture.db).create({name: 'ClickUp', task_source: 'clickup'}),
        (err) => err.statusCode === 400 && err.message.includes('clickup_list_id')
    )
    assert.equal(fixture.inserted(), null)
})

test('clears the ClickUp list when a project becomes manual', async () => {
    const projectId = new ObjectId()
    const fixture = projectsDb({
        _id: projectId,
        name: 'Da convertire',
        task_source: 'clickup',
        clickup: {list_id: '901234'}
    })

    await projectsService(fixture.db).update(projectId, {
        task_source: 'manual',
        clickup_list_id: '901234'
    })

    assert.equal(fixture.stored().task_source, 'manual')
    assert.equal(fixture.stored().clickup.list_id, null)
})
