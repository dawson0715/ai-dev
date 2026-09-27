import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import simpleGit from 'simple-git'
import {alignCheckout, createWorktree, fetchOrigin, prepareReadWorktree, resolveRef, sweepIdleWorktrees} from '../src/services/git.service.js'

const identity = {config: ['user.name=Test', 'user.email=test@example.com']}

async function commitFile(git, dir, file, content) {
    await fs.writeFile(path.join(dir, file), content)
    await git.add(file)
    await git.commit(`update ${file}`)
}

async function setup() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'read-wt-'))
    const origin = path.join(root, 'origin')
    await fs.mkdir(origin)
    const originGit = simpleGit(origin, identity)
    await originGit.init(['-b', 'main'])
    await commitFile(originGit, origin, 'a.txt', 'v1')

    const repo = path.join(root, 'cache', 'p1')
    await simpleGit().clone(origin, repo)
    return {root, origin, originGit, repo, worktrees: path.join(root, 'worktrees')}
}

test('resolveRef skips missing refs (e.g. job branch deleted after merge)', async () => {
    const {root, repo} = await setup()
    try {
        const {ref, sha} = await resolveRef(repo, ['origin/feature/x', 'origin/main'])
        assert.equal(ref, 'origin/main')
        assert.match(sha, /^[0-9a-f]{40}$/)
        await assert.rejects(resolveRef(repo, ['origin/nope']), /nessuno dei ref/)
    } finally {
        await fs.rm(root, {recursive: true, force: true})
    }
})

test('the cache checkout follows origin and frees the default branch for worktrees', async () => {
    const {root, origin, originGit, repo, worktrees} = await setup()
    try {
        const first = await resolveRef(repo, ['origin/main'])
        // Clone appena fatto: stesso commit ma su main → viene staccato.
        assert.equal(await alignCheckout(repo, first.sha), true)
        assert.equal((await simpleGit(repo).raw(['branch', '--show-current'])).trim(), '')

        // Nuovo commit su origin + fetch: riallineato; senza novità non tocca nulla.
        await commitFile(originGit, origin, 'a.txt', 'v2')
        await fetchOrigin(repo)
        const second = await resolveRef(repo, ['origin/main'])
        assert.equal(await alignCheckout(repo, second.sha), true)
        assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'v2')
        assert.equal(await alignCheckout(repo, second.sha), false)

        // Modifiche locali vengono ripulite.
        await fs.writeFile(path.join(repo, 'a.txt'), 'sporco')
        await fs.writeFile(path.join(repo, 'nuovo.txt'), 'x')
        assert.equal(await alignCheckout(repo, second.sha), true)
        assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'v2')
        await assert.rejects(fs.stat(path.join(repo, 'nuovo.txt')))

        // Con main non più checked out nel clone, un job direct_branch può aprire il worktree su main.
        await createWorktree(repo, path.join(worktrees, 'job-1'), 'main', 'main')
        assert.equal(await fs.readFile(path.join(worktrees, 'job-1', 'a.txt'), 'utf8'), 'v2')
    } finally {
        await fs.rm(root, {recursive: true, force: true})
    }
})

test('job-branch chat worktree is reused and recreated if deleted', async () => {
    const {root, repo, worktrees} = await setup()
    const wt = path.join(worktrees, 'chat-1')
    try {
        const {sha} = await resolveRef(repo, ['origin/main'])
        await prepareReadWorktree(repo, wt, sha)
        const gitFile = await fs.readFile(path.join(wt, '.git'), 'utf8')
        await prepareReadWorktree(repo, wt, sha)
        assert.equal(await fs.readFile(path.join(wt, '.git'), 'utf8'), gitFile)

        await fs.rm(wt, {recursive: true, force: true})
        await prepareReadWorktree(repo, wt, sha)
        assert.equal(await fs.readFile(path.join(wt, 'a.txt'), 'utf8'), 'v1')
    } finally {
        await fs.rm(root, {recursive: true, force: true})
    }
})

test('sweep removes only idle, non-busy chat worktrees', async () => {
    const {root, repo, worktrees} = await setup()
    try {
        const idle = path.join(worktrees, 'chat-idle')
        const busy = path.join(worktrees, 'chat-busy')
        const fresh = path.join(worktrees, 'chat-fresh')
        const {sha} = await resolveRef(repo, ['origin/main'])
        for (const wt of [idle, busy, fresh]) await prepareReadWorktree(repo, wt, sha)
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
        await fs.utimes(idle, old, old)
        await fs.utimes(busy, old, old)

        const removed = await sweepIdleWorktrees(worktrees, {prefix: 'chat-', maxIdleMs: 60 * 60 * 1000, busy: new Set([busy])})
        assert.equal(removed, 1)
        assert.deepEqual((await fs.readdir(worktrees)).sort(), ['chat-busy', 'chat-fresh'])

        const list = await simpleGit(repo).raw(['worktree', 'list'])
        assert.doesNotMatch(list, /chat-idle/)
    } finally {
        await fs.rm(root, {recursive: true, force: true})
    }
})
