const MAX_ENTRIES = 200
const MAX_TEXT = 1000
const KINDS = ['text', 'tool', 'denied']

// Normalizza le voci di attività inviate dal worker (vedi
// apps/worker/src/services/agent.service.js#summarizeEvent): solo i campi
// noti, stringhe accorciate, numero di voci limitato.
export function sanitizeActivity(entries) {
    if (!Array.isArray(entries)) return []
    return entries.slice(-MAX_ENTRIES).map((entry) => ({
        kind: KINDS.includes(entry?.kind) ? entry.kind : 'text',
        ...(entry?.tool ? {tool: String(entry.tool).slice(0, 100)} : {}),
        text: String(entry?.text ?? '').slice(0, MAX_TEXT),
        at: entry?.at ? String(entry.at).slice(0, 40) : undefined
    }))
}
