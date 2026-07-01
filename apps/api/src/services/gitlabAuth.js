// Risoluzione delle credenziali dei service account GitLab per l'API (usate per
// chiamare le REST API v4, es. lettura issue). Stessa mappa env e stessa logica
// di apps/worker/src/services/git.service.js#credentialsForServiceAccount:
// duplicata perché api e worker sono pacchetti npm separati.
let serviceAccountCreds

function serviceAccountMap() {
    if (serviceAccountCreds) return serviceAccountCreds
    const raw = process.env.GITLAB_SERVICE_ACCOUNTS
    if (!raw) {
        serviceAccountCreds = {}
        return serviceAccountCreds
    }
    try {
        serviceAccountCreds = JSON.parse(raw)
    } catch (err) {
        throw new Error(`GITLAB_SERVICE_ACCOUNTS non è un JSON valido: ${err.message}`)
    }
    return serviceAccountCreds
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
