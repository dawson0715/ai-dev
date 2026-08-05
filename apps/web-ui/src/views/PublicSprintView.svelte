<script>
    import {api} from '../lib/api.js'
    import {formatDateOnly, formatCurrency} from '../lib/format.js'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let {token} = $props()

    let data = $state(null)
    let loading = $state(true)
    let error = $state('')

    const totalBilled = $derived((data?.sprints ?? []).reduce((sum, s) => sum + (s.price ?? 0), 0))

    async function load() {
        loading = true
        error = ''
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
                <div class="space-y-5">
                    {#each data.sprints as sprint (sprint._id)}
                        <Card padding="none">
                            <div class="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <div class="mb-1.5 flex items-center gap-1.5">
                                        <StatusBadge status={sprint.status}/>
                                        {#if sprint.archived}
                                            <span class="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-700/40 text-slate-300 ring-1 ring-inset ring-slate-600/40">Archiviato</span>
                                        {/if}
                                    </div>
                                    <div class="font-semibold text-slate-100">{sprint.note || 'Sprint'}</div>
                                    {#if sprint.delivery_date}
                                        <div class="text-xs text-slate-500 mt-0.5">consegna {formatDateOnly(sprint.delivery_date)}</div>
                                    {/if}
                                </div>
                                <div class="text-xl font-bold text-slate-100 tabular-nums shrink-0">{formatCurrency(sprint.price)}</div>
                            </div>
                            {#if sprint.jobs?.length}
                                <ul class="divide-y divide-slate-800/60">
                                    {#each sprint.jobs as job, i (i)}
                                        <li class="px-4 sm:px-6 py-2.5 text-sm text-slate-300 flex items-center gap-2">
                                            <svg class="text-slate-600 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>
                                            <span class="truncate">{job.title}</span>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        </Card>
                    {/each}
                </div>

                <div class="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
                    <span class="text-sm text-slate-400">Totale</span>
                    <span class="text-2xl font-bold text-slate-100 tabular-nums">{formatCurrency(totalBilled)}</span>
                </div>
            {/if}
        {/if}
    </div>
</div>
