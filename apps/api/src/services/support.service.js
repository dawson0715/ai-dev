import {clientsService} from './clients.service.js'
import {jobsModel} from '../models/jobs.model.js'

function badRequest(message) {
    const err = new Error(message)
    err.statusCode = 400
    return err
}

// duration arriva dall'app Android in secondi. La normalizzo a un intero >= 0.
function toSeconds(value) {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function supportService(db) {
    const clients = clientsService(db)
    const jobs = jobsModel(db)

    return {
        // Riceve { calls: [{number, duration, date, type}] }. Per ogni chiamata il cui
        // numero e' registrato a un cliente crea un job di supporto remoto (completed,
        // billable) con i minuti = ceil(secondi/60). Le chiamate non riconosciute vengono
        // ignorate e riportate in `unmatched`. L'ingest e' idempotente per chiamata.
        async processCalls({calls}) {
            if (!Array.isArray(calls)) throw badRequest('calls must be an array')

            const result = {received: calls.length, created: 0, duplicated: 0, unmatched: [], jobs: []}

            for (const call of calls) {
                const rawNumber = call?.number
                const number = clients.normalizeNumber(rawNumber)
                if (!number) {
                    result.unmatched.push({number: rawNumber ?? null, reason: 'invalid number'})
                    continue
                }

                const client = await clients.findByNumber(number)
                if (!client) {
                    result.unmatched.push({number, reason: 'not registered'})
                    continue
                }

                const duration = toSeconds(call?.duration)
                const minutes = duration > 0 ? Math.ceil(duration / 60) : 0
                const date = call?.date ?? null
                const type = call?.type ?? null
                const callKey = `${client._id}:${number}:${date ?? ''}:${duration}`
                const title = `Supporto remoto ${minutes} min — ${number}${date ? ` (${date})` : ''}`

                const res = await jobs.insertSupport({
                    clientId: client._id,
                    number,
                    duration,
                    minutes,
                    date,
                    type,
                    title,
                    callKey
                })

                if (res.upsertedCount > 0) {
                    result.created++
                    result.jobs.push({
                        job_id: res.upsertedId,
                        client_id: client._id,
                        number,
                        minutes
                    })
                } else {
                    result.duplicated++
                }
            }

            return result
        }
    }
}
