import assert from 'node:assert/strict'
import test from 'node:test'
import {resultFromEvents, summarizeEvent} from '../src/services/agent.service.js'
import {createActivityRecorder} from '../src/services/activity.service.js'

test('summarizes assistant text, tool calls and permission denials', () => {
    assert.deepEqual(summarizeEvent({
        type: 'assistant',
        message: {content: [
            {type: 'thinking', thinking: ''},
            {type: 'text', text: ' Leggo il file '},
            {type: 'tool_use', name: 'Read', input: {file_path: '/w/src/a.js'}},
            {type: 'tool_use', name: 'Bash', input: {command: 'git log -5', description: 'log'}}
        ]}
    }), [
        {kind: 'text', text: 'Leggo il file'},
        {kind: 'tool', tool: 'Read', text: '/w/src/a.js'},
        {kind: 'tool', tool: 'Bash', text: 'git log -5'}
    ])
    assert.deepEqual(summarizeEvent({type: 'system', subtype: 'permission_denied', tool_name: 'Bash'}),
        [{kind: 'denied', tool: 'Bash', text: ''}])
    assert.deepEqual(summarizeEvent({type: 'user', message: {content: [{type: 'tool_result'}]}}), [])
})

test('reads cost and usage from the result event, falls back to assistant text', () => {
    assert.deepEqual(
        resultFromEvents({
            type: 'result', subtype: 'success', result: 'ok', session_id: 's1',
            total_cost_usd: 0.1, usage: {input_tokens: 5, output_tokens: 7}
        }, []),
        {text: 'ok', totalCostUsd: 0.1, inputTokens: 5, outputTokens: 7, sessionId: 's1', subtype: 'success', errors: []}
    )
    assert.deepEqual(resultFromEvents(null, ['a', 'b'], 's-init'),
        {text: 'a\n\nb', totalCostUsd: null, inputTokens: null, outputTokens: null, sessionId: 's-init', subtype: null, errors: []})
    // Budget superato: niente testo, ma sessione e costo restano noti.
    const budget = resultFromEvents({
        type: 'result', subtype: 'error_max_budget_usd', is_error: true, session_id: 's2',
        total_cost_usd: 0.05, errors: ['Reached maximum budget ($0.01)']
    }, [])
    assert.equal(budget.sessionId, 's2')
    assert.deepEqual(budget.errors, ['Reached maximum budget ($0.01)'])
})

test('recorder throttles flushes and sends the latest snapshot', async () => {
    const flushed = []
    const recorder = createActivityRecorder({flush: async (entries) => flushed.push(entries.map(e => e.text)), intervalMs: 20})
    recorder.push({kind: 'text', text: 'a'})
    recorder.push({kind: 'text', text: 'b'})
    assert.equal(flushed.length, 0)
    await new Promise(r => setTimeout(r, 40))
    assert.deepEqual(flushed, [['a', 'b']])

    // stop() cancella il flush pianificato e attende quelli in corso.
    recorder.push({kind: 'text', text: 'c'})
    await recorder.stop()
    await new Promise(r => setTimeout(r, 40))
    assert.equal(flushed.length, 1)
    assert.deepEqual(recorder.entries().map(e => e.text), ['a', 'b', 'c'])
})
