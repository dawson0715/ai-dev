<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import Modal from '../components/Modal.svelte'
    import Field from '../components/Field.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let jobs = $state([])
    let projects = $state([])
    let loading = $state(true)
    let filter = $state('all')

    let modalOpen = $state(false)
    let submitting = $state(false)
    let form = $state({project_id: '', title: '', description: ''})

    const selectClass = 'block w-full rounded-lg bg-slate-950/50 ring-1 ring-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 transition'

    async function load() {
        loading = true
        try {
            const [j, p] = await Promise.all([
                api.jobs.list({limit: 200}),
                api.projects.list()
            ])
            jobs = j
            projects = p
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
        }
    }

    function openModal() {
        form = {project_id: projects[0]?._id ?? '', title: '', description: ''}
        modalOpen = true
    }

    async function submit(e) {
        e.preventDefault()
        submitting = true
        try {
            await api.jobs.create(form)
            toast.success('Job creato e messo in coda')
            modalOpen = false
            await load()
        } catch (e) {
            toast.error(`Creazione fallita: ${e.message}`)
        } finally {
            submitting = false
        }
    }

    const filtered = $derived(
        filter === 'all' ? jobs : jobs.filter(j => j.status === filter)
    )

    const filters = [
        {key: 'all', label: 'Tutti'},
        {key: 'pending', label: 'Pending'},
        {key: 'running', label: 'Running'},
        {key: 'completed', label: 'Completati'},
        {key: 'failed', label: 'Falliti'},
        {key: 'awaiting_clarification', label: 'In attesa'}
    ]

    $effect(() => { load() })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Tutti i job</h1>
        <p class="text-slate-400 text-sm mt-1">Ultimi 200 job aggregati da tutti i progetti.</p>
    </div>
    <Button onclick={openModal} disabled={projects.length === 0}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo job
    </Button>
</div>

<div class="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
    {#each filters as f}
        <button
            onclick={() => filter = f.key}
            class="px-3 py-1.5 rounded-full text-sm whitespace-nowrap ring-1 ring-inset transition {filter === f.key ? 'bg-brand-600 text-white ring-brand-500' : 'text-slate-300 ring-slate-700 hover:ring-slate-600 hover:bg-slate-800/60'}">
            {f.label}
        </button>
    {/each}
</div>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if filtered.length === 0}
    <Card><EmptyState title="Nessun job" description={filter === 'all' ? 'Esegui un sync ClickUp da un progetto, oppure crea un job manuale.' : 'Nessun job in questo stato.'}/></Card>
{:else}
    <Card padding="none">
        <ul class="divide-y divide-slate-800">
            {#each filtered as job (job._id)}
                <li>
                    <button
                        onclick={() => go(`/jobs/${job._id}`)}
                        class="w-full text-left px-4 sm:px-6 py-4 hover:bg-slate-800/40 transition flex flex-col sm:flex-row sm:items-center gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <StatusBadge status={job.status}/>
                                {#if job.clickup?.task_id}
                                    <span class="text-xs text-slate-500 font-mono truncate">{job.clickup.task_id}</span>
                                {:else}
                                    <span class="text-xs text-slate-400 px-1.5 py-0.5 rounded ring-1 ring-inset ring-slate-700">manuale</span>
                                {/if}
                            </div>
                            <div class="font-medium text-slate-100 truncate">{job.title ?? job.clickup?.title ?? '(senza titolo)'}</div>
                        </div>
                        <div class="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                            <span>{formatRelative(job.created_at)}</span>
                            <svg class="hidden sm:block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                        </div>
                    </button>
                </li>
            {/each}
        </ul>
    </Card>
{/if}

<Modal open={modalOpen} title="Nuovo job manuale" onclose={() => modalOpen = false}>
    <form onsubmit={submit} class="space-y-4">
        <label class="block">
            <span class="block text-sm font-medium text-slate-300 mb-1.5">Progetto <span class="text-rose-400">*</span></span>
            <select bind:value={form.project_id} required class={selectClass}>
                {#each projects as p (p._id)}
                    <option value={p._id}>{p.name ?? '(senza nome)'}</option>
                {/each}
            </select>
            <span class="block text-xs text-slate-500 mt-1">Il repo del progetto in cui l'agente lavorerà.</span>
        </label>
        <Field label="Titolo" bind:value={form.title} required placeholder="Es. Aggiungi endpoint /metrics"
               hint="Usato come messaggio di commit."/>
        <Field label="Descrizione" bind:value={form.description} multiline rows={6}
               placeholder="Cosa deve fare l'agente. Più dettagli = meno domande."
               hint="Diventa il prompt per l'agente. Nessuna card ClickUp viene creata o aggiornata."/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => modalOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting}>Crea job</Button>
        </div>
    </form>
</Modal>
