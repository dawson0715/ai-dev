import {randomBytes} from 'node:crypto'
import {clientsModel} from '../models/clients.model.js'

function genToken() {
    return randomBytes(16).toString('hex')
}

// Normalizza un numero di telefono a una forma canonica confrontabile, cosi' che lo
// stesso numero scritto in formati diversi combaci (utile per i call log Android):
//   - scarta tutto cio' che non e' una cifra (spazi, trattini, parentesi);
//   - tratta il prefisso internazionale '00' come equivalente a '+' (es. 0039 -> +39);
//   - mantiene un eventuale '+' iniziale.
// Restituisce '' se non resta nulla di valido.
export function normalizeNumber(raw) {
    const str = String(raw ?? '').trim()
    if (!str) return ''
    const intl = str.startsWith('+') || str.replace(/\D/g, '').startsWith('00')
    let digits = str.replace(/\D/g, '')
    if (!str.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2)
    return digits ? (intl ? '+' : '') + digits : ''
}

export function clientsService(db) {
    const model = clientsModel(db)

    return {
        init: () => model.init(),

        findAll: () => model.findAll(),

        findById: (id) => model.findById(id),

        findByToken: (token) => model.findByToken(token),

        normalizeNumber,

        // Risolve il cliente a partire da un numero (anche grezzo): lo normalizza e
        // cerca un cliente che lo abbia tra i propri numbers. null se non registrato.
        findByNumber(raw) {
            const number = normalizeNumber(raw)
            if (!number) return null
            return model.findByNumber(number)
        },

        // Chiamato dal vecchio backoffice quando un cliente viene creato o aggiornato.
        // Idempotente sull'external_id; il token viene generato solo al primo insert.
        async upsert({external_id, name, email, numbers}) {
            const externalId = String(external_id ?? '').trim()
            if (!externalId) {
                const err = new Error('external_id is required')
                err.statusCode = 400
                throw err
            }

            const now = new Date()
            const set = {
                name: (name ?? '').trim(),
                email: (email ?? '').trim(),
                updated_at: now
            }
            // numbers e' opzionale: lo aggiorno solo se passato, cosi' un upsert dal
            // backoffice che non li conosce non azzera i numeri gia' registrati.
            if (numbers !== undefined) {
                const list = Array.isArray(numbers) ? numbers : [numbers]
                set.numbers = [...new Set(list.map(normalizeNumber).filter(Boolean))]
            }

            const res = await model.upsertByExternalId(
                externalId,
                set,
                {
                    external_id: externalId,
                    token: genToken(),
                    created_at: now
                }
            )
            return res
        }
    }
}
