import {spawn} from 'child_process'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 15 * 60 * 1000)

export async function runClaude({cwd, prompt}) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            CLAUDE_BIN,
            ['-p', prompt, '--permission-mode', 'bypassPermissions'],
            {cwd, env: process.env}
        )

        let stdout = ''
        let stderr = ''
        let timedOut = false

        const timeout = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
        }, CLAUDE_TIMEOUT_MS)

        child.stdout.on('data', d => {
            stdout += d.toString()
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
            if (timedOut) {
                reject(new Error(`claude timed out after ${CLAUDE_TIMEOUT_MS}ms`))
                return
            }
            if (code !== 0) {
                reject(new Error(`claude exited with code ${code}: ${stderr}`))
                return
            }
            resolve({stdout, stderr})
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
        ``,
        `2. DOMANDE: se ti servono chiarimenti prima di poter procedere, NON modificare`,
        `   ALCUN file. Stampa SOLO su stdout le domande in italiano, una per riga o in`,
        `   forma di elenco breve. ${questionsDestination}`,
        ``,
        `Il worker distingue i due casi guardando se ci sono modifiche al repo:`,
        `nessuna modifica = ramo domande; almeno una modifica = ramo implementazione.`
    ].join('\n')
}
