// Client per l'endpoint fatture del backoffice (admin.deplot.xyz).
// Il token si genera una tantum a mano e vive in env (INVOICE_API_TOKEN),
// come gli altri segreti del progetto. Chiamata server-to-server: nessuna CORS.

const INVOICE_API_URL = process.env.INVOICE_API_URL
const INVOICE_API_TOKEN = process.env.INVOICE_API_TOKEN

function httpError(message, statusCode) {
    const err = new Error(message)
    err.statusCode = statusCode
    return err
}

// Crea una fattura. `payload`: clientId, indt, direction, discount, note, lines[].
// number/year/amount/tax/total NON si passano: li assegna il server.
// Risposta nell'involucro {data, status, error}; ritorna l'oggetto fattura (`data`).
export async function createInvoice(payload) {
    return apiCall('/v1/invoice/create', payload)
}

// Aggiorna una fattura esistente (sostituisce le righe e ricalcola i totali).
// `number` omesso = mantiene quello esistente. Ritorna l'oggetto fattura (`data`).
export async function updateInvoice(id, payload) {
    return apiCall(`/v1/invoice/${id}/update`, payload)
}

// Chiamata POST all'API v1 Deplot, con gestione dell'involucro {data, status, error}.
// status 1 = ok (ritorna `data`); status -1 = errore (HTTP 400, throw con error.message).
async function apiCall(path, payload) {
    if (!INVOICE_API_URL) {
        throw httpError('INVOICE_API_URL non configurato', 500)
    }
    if (!INVOICE_API_TOKEN) {
        throw httpError('INVOICE_API_TOKEN non configurato', 500)
    }

    let res
    try {
        res = await fetch(`${INVOICE_API_URL}${path}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${INVOICE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })
    } catch (err) {
        throw httpError(`fattura: API non raggiungibile (${err.message})`, 502)
    }

    const text = await res.text()
    let body = null
    try {
        body = text ? JSON.parse(text) : null
    } catch {
        // risposta non-JSON: la riportiamo grezza nell'errore sotto
    }

    if (!res.ok || body?.status === -1) {
        const detail = body?.error?.message ?? body?.error?.code ?? text?.slice(0, 500) ?? `HTTP ${res.status}`
        throw httpError(`fattura rifiutata dal backoffice: ${detail}`, 502)
    }

    return body?.data ?? {}
}
