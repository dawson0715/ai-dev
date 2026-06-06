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

            <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Task in corso</h2>
            {#if !data.tasks?.length}
                <Card class="mb-8"><EmptyState title="Nessun task in corso"/></Card>
            {:else}
                <Card padding="none" class="mb-8">
                    <ul class="divide-y divide-slate-800">
                        {#each data.tasks as task (task._id)}
                            <li class="px-4 sm:px-6 py-4 flex items-center gap-3">
                                <div class="flex-1 min-w-0">
                                    <div class="mb-1"><StatusBadge status={task.status}/></div>
                                    <div class="font-medium text-slate-100 truncate">{task.project_name || '(senza nome)'}</div>
                                    {#if task.description}
                                        <div class="text-xs text-slate-500 mt-0.5 line-clamp-2">{task.description}</div>
                                    {/if}
                                    {#if task.delivery_date}
                                        <div class="text-xs text-slate-500 mt-0.5">consegna {formatDateOnly(task.delivery_date)}</div>
                                    {/if}
                                </div>
                                <div class="font-semibold text-slate-100 tabular-nums shrink-0">{formatCurrency(task.price)}</div>
                            </li>
                        {/each}
                    </ul>
                </Card>
            {/if}

            {#if data.sprints?.length}
                <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Sprint</h2>
                <div class="grid gap-3 sm:grid-cols-2">
                    {#each data.sprints as s (s._id)}
                        <Card>
                            <div class="text-xs text-slate-500">{s.note || 'Sprint'}</div>
                            <div class="text-xl font-bold text-slate-100 tabular-nums mt-1">{formatCurrency(s.total)}</div>
                        </Card>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>
