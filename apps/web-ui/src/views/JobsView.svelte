<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let jobs = $state([])
    let loading = $state(true)
    let filter = $state('all')

    async function load() {
        loading = true
        try {
            jobs = await api.jobs.list({limit: 200})
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
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
    <Card><EmptyState title="Nessun job" description={filter === 'all' ? 'Esegui un sync ClickUp da un progetto.' : 'Nessun job in questo stato.'}/></Card>
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
                                {/if}
                            </div>
                            <div class="font-medium text-slate-100 truncate">{job.clickup?.title ?? '(senza titolo)'}</div>
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
