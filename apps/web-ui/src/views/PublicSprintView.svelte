<script>
    import {api} from '../lib/api.js'
    import {formatCurrency, formatDateDash, formatDateOnly} from '../lib/format.js'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let {token} = $props()

    let data = $state(null)
    let loading = $state(true)
    let error = $state('')
    let selectedSprintId = $state(null)

    // Il backend restituisce gli sprint gia' ordinati per created_at desc.
    const recentSprints = $derived((data?.sprints ?? []).slice(0, 5))
    const selectedSprint = $derived(recentSprints.find((s) => s._id === selectedSprintId) ?? recentSprints[0] ?? null)
    const totalBilled = $derived(selectedSprint?.price ?? 0)

    async function load() {
        loading = true
        error = ''
        selectedSprintId = null
        try {
            data = await api.sprints.public(token)
        } catch (e) {
            error = e.status === 404 ? 'Link non valido o scaduto.' : e.message
        } finally {
            loading = false
        }
    }

    $effect(() => {
        token
        load()
    })
</script>

<div class="min-h-screen bg-slate-950">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {#if loading}
            <div class="flex justify-center py-20"><Spinner size={32}/></div>
        {:else if error}
            <Card><EmptyState title="Non disponibile" description={error}/></Card>
        {:else if data}
            <header class="mb-8">
                <div class="text-sm text-brand-300 font-medium">I tuoi lavori</div>
                <h1 class="text-3xl font-bold tracking-tight text-slate-100 mt-1">{data.client?.name ?? ''}</h1>
            </header>

            {#if !data.sprints?.length}
                <Card><EmptyState title="Nessuno sprint" description="Non ci sono ancora lavori da mostrare."/></Card>
            {:else}
                <div class="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1">
                    {#each recentSprints as sprint (sprint._id)}
                        <button
                            onclick={() => selectedSprintId = sprint._id}
                            class="px-3 py-1.5 rounded-full text-sm whitespace-nowrap ring-1 ring-inset transition {selectedSprint?._id === sprint._id ? 'bg-brand-600 text-white ring-brand-500' : 'text-slate-300 ring-slate-700 hover:ring-slate-600 hover:bg-slate-800/60'}">
                            {sprint.note || 'Sprint'} · {formatDateOnly(sprint.created_at)}
                        </button>
                    {/each}
                </div>

                {#if selectedSprint}
                    <div class="space-y-5">
                        <Card padding="none">
                            <div class="px-4 sm:px-6 py-4 border-b border-slate-800">
                                <div class="mb-1.5 flex items-center gap-1.5">
                                    <StatusBadge status={selectedSprint.status}/>
                                    {#if selectedSprint.archived}
                                        <span class="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-700/40 text-slate-300 ring-1 ring-inset ring-slate-600/40">Archiviato</span>
                                    {/if}
                                </div>
                                <div class="font-semibold text-slate-100">{selectedSprint.note || 'Sprint'}</div>
                            </div>
                            {#each selectedSprint.job_groups ?? [] as group (group.name)}
                                <div class="px-4 sm:px-6 py-2 bg-slate-950/40 flex items-center justify-between gap-3 border-b border-slate-800">
                                    <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">{group.name}</span>
                                    <span class="text-xs font-semibold text-slate-400 tabular-nums shrink-0">{formatCurrency(group.subtotal)}</span>
                                </div>
                                <ul class="divide-y divide-slate-800/60">
                                    {#each group.jobs as job, i (i)}
                                        <li class="px-4 sm:px-6 py-2.5 text-sm text-slate-300 flex items-center gap-2">
                                            <svg class="text-slate-600 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>
                                            {#if job.date}
                                                <span class="text-slate-500 text-xs tabular-nums shrink-0">{formatDateDash(job.date)}</span>
                                            {/if}
                                            <span class="truncate flex-1">{job.title}</span>
                                            <span class="text-slate-400 tabular-nums shrink-0">{formatCurrency(job.price)}</span>
                                        </li>
                                    {/each}
                                </ul>
                            {/each}
                        </Card>
                    </div>

                    <div class="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
                        <span class="text-sm text-slate-400">Totale</span>
                        <span class="text-2xl font-bold text-slate-100 tabular-nums">{formatCurrency(totalBilled)}</span>
                    </div>
                {/if}
            {/if}
        {/if}
    </div>
</div>
