const MAX_ENTRIES = 200
const LIVE_ENTRIES = 50

// Raccoglie le voci di attività di un'esecuzione Claude e le invia all'API
// al massimo ogni `intervalMs` (non a ogni evento, per non martellare Mongo).
// Ogni flush invia le ultime LIVE_ENTRIES voci: sostituzione, non append,
// quindi un flush perso non lascia buchi. `stop()` va atteso prima di
// completare job/chat, così un flush tardivo non arriva dopo la chiusura.
export function createActivityRecorder({flush, intervalMs = 2500}) {
    const entries = []
    let dirty = false
    let timer = null
    let pending = Promise.resolve()

    function doFlush() {
        timer = null
        if (!dirty) return
        dirty = false
        const snapshot = entries.slice(-LIVE_ENTRIES)
        pending = pending
            .then(() => flush(snapshot))
            .catch((err) => console.error('activity flush failed:', err.message))
    }

    return {
        push(entry) {
            entries.push({...entry, at: new Date().toISOString()})
            if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
            dirty = true
            if (!timer) timer = setTimeout(doFlush, intervalMs)
        },

        entries: () => entries.slice(),

        async stop() {
            clearTimeout(timer)
            timer = null
            await pending
        }
    }
}
