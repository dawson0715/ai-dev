import assert from 'node:assert/strict'
import test from 'node:test'
import {parseServiceAccountMap, serviceAccountNames} from '../src/services/gitlabAuth.js'

test('lists only sorted GitLab service account names', () => {
    const accounts = parseServiceAccountMap(JSON.stringify({
        'zeta-10': 'user:secret-z',
        alpha: 'secret-a',
        'zeta-2': 'user:secret-b'
    }))

    assert.deepEqual(serviceAccountNames(accounts), ['alpha', 'zeta-2', 'zeta-10'])
})

test('rejects malformed GitLab service account maps', () => {
    assert.throws(() => parseServiceAccountMap('[]'), /oggetto JSON/)
    assert.throws(() => parseServiceAccountMap('{"acme":42}'), /nome\/stringa/)
})
