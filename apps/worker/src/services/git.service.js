import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'

function injectPat(url, token) {
    const u = new URL(url)
    u.username = 'oauth2'
    u.password = token
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
    const repoPath = path.join(workspace, 'opt/computer/cache', project._id.toString())

    if (await isGitRepo(repoPath)) {
        return repoPath
    }

    await fs.mkdir(repoPath, {recursive: true})

    const authedUrl = injectPat(project.gitlab.url, project.gitlab.token)
    await simpleGit().clone(authedUrl, repoPath)

    return repoPath
}

export async function createWorktree(repoPath, worktreePath, branch, baseBranch) {
    const git = simpleGit(repoPath)
    await git.fetch('origin', baseBranch)
    await fs.mkdir(path.dirname(worktreePath), {recursive: true})
    await git.raw(['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`])
}

export async function removeWorktree(repoPath, worktreePath) {
    const git = simpleGit(repoPath)
    await git.raw(['worktree', 'remove', '--force', worktreePath])
}

export async function commitAll(worktreePath, message) {
    const git = simpleGit(worktreePath)
    const status = await git.status()
    if (status.files.length === 0) return null
    await git.add(['-A'])
    await git.commit(message)
    const sha = await git.revparse(['HEAD'])
    return sha.trim()
}
