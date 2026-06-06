<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatDateOnly, formatCurrency} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'
    import Button from '../components/Button.svelte'

    let {sprintId} = $props()

    // Tasso USD->EUR usato solo per stimare il costo AI in euro lato UI.
    const USD_EUR = 0.92

    let sprint = $state(null)
    let client = $state(null)
    let loading = $state(true)

    const publicUrl = $derived(
        client?.token ? `${window.location.origin}${window.location.pathname}#/public/sprint/${client.token}` : ''
    )
    const aiCostEur = $derived((sprint?.ai_cost_usd ?? 0) * USD_EUR)
    const margin = $derived((sprint?.price ?? 0) - aiCostEur)

    async function load() {
        loading = true
        try {
            sprint = await api.sprints.get(sprintId)
            if (sprint?.client_id) {
                client = await api.clients.get(sprint.client_id).catch(() => null)
            }
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
        }
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(publicUrl)
            toast.success('Link copiato')
        } catch {
            toast.error('Copia non riuscita')
        }
    }

    $effect(() => {
        sprintId
        load()
    })
</script>

<a href="#/sprints" class="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
    Sprint
</a>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if !sprint}
    <Card><EmptyState title="Sprint non trovato"/></Card>
{:else}
    <div class="mb-6 flex items-start justify-between gap-4">
        <div class="min-w-0">
            <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">{client?.name ?? 'Sprint'}</h1>
            {#if sprint.note}<p class="text-slate-400 text-sm mt-1">{sprint.note}</p>{/if}
        </div>
        <StatusBadge status={sprint.status}/>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Forfait</div>
            <div class="text-2xl font-bold mt-1 text-emerald-300 tabular-nums">{formatCurrency(sprint.price)}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Job</div>
            <div class="text-2xl font-bold mt-1 text-slate-100">{sprint.jobs?.length ?? 0}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Costo AI</div>
            <div class="text-2xl font-bold mt-1 text-slate-100 tabular-nums">{sprint.ai_cost_usd ? formatCurrency(aiCostEur) : '—'}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Margine</div>
            <div class="text-2xl font-bold mt-1 tabular-nums {margin >= 0 ? 'text-emerald-300' : 'text-rose-300'}">{formatCurrency(margin)}</div>
        </Card>
    </div>

    {#if sprint.delivery_date}
        <p class="text-sm text-slate-500 mb-6">Consegna: {formatDateOnly(sprint.delivery_date)}</p>
    {/if}

    {#if publicUrl}
        <Card padding="sm" class="mb-6">
            <div class="text-xs uppercase tracking-wider text-slate-500 mb-2">Link pubblico cliente</div>
            <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-slate-400 truncate bg-slate-950/50 rounded px-2 py-1.5 ring-1 ring-slate-800">{publicUrl}</code>
                <Button size="sm" variant="secondary" onclick={copyLink}>Copia</Button>
                <Button size="sm" variant="ghost" href={publicUrl}>Apri</Button>
            </div>
        </Card>
    {/if}

    <Card padding="none">
        <div class="px-4 sm:px-6 py-4 border-b border-slate-800 font-semibold text-slate-100">Job dello sprint</div>
        {#if !sprint.jobs?.length}
            <EmptyState title="Nessun job"/>
        {:else}
            <ul class="divide-y divide-slate-800">
                {#each sprint.jobs as job (job._id)}
                    <li>
                        <button onclick={() => go(`/jobs/${job._id}`)}
                                class="w-full text-left px-4 sm:px-6 py-4 hover:bg-slate-800/40 transition flex items-center gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="mb-1"><StatusBadge status={job.status}/></div>
                                <div class="font-medium text-slate-100 truncate">{job.title}</div>
                            </div>
                            {#if job.cost_usd}
                                <div class="text-xs text-slate-500 tabular-nums shrink-0">${job.cost_usd.toFixed(2)}</div>
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </Card>
{/if}
