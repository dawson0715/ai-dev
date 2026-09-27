const HISTORY_MESSAGES = 20
const HISTORY_MESSAGE_CHARS = 4000

// Solo tool di lettura. dontAsk nega senza prompt tutto ciò che non è in
// allowlist; i tool di scrittura sono anche esplicitamente vietati. In ogni
// caso il worktree della chat è usa-e-getta e non viene mai committato.
export const CHAT_PERMISSION_ARGS = [
    '--permission-mode', 'dontAsk',
    '--allowedTools',
    'Read', 'Grep', 'Glob',
    'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git blame:*)',
    '--disallowedTools',
    'Edit', 'Write', 'NotebookEdit'
]

const CHAT_MODEL = process.env.CLAUDE_CHAT_MODEL ?? 'sonnet'
const CHAT_MAX_BUDGET_USD = process.env.CLAUDE_CHAT_MAX_BUDGET_USD ?? '1'

// Regole della chat come system prompt aggiuntivo: passato a ogni esecuzione,
// anche quando si riprende la sessione con --resume.
export const CHAT_SYSTEM_PROMPT = [
    `Sei un assistente che risponde a domande sul codice di questo repository.`,
    `- NON modificare, creare o cancellare file: sei in sola lettura.`,
    `- Esplora il codice con gli strumenti di lettura prima di rispondere e cita i`,
    `  file rilevanti come \`percorso/file:riga\`.`,
    `- Se la risposta non si deduce dal codice, dillo esplicitamente.`,
    `- Rispondi in italiano, in Markdown.`
].join('\n')

// Argomenti CLI della chat oltre ai permessi: modello (più veloce di quello
// dei job), tetto di spesa per domanda e, se c'è, la sessione da riprendere.
export function chatClaudeArgs({resumeSessionId = null} = {}) {
    const args = ['--append-system-prompt', CHAT_SYSTEM_PROMPT]
    if (CHAT_MODEL) args.push('--model', CHAT_MODEL)
    if (Number(CHAT_MAX_BUDGET_USD) > 0) args.push('--max-budget-usd', String(CHAT_MAX_BUDGET_USD))
    if (resumeSessionId) args.push('--resume', resumeSessionId)
    return args
}

// Il CLI non trova la sessione (es. worker ridistribuito senza volume): si
// ripiega sul prompt completo con la cronologia.
export function isMissingSession(err) {
    return (err?.result?.errors ?? []).some(e => /no conversation found/i.test(e))
}

export function isBudgetExceeded(err) {
    return err?.result?.subtype === 'error_max_budget_usd'
}

function truncate(text, max) {
    const value = String(text ?? '')
    return value.length > max ? `${value.slice(0, max)}\n[...troncato]` : value
}

// Ref da cui creare il worktree della chat, in ordine di preferenza: per una
// chat su un job il suo branch (per vedere le modifiche dell'agente), poi il
// branch di default. Il branch del job può non esistere più dopo il merge.
export function chatRefs(project, job) {
    const baseBranch = project?.gitlab?.default_branch?.trim() || 'main'
    const refs = []
    if (job?.gitlab?.branch && job.gitlab.branch !== baseBranch) refs.push(`origin/${job.gitlab.branch}`)
    refs.push(`origin/${baseBranch}`)
    return refs
}

function jobSection(job, {ref, baseBranch}) {
    if (!job) return []
    const onJobBranch = job.gitlab?.branch && ref === `origin/${job.gitlab.branch}`
    const lines = [
        ``,
        `# Job di riferimento`,
        `La conversazione riguarda questo job dell'agente di sviluppo.`,
        `Titolo: ${job.title}`,
        `Stato: ${job.status}`
    ]
    if (job.gitlab?.branch) lines.push(`Branch: ${job.gitlab.branch}`)
    if (job.gitlab?.mr_url) lines.push(`Merge request: ${job.gitlab.mr_url}`)
    lines.push(``, `## Descrizione`, truncate(job.description || '(nessuna descrizione)', HISTORY_MESSAGE_CHARS))
    if (job.comments?.length) {
        lines.push(``, `## Commenti`, ...job.comments.map(c => `- ${c.text}`))
    }
    if (job.last_response) {
        lines.push(``, `## Ultima risposta dell'agente sul job`, job.last_response)
    }
    lines.push(``, onJobBranch
        ? `La directory corrente è il branch del job: le modifiche dell'agente si vedono con \`git diff origin/${baseBranch}...HEAD\`.`
        : `Il branch del job non è disponibile (probabilmente già unito): la directory corrente è ${baseBranch}.`)
    return lines
}

function historySection(messages) {
    const history = messages
        .filter(m => !m.error && m.kind !== 'job_draft')
        .slice(-HISTORY_MESSAGES)
    if (!history.length) return []
    const lines = [``, `# Conversazione`]
    for (const m of history) {
        lines.push(``, `## ${m.role === 'user' ? 'Utente' : 'Assistente'}`, truncate(m.text, HISTORY_MESSAGE_CHARS))
    }
    return lines
}

function header(project, ref) {
    return [
        `Progetto: "${project?.name ?? ''}".`,
        `La directory corrente è un checkout di ${ref}.`
    ]
}

// Nota per le domande riprese con --resume quando il checkout è cambiato
// dall'ultima risposta: i file letti in precedenza possono essere superati.
function codeChangedNote(ref, sha) {
    return [
        `[Nota: dall'ultima risposta il codice è stato aggiornato (${ref} → ${String(sha).slice(0, 12)}).`,
        `Rileggi i file se ti servono dettagli precisi.]`,
        ``
    ]
}

// Prima domanda (o sessione persa): contesto completo e cronologia nel prompt.
// Domande successive con --resume: la sessione ha già contesto, file letti e
// conversazione, quindi basta la nuova domanda.
export function buildChatPrompt(chat, project, job = null, {ref, resumed = false, codeChangedTo = null} = {}) {
    const baseBranch = project?.gitlab?.default_branch?.trim() || 'main'
    ref ??= `origin/${baseBranch}`
    const messages = chat.messages ?? []
    const question = messages[messages.length - 1]

    if (resumed) {
        return [...(codeChangedTo ? codeChangedNote(ref, codeChangedTo) : []), question?.text ?? ''].join('\n')
    }

    return [
        ...header(project, ref),
        ...jobSection(job, {ref, baseBranch}),
        ...historySection(messages.slice(0, -1)),
        ``,
        `# Domanda`,
        question?.text ?? ''
    ].join('\n')
}

const JOB_DRAFT_INSTRUCTIONS = [
    `# Compito`,
    `Dalla conversazione ricava UN task di sviluppo da affidare a un agente`,
    `AI che lavorerà su questo repository senza vedere la conversazione.`,
    `Puoi leggere il codice per rendere la descrizione precisa (file coinvolti,`,
    `comportamento atteso), ma NON modificare alcun file.`,
    ``,
    `Rispondi SOLO con un oggetto JSON, senza testo prima o dopo e senza code fence:`,
    `{"title": "<titolo breve all'imperativo, max 80 caratteri>", "description": "<descrizione completa in Markdown: contesto, cosa fare, file coinvolti, criteri di accettazione>"}`,
    `Scrivi in italiano.`
]

// Trasforma la conversazione in un task per l'agente di sviluppo.
export function buildJobDraftPrompt(chat, project, job = null, {ref, resumed = false, codeChangedTo = null} = {}) {
    const baseBranch = project?.gitlab?.default_branch?.trim() || 'main'
    ref ??= `origin/${baseBranch}`

    if (resumed) {
        return [...(codeChangedTo ? codeChangedNote(ref, codeChangedTo) : []), ...JOB_DRAFT_INSTRUCTIONS].join('\n')
    }

    return [
        ...header(project, ref),
        ``,
        ...JOB_DRAFT_INSTRUCTIONS,
        ...jobSection(job, {ref, baseBranch}),
        ...historySection(chat.messages ?? [])
    ].join('\n')
}

// Estrae {title, description} dalla risposta. Tollera code fence o testo
// attorno al JSON; null se non c'è un oggetto valido.
export function parseJobDraft(text) {
    const value = String(text ?? '')
    const start = value.indexOf('{')
    const end = value.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
        const parsed = JSON.parse(value.slice(start, end + 1))
        const title = String(parsed.title ?? '').trim()
        const description = String(parsed.description ?? '').trim()
        return title ? {title, description} : null
    } catch {
        return null
    }
}
