<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative, formatCurrency} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import {sortByClientName} from '../lib/projectSort.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'
    import NewJobModal from '../components/NewJobModal.svelte'

    let jobs = $state([])
    let projects = $state([])
    let clients = $state([])
    let loading = $state(true)
    let filter = $state('all')

    let modalOpen = $state(false)

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const sortedProjects = $derived(sortByClientName(projects, clientName))

    async function load() {
        loading = true
        try {
            const [j, p, cs] = await Promise.all([
                api.jobs.list({limit: 200}),
                api.projects.list(),
                api.clients.list()
            ])
            jobs = j
            projects = p
            clients = cs
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
        }
    }

    const filtered = $derived(
        filter === 'all'
            ? jobs
            : jobs.filter(j => filter === 'merged'
                ? ['merged', 'completed'].includes(j.status)
                : j.status === filter)
    )

    const filters = [
        {key: 'all', label: 'Tutti'},
        {key: 'pending', label: 'Pending'},
        {key: 'running', label: 'Running'},
        {key: 'awaiting_merge', label: 'In attesa merge'},
        {key: 'merged', label: 'Merged'},
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
    <Button onclick={() => modalOpen = true} disabled={projects.length === 0}>
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
                                {#if ['completed', 'merged'].includes(job.status) && !job.estimate}
                                    <span class="text-xs text-amber-300 px-1.5 py-0.5 rounded ring-1 ring-inset ring-amber-500/30">senza stima</span>
                                {/if}
                            </div>
                            <div class="font-medium text-slate-100 truncate">{job.title ?? job.clickup?.title ?? '(senza titolo)'}</div>
                        </div>
                        <div class="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                            {#if job.estimate}<span class="text-slate-400 tabular-nums">{formatCurrency(job.estimate)}</span>{/if}
                            <span>{formatRelative(job.created_at)}</span>
                            <svg class="hidden sm:block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                        </div>
                    </button>
                </li>
            {/each}
        </ul>
    </Card>
{/if}

<NewJobModal open={modalOpen} projects={sortedProjects} onclose={() => modalOpen = false} oncreated={load}/>
