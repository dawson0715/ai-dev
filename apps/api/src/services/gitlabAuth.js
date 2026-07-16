// Risoluzione delle credenziali dei service account GitLab per l'API (usate per
// chiamare le REST API v4, es. lettura issue). Stessa mappa env e stessa logica
// di apps/worker/src/services/git.service.js#credentialsForServiceAccount:
// duplicata perché api e worker sono pacchetti npm separati.
let serviceAccountCreds

export function parseServiceAccountMap(raw) {
    if (!raw) return {}

    let parsed
    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        throw new Error(`GITLAB_SERVICE_ACCOUNTS non è un JSON valido: ${err.message}`)
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('GITLAB_SERVICE_ACCOUNTS deve essere un oggetto JSON')
    }
    for (const [name, credentials] of Object.entries(parsed)) {
        if (!name.trim() || typeof credentials !== 'string') {
            throw new Error('GITLAB_SERVICE_ACCOUNTS deve contenere coppie nome/stringa')
        }
    }
    return parsed
}

function serviceAccountMap() {
    if (serviceAccountCreds) return serviceAccountCreds
    serviceAccountCreds = parseServiceAccountMap(process.env.GITLAB_SERVICE_ACCOUNTS)
    return serviceAccountCreds
}

// Espone soltanto i nomi configurati, mai username/password o token.
export function serviceAccountNames(accounts = serviceAccountMap()) {
    return Object.keys(accounts).sort((a, b) =>
        a.localeCompare(b, 'it', {sensitivity: 'base', numeric: true})
    )
}

// Ritorna { username, password } per il service account. Il valore in mappa è "<user>:<password>";
// se manca il ":" l'intero valore è trattato come token con username "oauth2" (compat).
export function credentialsForServiceAccount(serviceAccount) {
    if (!serviceAccount) {
        throw new Error('Progetto senza gitlab.service_account: impossibile autenticare GitLab')
    }
    const value = serviceAccountMap()[serviceAccount]
    if (!value) {
        throw new Error(`Nessuna credenziale per il service account "${serviceAccount}" in GITLAB_SERVICE_ACCOUNTS`)
    }
    const sep = value.indexOf(':')
    if (sep === -1) return {username: 'oauth2', password: value}
    return {username: value.slice(0, sep), password: value.slice(sep + 1)}
}
