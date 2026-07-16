import {randomBytes} from 'node:crypto'
import {clientsModel} from '../models/clients.model.js'

function genToken() {
    return randomBytes(16).toString('hex')
}

function badRequest(message) {
    const err = new Error(message)
    err.statusCode = 400
    return err
}

function conflict(message) {
    const err = new Error(message)
    err.statusCode = 409
    return err
}

function requiredText(value, field) {
    const normalized = String(value ?? '').trim()
    if (!normalized) throw badRequest(`${field} is required`)
    return normalized
}

function optionalText(value) {
    return String(value ?? '').trim()
}

function normalizeNumbers(numbers) {
    const list = Array.isArray(numbers) ? numbers : [numbers]
    return [...new Set(list.map(normalizeNumber).filter(Boolean))]
}

async function translateDuplicateKey(action) {
    try {
        return await action()
    } catch (err) {
        if (err?.code === 11000) throw conflict('external_id already exists')
        throw err
    }
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

        async create({external_id, name, email, numbers} = {}) {
            const now = new Date()
            const doc = {
                external_id: requiredText(external_id, 'external_id'),
                name: requiredText(name, 'name'),
                email: optionalText(email),
                numbers: numbers === undefined ? [] : normalizeNumbers(numbers),
                token: genToken(),
                created_at: now,
                updated_at: now
            }

            const result = await translateDuplicateKey(() => model.insert(doc))
            return {...doc, _id: result.insertedId}
        },

        async update(id, fields = {}) {
            const client = await model.findById(id)
            if (!client) return null

            const allowed = {}
            if (fields.external_id !== undefined) {
                allowed.external_id = requiredText(fields.external_id, 'external_id')
            }
            if (fields.name !== undefined) allowed.name = requiredText(fields.name, 'name')
            if (fields.email !== undefined) allowed.email = optionalText(fields.email)
            if (fields.numbers !== undefined) allowed.numbers = normalizeNumbers(fields.numbers)

            if (Object.keys(allowed).length === 0) return client
            allowed.updated_at = new Date()
            return translateDuplicateKey(() => model.updateById(id, allowed))
        },

        delete: (id) => model.deleteById(id),

        // Chiamato dal vecchio backoffice quando un cliente viene creato o aggiornato.
        // Idempotente sull'external_id; il token viene generato solo al primo insert.
        async upsert({external_id, name, email, numbers} = {}) {
            const externalId = requiredText(external_id, 'external_id')

            const now = new Date()
            const set = {
                name: optionalText(name),
                email: optionalText(email),
                updated_at: now
            }
            // numbers e' opzionale: lo aggiorno solo se passato, cosi' un upsert dal
            // backoffice che non li conosce non azzera i numeri gia' registrati.
            if (numbers !== undefined) {
                set.numbers = normalizeNumbers(numbers)
            }

            return translateDuplicateKey(() =>
                model.upsertByExternalId(
                    externalId,
                    set,
                    {
                        external_id: externalId,
                        token: genToken(),
                        created_at: now
                    }
                )
            )
        }
    }
}
