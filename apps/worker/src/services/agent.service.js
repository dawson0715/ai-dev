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

export function buildPrompt(job) {
    const title = job.clickup?.title ?? ''
    const description = job.clickup?.description ?? ''
    const taskId = job.clickup?.task_id ?? ''
    const url = job.clickup?.url ?? ''

    return [
        `Stai lavorando su un task ClickUp.`,
        ``,
        `# Task`,
        `ID: ${taskId}`,
        `URL: ${url}`,
        `Titolo: ${title}`,
        ``,
        `## Descrizione`,
        description || '(nessuna descrizione)',
        ``,
        `# Istruzioni`,
        `Hai due strade possibili, mutuamente esclusive:`,
        ``,
        `1. IMPLEMENTAZIONE: se il task è chiaro, modifica i file necessari nel repo corrente.`,
        `   NON eseguire commit, push o branch: ci pensa il worker dopo che esci.`,
        ``,
        `2. DOMANDE: se ti servono chiarimenti prima di poter procedere, NON modificare`,
        `   ALCUN file. Stampa SOLO su stdout le domande in italiano, una per riga o in`,
        `   forma di elenco breve. Saranno postate come commento sul task ClickUp.`,
        ``,
        `Il worker distingue i due casi guardando se ci sono modifiche al repo:`,
        `nessuna modifica = ramo domande; almeno una modifica = ramo implementazione.`
    ].join('\n')
}
