import assert from 'node:assert/strict'
import test from 'node:test'
import {buildChatPrompt, buildJobDraftPrompt, CHAT_PERMISSION_ARGS, chatClaudeArgs, chatRefs, isBudgetExceeded, isMissingSession, parseJobDraft} from '../src/services/chat.service.js'

const project = {name: 'Demo', gitlab: {default_branch: 'develop'}}

test('chat prompt includes history and ends with the latest question', () => {
    const prompt = buildChatPrompt({
        messages: [
            {role: 'user', text: 'Prima domanda'},
            {role: 'assistant', text: 'Prima risposta'},
            {role: 'assistant', text: '', error: 'timeout'},
            {role: 'assistant', text: '', kind: 'job_draft'},
            {role: 'user', text: 'Seconda domanda'}
        ]
    }, project)

    assert.match(prompt, /checkout di origin\/develop/)
    assert.match(prompt, /Prima risposta/)
    assert.doesNotMatch(prompt, /timeout/)
    assert.ok(prompt.trimEnd().endsWith('# Domanda\nSeconda domanda'))
})

test('chat on a job uses the job branch first and includes its context', () => {
    const job = {title: 'Aggiungi login', status: 'awaiting_merge', description: 'OAuth', gitlab: {branch: 'feature/42'}, last_response: 'Fatto'}
    const refs = chatRefs(project, job)
    assert.deepEqual(refs, ['origin/feature/42', 'origin/develop'])

    const onBranch = buildChatPrompt({messages: [{role: 'user', text: 'Perché?'}]}, project, job, {ref: refs[0]})
    assert.match(onBranch, /Titolo: Aggiungi login/)
    assert.match(onBranch, /git diff origin\/develop\.\.\.HEAD/)

    const merged = buildChatPrompt({messages: [{role: 'user', text: 'Perché?'}]}, project, job, {ref: refs[1]})
    assert.match(merged, /non è disponibile/)
})

test('direct-branch jobs do not duplicate the default branch ref', () => {
    assert.deepEqual(chatRefs(project, {gitlab: {branch: 'develop'}}), ['origin/develop'])
})

test('job draft prompt asks for JSON and parses tolerant output', () => {
    const prompt = buildJobDraftPrompt({messages: [{role: 'user', text: 'Serve un export CSV'}]}, project)
    assert.match(prompt, /SOLO con un oggetto JSON/)
    assert.match(prompt, /Serve un export CSV/)

    assert.deepEqual(parseJobDraft('```json\n{"title": "Export CSV", "description": "Dettagli"}\n```'),
        {title: 'Export CSV', description: 'Dettagli'})
    assert.equal(parseJobDraft('non so'), null)
    assert.equal(parseJobDraft('{"description": "senza titolo"}'), null)
})

test('chat permissions never allow write tools', () => {
    const allowed = CHAT_PERMISSION_ARGS.slice(
        CHAT_PERMISSION_ARGS.indexOf('--allowedTools') + 1,
        CHAT_PERMISSION_ARGS.indexOf('--disallowedTools')
    )
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash']) assert.ok(!allowed.includes(tool))
    assert.ok(!CHAT_PERMISSION_ARGS.includes('bypassPermissions'))
    assert.equal(CHAT_PERMISSION_ARGS[CHAT_PERMISSION_ARGS.indexOf('--permission-mode') + 1], 'dontAsk')
})

test('resumed prompts carry only the new question (plus a note if the code changed)', () => {
    const chat = {messages: [
        {role: 'user', text: 'Prima domanda'},
        {role: 'assistant', text: 'Prima risposta'},
        {role: 'user', text: 'Seconda domanda'}
    ]}
    assert.equal(buildChatPrompt(chat, project, null, {resumed: true}), 'Seconda domanda')

    const changed = buildChatPrompt(chat, project, null, {resumed: true, ref: 'origin/develop', codeChangedTo: 'b'.repeat(40)})
    assert.match(changed, /codice è stato aggiornato \(origin\/develop → bbbbbbbbbbbb\)/)
    assert.doesNotMatch(changed, /Prima risposta/)

    const draft = buildJobDraftPrompt(chat, project, null, {resumed: true})
    assert.match(draft, /SOLO con un oggetto JSON/)
    assert.doesNotMatch(draft, /Prima domanda/)
})

test('chat CLI args: faster model, budget cap, system rules and optional resume', () => {
    const args = chatClaudeArgs()
    assert.equal(args[args.indexOf('--model') + 1], 'sonnet')
    assert.equal(args[args.indexOf('--max-budget-usd') + 1], '1')
    assert.match(args[args.indexOf('--append-system-prompt') + 1], /sola lettura/)
    assert.ok(!args.includes('--resume'))

    const resumed = chatClaudeArgs({resumeSessionId: 's1'})
    assert.equal(resumed[resumed.indexOf('--resume') + 1], 's1')
})

test('recognizes missing sessions and budget errors from the CLI result', () => {
    assert.equal(isMissingSession({result: {errors: ['No conversation found with session ID: x']}}), true)
    assert.equal(isMissingSession(new Error('boom')), false)
    assert.equal(isBudgetExceeded({result: {subtype: 'error_max_budget_usd'}}), true)
    assert.equal(isBudgetExceeded({result: {subtype: 'success'}}), false)
})
