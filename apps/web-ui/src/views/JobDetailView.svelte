<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatDate, formatRelative} from '../lib/format.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import Modal from '../components/Modal.svelte'

    let {jobId} = $props()

    let job = $state(null)
    let loading = $state(true)
    let actionLoading = $state(false)
    let confirmFail = $state(false)

    async function load() {
        loading = true
        try {
            job = await api.jobs.get(jobId)
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
        }
    }

    async function retry() {
        actionLoading = true
        try {
            await api.jobs.retry(jobId)
            toast.success('Job rimesso in coda')
            await load()
        } catch (e) {
            toast.error(`Retry fallito: ${e.message}`)
        } finally {
            actionLoading = false
        }
    }

    async function markFailed() {
        actionLoading = true
        try {
            await api.jobs.fail(jobId, {execution: {reason: 'manual fail from UI', failed_at: new Date()}})
            toast.success('Job marcato come failed')
            confirmFail = false
            await load()
        } catch (e) {
            toast.error(`Operazione fallita: ${e.message}`)
        } finally {
            actionLoading = false
        }
    }

    $effect(() => {
        jobId
        load()
    })

    const lastExecution = $derived(job?.executions?.[job.executions.length - 1])
</script>

<a href={job?.project_id ? `#/projects/${job.project_id}` : '#/jobs'}
   class="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
    Indietro
</a>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if !job}
    <Card>Job non trovato.</Card>
{:else}
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-2">
                <StatusBadge status={job.status}/>
                {#if job.clickup?.task_id}
                    <span class="text-xs text-slate-500 font-mono">{job.clickup.task_id}</span>
                {/if}
            </div>
            <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">{job.clickup?.title ?? '(senza titolo)'}</h1>
            {#if job.clickup?.url}
                <a href={job.clickup.url} target="_blank" rel="noopener" class="text-sm text-brand-300 hover:text-brand-200 inline-flex items-center gap-1 mt-1">
                    Apri su ClickUp
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M7 7h10v10"/></svg>
                </a>
            {/if}
        </div>
        <div class="flex flex-wrap gap-2">
            <Button variant="secondary" onclick={retry} loading={actionLoading} disabled={actionLoading || job.status === 'pending' || job.status === 'running'}>
                Retry
            </Button>
            <Button variant="danger" onclick={() => confirmFail = true} disabled={job.status === 'failed' || job.status === 'completed'}>
                Marca failed
            </Button>
        </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3 mb-6">
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Creato</div>
            <div class="mt-1 text-sm text-slate-200">{formatDate(job.created_at)}</div>
            <div class="text-xs text-slate-500">{formatRelative(job.created_at)}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Iniziato</div>
            <div class="mt-1 text-sm text-slate-200">{formatDate(job.started_at)}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Completato</div>
            <div class="mt-1 text-sm text-slate-200">{formatDate(job.completed_at)}</div>
        </Card>
    </div>

    {#if job.gitlab}
        <Card class="mb-6">
            <h2 class="font-semibold text-slate-100 mb-3">GitLab</h2>
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {#if job.gitlab.branch}
                    <div>
                        <dt class="text-slate-500 text-xs uppercase tracking-wider">Branch</dt>
                        <dd class="font-mono text-slate-200 truncate">{job.gitlab.branch}</dd>
                    </div>
                {/if}
                {#if job.gitlab.commit_sha}
                    <div>
                        <dt class="text-slate-500 text-xs uppercase tracking-wider">Commit</dt>
                        <dd class="font-mono text-slate-200 truncate">{job.gitlab.commit_sha.slice(0, 12)}</dd>
                    </div>
                {/if}
                {#if job.gitlab.mr_url}
                    <div class="sm:col-span-2">
                        <dt class="text-slate-500 text-xs uppercase tracking-wider">Merge Request</dt>
                        <dd><a href={job.gitlab.mr_url} target="_blank" rel="noopener" class="text-brand-300 hover:text-brand-200 break-all">{job.gitlab.mr_url}</a></dd>
                    </div>
                {/if}
            </dl>
        </Card>
    {/if}

    {#if job.clickup?.description}
        <Card class="mb-6">
            <h2 class="font-semibold text-slate-100 mb-3">Descrizione task</h2>
            <pre class="whitespace-pre-wrap text-sm text-slate-300 font-sans">{job.clickup.description}</pre>
        </Card>
    {/if}

    {#if lastExecution}
        <Card class="mb-6">
            <div class="flex items-center justify-between mb-3">
                <h2 class="font-semibold text-slate-100">Ultima esecuzione</h2>
                <span class="text-xs text-slate-500">{job.executions.length} totali</span>
            </div>

            {#if lastExecution.prompt}
                <details class="mb-3" open>
                    <summary class="cursor-pointer text-sm font-medium text-slate-300 hover:text-slate-100 py-1.5">Prompt</summary>
                    <pre class="mt-2 p-3 rounded-lg bg-slate-950/60 ring-1 ring-slate-800 text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto">{lastExecution.prompt}</pre>
                </details>
            {/if}

            {#if lastExecution.response}
                <details class="mb-3" open>
                    <summary class="cursor-pointer text-sm font-medium text-slate-300 hover:text-slate-100 py-1.5">Response</summary>
                    <pre class="mt-2 p-3 rounded-lg bg-slate-950/60 ring-1 ring-slate-800 text-xs text-slate-200 whitespace-pre-wrap overflow-x-auto">{lastExecution.response}</pre>
                </details>
            {/if}

            {#if lastExecution.logs?.length}
                <details>
                    <summary class="cursor-pointer text-sm font-medium text-slate-300 hover:text-slate-100 py-1.5">Logs ({lastExecution.logs.length})</summary>
                    <pre class="mt-2 p-3 rounded-lg bg-slate-950/60 ring-1 ring-slate-800 text-xs text-slate-400 whitespace-pre-wrap overflow-x-auto">{lastExecution.logs.join('\n')}</pre>
                </details>
            {/if}

            {#if lastExecution.error}
                <div class="mt-3 p-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-sm text-rose-200">
                    <div class="font-medium mb-1">Error</div>
                    <pre class="whitespace-pre-wrap text-xs">{lastExecution.error}</pre>
                </div>
            {/if}

            {#if lastExecution.input_tokens != null || lastExecution.output_tokens != null}
                <div class="mt-3 flex gap-4 text-xs text-slate-500 pt-3 border-t border-slate-800">
                    {#if lastExecution.input_tokens != null}<span>Input: {lastExecution.input_tokens} tok</span>{/if}
                    {#if lastExecution.output_tokens != null}<span>Output: {lastExecution.output_tokens} tok</span>{/if}
                </div>
            {/if}
        </Card>
    {/if}

    {#if job.executions?.length > 1}
        <Card>
            <h2 class="font-semibold text-slate-100 mb-3">Esecuzioni precedenti</h2>
            <ul class="space-y-2">
                {#each job.executions.slice(0, -1) as exec, i}
                    <li class="p-3 rounded-lg bg-slate-950/40 ring-1 ring-slate-800 text-sm">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-slate-300 font-medium">#{i + 1}</span>
                            <span class="text-xs text-slate-500">{formatDate(exec.completed_at ?? exec.started_at)}</span>
                        </div>
                        {#if exec.error}
                            <div class="text-xs text-rose-300 mt-1">{exec.error}</div>
                        {/if}
                    </li>
                {/each}
            </ul>
        </Card>
    {/if}
{/if}

<Modal open={confirmFail} title="Marcare come failed?" onclose={() => confirmFail = false}>
    <p class="text-slate-300">Il job verrà segnato come <code>failed</code> con motivo "manual fail from UI". Non verrà più preso dal worker finché non lo riproponi con Retry.</p>
    {#snippet footer()}
        <Button variant="ghost" onclick={() => confirmFail = false}>Annulla</Button>
        <Button variant="danger" onclick={markFailed} loading={actionLoading}>Marca failed</Button>
    {/snippet}
</Modal>
