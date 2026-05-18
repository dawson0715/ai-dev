export function formatDate(value) {
    if (!value) return '—'
    const d = new Date(value)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    })
}

export function formatRelative(value) {
    if (!value) return '—'
    const d = new Date(value)
    const diff = Date.now() - d.getTime()
    const s = Math.floor(diff / 1000)
    if (s < 60) return `${s}s fa`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m fa`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h fa`
    const days = Math.floor(h / 24)
    if (days < 30) return `${days}g fa`
    return formatDate(value)
}

export const statusColors = {
    pending: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    running: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    completed: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    failed: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    awaiting_clarification: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30'
}

export function statusLabel(s) {
    if (!s) return 'unknown'
    return s.replace(/_/g, ' ')
}
