import {randomBytes} from 'node:crypto'
import {clientsModel} from '../models/clients.model.js'

function genToken() {
    return randomBytes(16).toString('hex')
}

export function clientsService(db) {
    const model = clientsModel(db)

    return {
        init: () => model.init(),

        findAll: () => model.findAll(),

        findById: (id) => model.findById(id),

        findByToken: (token) => model.findByToken(token),

        // Chiamato dal vecchio backoffice quando un cliente viene creato o aggiornato.
        // Idempotente sull'external_id; il token viene generato solo al primo insert.
        async upsert({external_id, name, email}) {
            const externalId = String(external_id ?? '').trim()
            if (!externalId) {
                const err = new Error('external_id is required')
                err.statusCode = 400
                throw err
            }

            const now = new Date()
            const res = await model.upsertByExternalId(
                externalId,
                {
                    name: (name ?? '').trim(),
                    email: (email ?? '').trim(),
                    updated_at: now
                },
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
