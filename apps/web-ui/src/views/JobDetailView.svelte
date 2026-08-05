<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatDate, formatRelative, formatCurrency} from '../lib/format.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import Field from '../components/Field.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import Modal from '../components/Modal.svelte'

    let {jobId} = $props()

    let job = $state(null)
    let loading = $state(true)
    let actionLoading = $state(false)
    let confirmFail = $state(false)
    let estimateInput = $state('')
    let savingEstimate = $state(false)
    let recalculating = $state(false)
    let commentText = $state('')
    let savingComment = $state(false)
    let editingText = $state(false)
    let editTitle = $state('')
    let editDescription = $state('')
    let savingText = $state(false)

    async function load() {
        loading = true
        try {
            job = await api.jobs.get(jobId)
            estimateInput = job?.estimate != null ? String(job.estimate) : ''
            editTitle = job?.title ?? job?.clickup?.title ?? ''
            editDescription = job?.description ?? job?.clickup?.description ?? ''
            editingText = false
            commentText = ''
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
        }
    }

    async function saveEstimate() {
        savingEstimate = true
        try {
            await api.jobs.update(jobId, {estimate: estimateInput})
            toast.success('Stima aggiornata')
            await load()
        } catch (e) {
            toast.error(`Salvataggio stima fallito: ${e.message}`)
        } finally {
            savingEstimate = false
        }
    }

    async function recalculateEstimate() {
        recalculating = true
        try {
            const r = await api.jobs.recalculateEstimate(jobId)
            toast.success(`Stima ricalcolata: ${formatCurrency(r.estimate)}`)
            await load()
        } catch (e) {
            toast.error(`Ricalcolo fallito: ${e.message}`)
        } finally {
            recalculating = false
        }
    }

    async function addComment() {
        savingComment = true
        try {
            await api.jobs.addComment(jobId, commentText)
            toast.success('Commento aggiunto, job rimesso in coda')
            commentText = ''
            await load()
        } catch (e) {
            toast.error(`Aggiunta commento fallita: ${e.message}`)
        } finally {
            savingComment = false
        }
    }

    async function saveText() {
        savingText = true
        try {
            await api.jobs.update(jobId, {title: editTitle, description: editDescription})
            toast.success('Testo aggiornato, job rimesso in coda')
            await load()
        } catch (e) {
            toast.error(`Salvataggio testo fallito: ${e.message}`)
        } finally {
            savingText = false
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

    async function requestMerge() {
        actionLoading = true
        try {
            await api.jobs.requestMerge(jobId)
            toast.success('Merge richiesto, il worker lo eseguirà a breve')
            await load()
        } catch (e) {
            toast.error(`Richiesta merge fallita: ${e.message}`)
        } finally {
            actionLoading = false
        }
    }

    async function requestManualReview() {
        actionLoading = true
        try {
            await api.jobs.requestManualReview(jobId)
            toast.success('Slot progetto rilasciato, il prossimo task può partire')
            await load()
        } catch (e) {
            toast.error(`Operazione fallita: ${e.message}`)
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
                {:else}
                    <span class="text-xs text-slate-400 px-1.5 py-0.5 rounded ring-1 ring-inset ring-slate-700">manuale</span>
                {/if}
                {#if job.sprint_id}
                    <a href={`#/sprints/${job.sprint_id}`}
                       class="text-xs px-1.5 py-0.5 rounded ring-1 ring-inset ring-brand-500/30 text-brand-300 hover:text-brand-200 hover:ring-brand-500/50 transition">
                        In sprint
                    </a>
                {/if}
            </div>
            <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">{job.title ?? job.clickup?.title ?? '(senza titolo)'}</h1>
            {#if job.clickup?.url}
                <a href={job.clickup.url} target="_blank" rel="noopener" class="text-sm text-brand-300 hover:text-brand-200 inline-flex items-center gap-1 mt-1">
                    Apri su ClickUp
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M7 7h10v10"/></svg>
                </a>
            {/if}
        </div>
        <div class="flex flex-wrap gap-2">
            <Button variant="secondary" onclick={retry} loading={actionLoading} disabled={actionLoading || ['pending', 'running', 'completed', 'merged'].includes(job.status)}>
                Retry
            </Button>
            <Button variant="danger" onclick={() => confirmFail = true} disabled={['running', 'failed', 'completed', 'merged'].includes(job.status)}>
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
            <div class="text-xs uppercase tracking-wider text-slate-500">Implementato</div>
            <div class="mt-1 text-sm text-slate-200">{formatDate(job.implemented_at ?? job.completed_at)}</div>
        </Card>
    </div>

    {#if job.status === 'awaiting_clarification'}
        <Card class="mb-6">
            <h2 class="font-semibold text-slate-100 mb-3">Il job ha delle domande</h2>

            <div class="mb-4">
                <Field label="Aggiungi un commento" bind:value={commentText} multiline rows={3}
                       placeholder="Rispondi alle domande o dai altro contesto all'agente."
                       hint="Il commento si aggiunge al prompt e il job torna in coda. Il legame con ClickUp resta invariato."/>
                <div class="flex justify-end mt-2">
                    <Button onclick={addComment} loading={savingComment} disabled={savingComment || !commentText.trim()}>
                        Aggiungi commento e rimetti in coda
                    </Button>
                </div>
            </div>

            {#if !editingText}
                <Button variant="ghost" onclick={() => editingText = true}>Modifica testo del task</Button>
            {:else}
                <div class="pt-3 border-t border-slate-800 space-y-3">
                    <Field label="Titolo" bind:value={editTitle}/>
                    <Field label="Descrizione" bind:value={editDescription} multiline rows={6}/>
                    {#if job.clickup?.task_id}
                        <p class="text-xs text-amber-300">Il job proviene da ClickUp: salvando diventa un job manuale, scollegato dalla card ClickUp.</p>
                    {/if}
                    <div class="flex justify-end gap-2">
                        <Button variant="ghost" onclick={() => editingText = false}>Annulla</Button>
                        <Button onclick={saveText} loading={savingText} disabled={savingText}>Salva e rimetti in coda</Button>
                    </div>
                </div>
            {/if}
        </Card>
    {/if}

    {#if job.status === 'awaiting_merge'}
        <Card class="mb-6">
            <div class="p-3 rounded-lg bg-indigo-500/10 ring-1 ring-indigo-500/30 text-sm text-indigo-200 mb-4">
                Implementazione pronta.
                {#if job.manual_review_at}
                    Slot progetto rilasciato: il prossimo task in coda può partire mentre la MR resta in revisione.
                {:else}
                    Il progetto rimane occupato finché la Merge Request non viene unita nel branch base.
                {/if}
            </div>
            <div class="flex flex-wrap gap-2">
                <Button onclick={requestMerge} loading={actionLoading} disabled={actionLoading || !!job.merge_requested_at}>
                    {job.merge_requested_at ? 'Merge richiesto…' : 'Merge'}
                </Button>
                <Button variant="secondary" onclick={requestManualReview} loading={actionLoading} disabled={actionLoading || !!job.manual_review_at}>
                    {job.manual_review_at ? 'In manual review' : 'Manual review'}
                </Button>
            </div>
            {#if job.merge_requested_at}
                <p class="text-xs text-slate-500 mt-2">Il worker esegue il merge su GitLab al prossimo ciclo di polling (~30s).</p>
            {/if}
        </Card>
    {/if}

    {#if ['completed', 'merged'].includes(job.status) && !job.estimate && !job.sprint_id}
        <div class="mb-6 p-4 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/30 text-sm text-amber-200">
            Job completato senza stima. Impostane una prima che entri in uno sprint.
        </div>
    {/if}

    <Card class="mb-6">
        <h2 class="font-semibold text-slate-100 mb-1">Stima costo</h2>
        <p class="text-xs text-slate-500 mb-3">Forfait stimato del task (€). Sommato nel forfait dello sprint che lo include.</p>
        <div class="flex items-end gap-3 max-w-xs">
            <div class="flex-1">
                <Field label="Stima (€)" type="number" step="0.01" min="0" bind:value={estimateInput} placeholder="0.00"/>
            </div>
            <Button onclick={saveEstimate} loading={savingEstimate}
                    disabled={savingEstimate || estimateInput === (job.estimate != null ? String(job.estimate) : '')}>
                Salva
            </Button>
        </div>
        {#if job.minutes}
            <div class="flex items-center justify-between gap-3 mt-2">
                <p class="text-xs text-slate-500">
                    Pre-compilata dall'agente: ~{job.minutes} min di lavoro umano equivalente{job.estimate ? `, alla tariffa oraria del cliente` : ''}.
                </p>
                <Button size="sm" variant="ghost" onclick={recalculateEstimate} loading={recalculating}>
                    Ricalcola
                </Button>
            </div>
            <p class="text-xs text-slate-600 mt-1">Utile se hai cambiato la tariffa oraria del cliente dopo il completamento.</p>
        {/if}
    </Card>

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

    {#if job.description || job.clickup?.description}
        <Card class="mb-6">
            <h2 class="font-semibold text-slate-100 mb-3">Descrizione task</h2>
            <pre class="whitespace-pre-wrap text-sm text-slate-300 font-sans">{job.description || job.clickup?.description}</pre>
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
