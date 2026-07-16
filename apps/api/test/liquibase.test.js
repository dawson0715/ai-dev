import assert from 'node:assert/strict'
import test from 'node:test'
import {compactUtcTimestamp, createLiquibaseId, createNextLiquibaseId, normalizeTaskId} from '../src/liquibase.js'

test('uses YYMMDDhhmmss UTC without milliseconds', () => {
    const date = new Date('2026-07-16T14:35:22.987Z')
    assert.equal(compactUtcTimestamp(date), '260716143522')
})

test('advances one second when the project sequence would otherwise collide', () => {
    const date = new Date('2026-07-16T14:35:22.100Z')
    assert.equal(
        createNextLiquibaseId('TASK-185', '260716143522_TASK-184', date),
        '260716143523_TASK-185'
    )
})

test('keeps the task id as the uniqueness and traceability suffix', () => {
    const date = new Date('2026-07-16T14:35:22.987Z')
    assert.equal(createLiquibaseId('TASK-184', date), '260716143522_TASK-184')
    assert.equal(normalizeTaskId(' task 184/db '), 'TASK-184-DB')
})
