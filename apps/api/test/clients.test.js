import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import {ObjectId} from 'mongodb'
import {clientsController} from '../src/controllers/clients.controller.js'
import {clientsService, normalizeNumber} from '../src/services/clients.service.js'

function memoryDb() {
    const documents = []

    function matches(document, filter) {
        return Object.entries(filter).every(([field, expected]) => {
            const actual = document[field]
            if (expected instanceof ObjectId) return actual?.equals(expected) ?? false
            if (Array.isArray(actual)) return actual.includes(expected)
            return actual === expected
        })
    }

    const collection = {
        async createIndex() {},
        async insertOne(document) {
            if (documents.some((item) => item.external_id === document.external_id)) {
                throw Object.assign(new Error('duplicate key'), {code: 11000})
            }
            const insertedId = new ObjectId()
            documents.push({...document, _id: insertedId})
            return {insertedId}
        },
        find(filter) {
            const result = documents.filter((document) => matches(document, filter))
            return {
                sort() {
                    return {toArray: async () => [...result].sort((a, b) => a.name.localeCompare(b.name))}
                }
            }
        },
        findOne: async (filter) => documents.find((document) => matches(document, filter)) ?? null,
        async findOneAndUpdate(filter, update, options = {}) {
            let index = documents.findIndex((document) => matches(document, filter))
            if (index < 0 && options.upsert) {
                const inserted = {...update.$setOnInsert, ...update.$set, _id: new ObjectId()}
                documents.push(inserted)
                index = documents.length - 1
            }
            if (index < 0) return null

            const nextExternalId = update.$set?.external_id
            if (nextExternalId && documents.some((item, itemIndex) =>
                itemIndex !== index && item.external_id === nextExternalId)) {
                throw Object.assign(new Error('duplicate key'), {code: 11000})
            }

            documents[index] = {...documents[index], ...update.$set}
            return documents[index]
        },
        async deleteOne(filter) {
            const index = documents.findIndex((document) => matches(document, filter))
            if (index < 0) return {deletedCount: 0}
            documents.splice(index, 1)
            return {deletedCount: 1}
        }
    }

    return {collection: () => collection}
}

test('normalizes equivalent international phone numbers', () => {
    assert.equal(normalizeNumber('+39 02 1234-5678'), '+390212345678')
    assert.equal(normalizeNumber('0039 (02) 1234 5678'), '+390212345678')
    assert.equal(normalizeNumber('02 1234 5678'), '0212345678')
})

test('creates, updates and deletes a client', async () => {
    const service = clientsService(memoryDb())
    const created = await service.create({
        external_id: ' 42 ',
        name: ' Acme S.r.l. ',
        email: ' admin@acme.test ',
        numbers: ['+39 02 1234-5678', '0039 02 1234 5678']
    })

    assert.equal(created.external_id, '42')
    assert.equal(created.name, 'Acme S.r.l.')
    assert.equal(created.email, 'admin@acme.test')
    assert.deepEqual(created.numbers, ['+390212345678'])
    assert.match(created.token, /^[a-f0-9]{32}$/)

    const updated = await service.update(created._id, {
        name: 'Acme Italia',
        numbers: ['333 123 4567']
    })
    assert.equal(updated.name, 'Acme Italia')
    assert.equal(updated.external_id, '42')
    assert.deepEqual(updated.numbers, ['3331234567'])
    assert.equal(updated.token, created.token)

    assert.equal((await service.delete(created._id)).deletedCount, 1)
    assert.equal(await service.findById(created._id), null)
})

test('validates required fields and reports duplicate external ids', async () => {
    const service = clientsService(memoryDb())

    await assert.rejects(
        () => service.create({external_id: '1', name: ' '}),
        (err) => err.statusCode === 400 && err.message === 'name is required'
    )

    await service.create({external_id: '1', name: 'First'})
    await assert.rejects(
        () => service.create({external_id: '1', name: 'Second'}),
        (err) => err.statusCode === 409 && err.message === 'external_id already exists'
    )
})

test('serves the client CRUD over HTTP', async (t) => {
    const service = clientsService(memoryDb())
    const controller = clientsController({clientsService: service})
    const app = Fastify()
    app.get('/clients', controller.list)
    app.post('/clients', controller.create)
    app.get('/clients/:id', controller.get)
    app.patch('/clients/:id', controller.update)
    app.delete('/clients/:id', controller.remove)
    t.after(() => app.close())

    const createResponse = await app.inject({
        method: 'POST',
        url: '/clients',
        payload: {external_id: '99', name: 'HTTP Client', email: 'client@example.test'}
    })
    assert.equal(createResponse.statusCode, 201)
    const created = createResponse.json()

    const listResponse = await app.inject({method: 'GET', url: '/clients'})
    assert.equal(listResponse.statusCode, 200)
    assert.equal(listResponse.json().length, 1)

    const updateResponse = await app.inject({
        method: 'PATCH',
        url: `/clients/${created._id}`,
        payload: {name: 'Updated HTTP Client'}
    })
    assert.equal(updateResponse.statusCode, 200)
    assert.equal(updateResponse.json().name, 'Updated HTTP Client')

    const deleteResponse = await app.inject({method: 'DELETE', url: `/clients/${created._id}`})
    assert.equal(deleteResponse.statusCode, 200)
    assert.deepEqual(deleteResponse.json(), {ok: true})

    const missingResponse = await app.inject({method: 'GET', url: `/clients/${created._id}`})
    assert.equal(missingResponse.statusCode, 404)

    const invalidResponse = await app.inject({method: 'PATCH', url: '/clients/not-an-id', payload: {name: 'No'}})
    assert.equal(invalidResponse.statusCode, 400)
})
