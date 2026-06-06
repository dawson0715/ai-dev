<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative, formatCurrency} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Card from '../components/Card.svelte'
    import Select from '../components/Select.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let clients = $state([])
    let sprints = $state([])
    let loading = $state(true)
    let filterClient = $state('')

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const clientOptions = $derived(clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'})))

    async function load() {
        loading = true
        try {
            const [cs, ss] = await Promise.all([
                api.clients.list(),
                api.sprints.list({client_id: filterClient || undefined})
            ])
            clients = cs
            sprints = ss
        } catch (e) {
            toast.error(`Errore caricamento sprint: ${e.message}`)
        } finally {
            loading = false
        }
    }

    $effect(() => {
        filterClient
        load()
    })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Sprint</h1>
        <p class="text-slate-400 text-sm mt-1">Gruppi di task per cliente con totale.</p>
    </div>
</div>

<Card padding="sm" class="mb-5">
    <Select label="Cliente" bind:value={filterClient}
            options={[{value: '', label: 'Tutti i clienti'}, ...clientOptions]}/>
</Card>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if sprints.length === 0}
    <Card>
        <EmptyState title="Nessuno sprint" description="Crea uno sprint dalla sezione Task selezionando i task di un cliente."/>
    </Card>
{:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each sprints as s (s._id)}
            <button onclick={() => go(`/sprints/${s._id}`)} class="text-left group">
                <Card class="hover:ring-brand-500/40 transition cursor-pointer h-full">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/30 to-brand-700/30 ring-1 ring-brand-500/30 flex items-center justify-center text-brand-200">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>
                        </div>
                        <svg class="text-slate-500 group-hover:text-brand-300 transition" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                    </div>
                    <h3 class="font-semibold text-slate-100 truncate">{clientName[s.client_id] ?? '—'}</h3>
                    <p class="text-xs text-slate-500 mt-1 truncate">{s.note || 'Nessuna nota'}</p>
                    <div class="mt-4 flex items-center justify-between text-xs">
                        <span class="text-lg font-bold text-slate-100 tabular-nums">{formatCurrency(s.total)}</span>
                        <span class="text-slate-500">{formatRelative(s.created_at)}</span>
                    </div>
                </Card>
            </button>
        {/each}
    </div>
{/if}
