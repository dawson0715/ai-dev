import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'

// Identità per i commit dell'agente. Nel container non c'è git config globale,
// quindi senza questo `git commit` fallisce con "Author identity unknown".
// Iniettata come `-c user.*` sul comando, così resta scoped al commit e non
// dipende dall'HOME del container. Sovrascrivibile via env.
const GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME ?? 'AI Dev Agent'
const GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL ?? 'agent@ai-dev.local'

// Credenziali dei service account GitLab: mappa JSON { nome_service_account: "<user>:<password>" }
// passata via env GITLAB_SERVICE_ACCOUNTS. Il progetto referenzia solo il nome del service
// account (gitlab.service_account, tipicamente il path del gruppo top-level); le credenziali
// vere non sono mai salvate su Mongo. Cache in-process: una rotazione richiede il restart del worker.
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

function injectCredentials(url, {username, password}) {
    if (!password) return url
    const u = new URL(url)
    u.username = username
    u.password = password
    return u.toString()
}

async function isGitRepo(p) {
    try {
        const st = await fs.stat(path.join(p, '.git'))
        return st.isDirectory() || st.isFile()
    } catch {
        return false
    }
}

// Confronta l'URL ignorando credenziali/trailing slash: injectCredentials
// scrive user/password nell'URL del remote, quindi un confronto letterale
// darebbe sempre esito diverso da project.gitlab.url.
function normalizeRepoUrl(url) {
    try {
        const u = new URL(url)
        u.username = ''
        u.password = ''
        return u.toString().replace(/\/$/, '')
    } catch {
        return url
    }
}

async function currentOriginUrl(repoPath) {
    try {
        const url = await simpleGit(repoPath).raw(['remote', 'get-url', 'origin'])
        return url.trim()
    } catch {
        return null
    }
}

export async function ensureClone(project, workspace) {
    const repoPath = path.join(workspace, 'cache', project._id.toString())

    if (await isGitRepo(repoPath)) {
        const origin = await currentOriginUrl(repoPath)
        if (origin && normalizeRepoUrl(origin) === normalizeRepoUrl(project.gitlab.url)) {
            await refreshOriginCredentials(repoPath, origin, project)
            await detachHead(repoPath)
            return repoPath
        }
        // Il repo GitLab associato al progetto è cambiato (URL aggiornato dopo la
        // creazione): la cache in /opt/cache punta ancora al vecchio remote, va
        // rifatto il clone da zero, altrimenti i job continuano a lavorare sul
        // repository sbagliato.
        await fs.rm(repoPath, {recursive: true, force: true})
    }

    await fs.mkdir(repoPath, {recursive: true})

    const creds = credentialsForServiceAccount(project.gitlab.service_account)
    const authedUrl = injectCredentials(project.gitlab.url, creds)
    await simpleGit().clone(authedUrl, repoPath)
    await detachHead(repoPath)

    return repoPath
}

// Le credenziali sono scritte nell'URL del remote al momento del clone: dopo
// una rotazione della password in GITLAB_SERVICE_ACCOUNTS fetch e push
// fallirebbero con "Authentication failed" finché la cache non viene rifatta.
// Senza service account risolvibile si lascia il remote com'è.
async function refreshOriginCredentials(repoPath, origin, project) {
    let authedUrl
    try {
        authedUrl = injectCredentials(project.gitlab.url, credentialsForServiceAccount(project.gitlab.service_account))
    } catch {
        return
    }
    if (authedUrl !== origin) await simpleGit(repoPath).raw(['remote', 'set-url', 'origin', authedUrl])
}

// Il checkout principale del clone in cache resta in detached HEAD: un branch
// checked out qui non potrebbe essere usato da un worktree (es. i job con
// direct_branch lavorano proprio sul branch di default) e il checkout serve
// alle chat, che lo riallineano con alignCheckout.
async function detachHead(repoPath) {
    const git = simpleGit(repoPath)
    const current = (await git.raw(['branch', '--show-current'])).trim()
    if (current) await git.raw(['checkout', '--quiet', '--detach'])
}

export async function createWorktree(repoPath, worktreePath, branch, baseBranch) {
    const git = simpleGit(repoPath)
    await git.fetch('origin')
    await fs.mkdir(path.dirname(worktreePath), {recursive: true})

    const remote = await git.branch(['-r', '--list', `origin/${branch}`])
    const local = await git.branch(['--list', branch])

    if (remote.all.length > 0) {
        await git.raw(['branch', '-f', branch, `origin/${branch}`])
        await git.raw(['worktree', 'add', worktreePath, branch])
    } else if (local.all.length > 0) {
        await git.raw(['worktree', 'add', worktreePath, branch])
    } else {
        await git.raw(['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`])
    }
}

// Primo ref esistente di `refs` (in ordine di preferenza), con il suo sha.
export async function resolveRef(repoPath, refs) {
    const git = simpleGit(repoPath)
    for (const ref of refs) {
        // Con --quiet un ref inesistente esce con codice 1 senza stderr e
        // simple-git non lancia: conta solo un output non vuoto.
        const sha = (await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')).trim()
        if (sha) return {ref, sha}
    }
    throw new Error(`nessuno dei ref esiste: ${refs.join(', ')}`)
}

// Porta un checkout (principale o worktree) in detached HEAD su `sha`, solo
// se HEAD è diverso, è su un branch o ci sono modifiche locali: altrimenti
// non tocca nulla.
export async function alignCheckout(dir, sha) {
    const git = simpleGit(dir)
    const head = (await git.revparse(['HEAD'])).trim()
    const onBranch = (await git.raw(['branch', '--show-current'])).trim() !== ''
    const dirty = (await git.raw(['status', '--porcelain'])).trim() !== ''
    if (head === sha && !onBranch && !dirty) return false
    await git.raw(['checkout', '--quiet', '--detach', '--force', sha])
    await git.raw(['clean', '-fdq'])
    return true
}

// Worktree detached di sola lettura per una chat su un branch diverso dal
// default (es. branch di un job), riusato tra le domande: se esiste viene solo
// riallineato, altrimenti creato.
export async function prepareReadWorktree(repoPath, worktreePath, sha) {
    const git = simpleGit(repoPath)

    if (await isGitRepo(worktreePath)) {
        try {
            await alignCheckout(worktreePath, sha)
            await touch(worktreePath)
            return
        } catch (err) {
            // Worktree corrotto o orfano: lo ricreo da zero.
            console.error(`worktree ${worktreePath} non riusabile, lo ricreo:`, err.message)
            await git.raw(['worktree', 'remove', '--force', worktreePath]).catch(() => {})
            await fs.rm(worktreePath, {recursive: true, force: true})
        }
    }

    await fs.mkdir(path.dirname(worktreePath), {recursive: true})
    // Una directory cancellata a mano resta registrata e bloccherebbe l'add.
    await git.raw(['worktree', 'prune'])
    await git.raw(['worktree', 'add', '--detach', worktreePath, sha])
}

// Il fetch può fallire se un job sullo stesso repo sta facendo fetch in
// parallelo (lock sui ref): in quel caso si lavora sull'ultimo stato noto.
export async function fetchOrigin(repoPath) {
    try {
        await simpleGit(repoPath).fetch('origin', ['--prune'])
        return true
    } catch (err) {
        console.error(`fetch failed for ${repoPath}, uso lo stato locale:`, err.message)
        return false
    }
}

// Head di una MR in un ref locale fuori da refs/remotes, così il fetch con
// --prune non lo cancella. Funziona anche per le MR da fork. Tollerante come
// fetchOrigin: se fallisce si usa l'ultimo head noto.
export function mergeRequestRef(iid) {
    return `refs/merge-requests/${iid}/head`
}

export async function fetchMergeRequestRef(repoPath, iid) {
    const ref = mergeRequestRef(iid)
    try {
        // raw: con fetch('origin', [refspec]) simple-git mette l'array prima del
        // remote e git interpreta il refspec come nome del repository.
        await simpleGit(repoPath).raw(['fetch', 'origin', `+${ref}:${ref}`])
    } catch (err) {
        console.error(`fetch MR !${iid} failed for ${repoPath}, uso lo stato locale:`, err.message)
    }
}

// mtime della directory = ultimo utilizzo, usato dallo sweep dei worktree inattivi.
async function touch(p) {
    const now = new Date()
    await fs.utimes(p, now, now)
}

// Rimuove i worktree `<prefix>*` sotto `worktreesDir` non usati da più di
// `maxIdleMs`, saltando quelli in `busy`. Il repo proprietario si ricava dal
// file .git del worktree ("gitdir: <repo>/.git/worktrees/<nome>").
export async function sweepIdleWorktrees(worktreesDir, {prefix, maxIdleMs, busy = new Set()}) {
    let names
    try {
        names = await fs.readdir(worktreesDir)
    } catch {
        return 0
    }

    let removed = 0
    const cutoff = Date.now() - maxIdleMs
    for (const name of names) {
        if (!name.startsWith(prefix)) continue
        const worktreePath = path.join(worktreesDir, name)
        if (busy.has(worktreePath)) continue
        try {
            const st = await fs.stat(worktreePath)
            if (st.mtimeMs > cutoff) continue

            const gitFile = await fs.readFile(path.join(worktreePath, '.git'), 'utf8').catch(() => '')
            const gitdir = gitFile.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
            await fs.rm(worktreePath, {recursive: true, force: true})
            if (gitdir) {
                const repoPath = path.resolve(gitdir, '..', '..', '..')
                await simpleGit(repoPath).raw(['worktree', 'prune']).catch(() => {})
            }
            removed++
        } catch (err) {
            console.error(`sweep worktree ${worktreePath} failed:`, err.message)
        }
    }
    return removed
}

export async function removeWorktree(repoPath, worktreePath) {
    const git = simpleGit(repoPath)
    await git.raw(['worktree', 'remove', '--force', worktreePath])
}

export async function pruneWorktrees(repoPath) {
    const git = simpleGit(repoPath)
    await git.raw(['worktree', 'prune'])
}

export async function commitAll(worktreePath, message) {
    const git = simpleGit(worktreePath, {
        config: [`user.name=${GIT_AUTHOR_NAME}`, `user.email=${GIT_AUTHOR_EMAIL}`]
    })
    const status = await git.status()
    if (status.files.length === 0) return null
    await git.add(['-A'])
    await git.commit(message)
    const sha = await git.revparse(['HEAD'])
    return sha.trim()
}

export async function pushBranch(worktreePath, branch) {
    const git = simpleGit(worktreePath)
    await git.push('origin', branch, ['-u'])
}
