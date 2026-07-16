import assert from 'node:assert/strict'
import test from 'node:test'
import {sortByClientName} from './projectSort.js'

test('sorts projects by client and then by project name', () => {
    const projects = [
        {_id: '1', client_id: 'b', name: 'Zulu'},
        {_id: '2', client_id: 'a', name: 'Web 10'},
        {_id: '3', client_id: null, name: 'Beta'},
        {_id: '4', client_id: 'a', name: 'web 2'},
        {_id: '5', client_id: 'b', name: 'Alpha'},
        {_id: '6', client_id: null, name: 'Alfa'}
    ]

    const sorted = sortByClientName(projects, {a: 'Acme', b: 'Beta'})

    assert.deepEqual(sorted.map((project) => project._id), ['4', '2', '5', '1', '6', '3'])
    assert.deepEqual(projects.map((project) => project._id), ['1', '2', '3', '4', '5', '6'])
})
