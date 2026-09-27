import {spawn} from 'child_process'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 15 * 60 * 1000)

const ACTIVITY_TEXT_CHARS = 500
const ACTIVITY_DETAIL_CHARS = 200

function clip(value, max) {
    const text = String(value ?? '').trim()
    return text.length > max ? `${text.slice(0, max)}…` : text
}

// Riassume un evento stream-json in voci di attività leggibili dalla UI:
// testo dell'assistente e tool usati (con il file/pattern/comando principale).
// I tool_result non vengono riportati: sono voluminosi e poco informativi.
export function summarizeEvent(event) {
    // Tool negato dai permessi (es. tentativo di scrittura in una chat in sola lettura).
    if (event?.type === 'system' && event.subtype === 'permission_denied') {
        return [{kind: 'denied', tool: event.tool_name ?? '', text: ''}]
    }
    if (event?.type !== 'assistant') return []
    const entries = []
    for (const block of event.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) {
            entries.push({kind: 'text', text: clip(block.text, ACTIVITY_TEXT_CHARS)})
        } else if (block.type === 'tool_use') {
            const input = block.input ?? {}
            const detail = input.file_path ?? input.notebook_path ?? input.pattern ?? input.command
                ?? input.path ?? input.url ?? input.description ?? ''
            entries.push({kind: 'tool', tool: block.name, text: clip(detail, ACTIVITY_DETAIL_CHARS)})
        }
    }
    return entries
}

// L'evento finale `result` di stream-json ha gli stessi campi del vecchio
// output json: {result, total_cost_usd, usage: {input_tokens, output_tokens}},
// più session_id (per --resume), subtype ed errors (es. error_max_budget_usd).
// Se manca (CLI interrotto, versione diversa) si ripiega sul testo degli
// eventi assistant, senza costo/token.
export function resultFromEvents(resultEvent, assistantTexts, sessionId = null) {
    const fallback = assistantTexts.join('\n\n')
    if (!resultEvent) {
        return {text: fallback, totalCostUsd: null, inputTokens: null, outputTokens: null, sessionId, subtype: null, errors: []}
    }
    return {
        text: typeof resultEvent.result === 'string' ? resultEvent.result : fallback,
        totalCostUsd: typeof resultEvent.total_cost_usd === 'number' ? resultEvent.total_cost_usd : null,
        inputTokens: resultEvent.usage?.input_tokens ?? null,
        outputTokens: resultEvent.usage?.output_tokens ?? null,
        sessionId: resultEvent.session_id ?? sessionId,
        subtype: resultEvent.subtype ?? null,
        errors: Array.isArray(resultEvent.errors) ? resultEvent.errors : []
    }
}

// Esegue il CLI in streaming (--output-format stream-json, che con -p richiede
// --verbose): una riga JSON per evento. `onActivity` riceve le voci di attività
// man mano, così il chiamante può mostrare il progresso e conservarlo anche se
// l'esecuzione va in timeout.
// `permissionArgs` sostituisce il default (bypassPermissions, usato dai job che
// devono modificare il repo): la chat passa una allowlist di soli tool di lettura.
// `extraArgs` (es. --model, --resume) e `env` si aggiungono a quelli di default.
// In caso di errore l'eccezione ha `err.result` con quanto noto dell'esecuzione
// (sessionId, costo, subtype/errors del CLI), anche su timeout.
export async function runClaude({
    cwd,
    prompt,
    permissionArgs = ['--permission-mode', 'bypassPermissions'],
    extraArgs = [],
    env = {},
    timeoutMs = CLAUDE_TIMEOUT_MS,
    onActivity = () => {}
}) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            CLAUDE_BIN,
            ['-p', prompt, ...permissionArgs, ...extraArgs, '--output-format', 'stream-json', '--verbose'],
            // stdin chiuso: altrimenti il CLI attende 3s dati in ingresso prima di partire.
            {cwd, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']}
        )

        let buffer = ''
        let stderr = ''
        let timedOut = false
        let resultEvent = null
        let sessionId = null
        const assistantTexts = []

        const handleLine = (line) => {
            if (!line.trim()) return
            let event
            try {
                event = JSON.parse(line)
            } catch {
                return
            }
            if (event.type === 'system' && event.subtype === 'init' && event.session_id) sessionId = event.session_id
            if (event.type === 'result') {
                resultEvent = event
                return
            }
            for (const entry of summarizeEvent(event)) {
                if (entry.kind === 'text') assistantTexts.push(entry.text)
                try {
                    onActivity(entry)
                } catch (err) {
                    console.error('onActivity failed:', err.message)
                }
            }
        }

        const timeout = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
        }, timeoutMs)

        child.stdout.on('data', d => {
            buffer += d.toString()
            let newline
            while ((newline = buffer.indexOf('\n')) !== -1) {
                handleLine(buffer.slice(0, newline))
                buffer = buffer.slice(newline + 1)
            }
        })
        child.stderr.on('data', d => {
            stderr += d.toString()
        })

        child.on('error', err => {
            clearTimeout(timeout)
            reject(err)
        })

        child.on('close', code => {
            clearTimeout(timeout)
            handleLine(buffer)
            const result = resultFromEvents(resultEvent, assistantTexts, sessionId)
            const fail = (message) => {
                const err = new Error(message)
                err.result = result
                reject(err)
            }
            if (timedOut) {
                fail(`claude timed out after ${timeoutMs}ms`)
                return
            }
            if (code !== 0) {
                // Il motivo può stare in errors[], in stderr o nel testo del
                // risultato (es. "Not logged in · Please run /login").
                const reason = result.errors.join('; ') || stderr.trim() || result.text.trim()
                fail(`claude exited with code ${code}: ${reason}`)
                return
            }
            resolve({stdout: result.text, stderr, ...result})
        })
    })
}

function pad(value) {
    return String(value).padStart(2, '0')
}

function compactUtcTimestamp(value) {
    const date = value ? new Date(value) : new Date()
    return [
        String(date.getUTCFullYear()).slice(-2),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds())
    ].join('')
}

function normalizeTaskId(value) {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'TASK'
}

export function liquibaseIdForJob(job) {
    if (job.liquibase_id) return job.liquibase_id

    const taskId = job.clickup?.task_id
        ?? (job.gitlab_issue?.iid ? `GL-${job.gitlab_issue.iid}` : null)
        ?? `JOB-${job._id}`
    return `${compactUtcTimestamp(job.created_at)}_${normalizeTaskId(taskId)}`
}

export function buildPrompt(job) {
    // I job manuali (creati da web UI) non hanno una card ClickUp/issue GitLab:
    // titolo e descrizione vivono al top level. I job importati li tengono
    // sotto `clickup` o `gitlab_issue` a seconda della sorgente.
    const source = job.clickup?.task_id ? 'clickup' : job.gitlab_issue?.issue_id ? 'gitlab_issue' : 'manual'
    const title = job.title ?? job.clickup?.title ?? job.gitlab_issue?.title ?? ''
    const description = job.description ?? job.clickup?.description ?? job.gitlab_issue?.description ?? ''
    const externalId = job.clickup?.task_id ?? job.gitlab_issue?.iid ?? ''
    const url = job.clickup?.url ?? job.gitlab_issue?.url ?? ''

    const headers = {
        clickup: [
            `Stai lavorando su un task ClickUp.`,
            ``,
            `# Task`,
            `ID: ${externalId}`,
            `URL: ${url}`,
            `Titolo: ${title}`
        ],
        gitlab_issue: [
            `Stai lavorando su una issue GitLab.`,
            ``,
            `# Task`,
            `Issue: #${externalId}`,
            `URL: ${url}`,
            `Titolo: ${title}`
        ],
        manual: [
            `Stai lavorando su un task di sviluppo creato manualmente.`,
            ``,
            `# Task`,
            `Titolo: ${title}`
        ]
    }
    const header = headers[source]

    const questionsDestination = source === 'clickup'
        ? `Saranno postate come commento sul task ClickUp.`
        : `Saranno salvate nel log del job e visibili dalla web UI.`

    const comments = job.comments?.length
        ? [``, `## Commenti aggiuntivi`, ...job.comments.map(c => `- ${c.text}`)]
        : []
    const liquibaseId = liquibaseIdForJob(job)

    return [
        ...header,
        ``,
        `## Descrizione`,
        description || '(nessuna descrizione)',
        ...comments,
        ``,
        `# Istruzioni`,
        `## Migrazioni Liquibase`,
        `Se il task richiede una nuova migrazione, usa l'identificativo assegnato`,
        `\`${liquibaseId}\` come prefisso immutabile. Per esempio:`,
        `\`${liquibaseId}_descrizione_breve.sql\` e changeset`,
        `\`--changeset ai-worker:${liquibaseId}\`. Non aggiungere millisecondi, non`,
        `rigenerare il timestamp e non modificare changeset già applicati. Mantieni il`,
        `formato Liquibase già usato dal progetto se non è SQL formatted.`,
        ``,
        `Hai due strade possibili, mutuamente esclusive:`,
        ``,
        `1. IMPLEMENTAZIONE: se il task è chiaro, modifica i file necessari nel repo corrente.`,
        `   NON eseguire commit, push o branch: ci pensa il worker dopo che esci.`,
        `   Alla fine della tua risposta aggiungi una riga nel formato esatto`,
        `   \`STIMA_MINUTI: <numero intero>\`, che rappresenta quanti minuti`,
        `   impiegherebbe uno sviluppatore umano esperto a svolgere questo task`,
        `   manualmente, senza assistenza AI. Usata per calcolare il costo del task.`,
        ``,
        `2. DOMANDE: se ti servono chiarimenti prima di poter procedere, NON modificare`,
        `   ALCUN file. Stampa SOLO su stdout le domande in italiano, una per riga o in`,
        `   forma di elenco breve. ${questionsDestination} Non aggiungere STIMA_MINUTI`,
        `   in questo caso.`,
        ``,
        `Il worker distingue i due casi guardando se ci sono modifiche al repo:`,
        `nessuna modifica = ramo domande; almeno una modifica = ramo implementazione.`
    ].join('\n')
}

// Estrae la stima minuti dall'output di Claude (ultima occorrenza, se ce ne
// fosse più di una). null se assente o non valida.
export function parseEstimatedMinutes(stdout) {
    const matches = [...String(stdout ?? '').matchAll(/STIMA_MINUTI:\s*(\d+)/gi)]
    if (!matches.length) return null
    const value = Number(matches[matches.length - 1][1])
    return Number.isFinite(value) && value > 0 ? value : null
}
