import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'

function injectPat(url, token) {
    if (!token) return url
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
    const repoPath = path.join(workspace, 'cache', project._id.toString())

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
    const git = simpleGit(worktreePath)
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
