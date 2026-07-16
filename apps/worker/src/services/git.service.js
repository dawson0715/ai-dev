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

export async function ensureClone(project, workspace) {
    const repoPath = path.join(workspace, 'cache', project._id.toString())

    if (await isGitRepo(repoPath)) {
        return repoPath
    }

    await fs.mkdir(repoPath, {recursive: true})

    const creds = credentialsForServiceAccount(project.gitlab.service_account)
    const authedUrl = injectCredentials(project.gitlab.url, creds)
    await simpleGit().clone(authedUrl, repoPath)

    return repoPath
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
