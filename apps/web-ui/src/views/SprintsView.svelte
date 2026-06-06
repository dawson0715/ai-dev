<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative, formatCurrency} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import {SPRINT_STATUSES} from '../lib/sprintStatus.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import Field from '../components/Field.svelte'
    import Select from '../components/Select.svelte'
    import Modal from '../components/Modal.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let clients = $state([])
    let sprints = $state([])
    let loading = $state(true)
    let filterClient = $state('')

    // Creazione sprint
    let modalOpen = $state(false)
    let submitting = $state(false)
    let billableJobs = $state([])
    let loadingJobs = $state(false)
    let selected = $state(new Set())
    let form = $state(emptyForm())
    // Diventa true quando l'utente tocca a mano il forfait: smettiamo di
    // sovrascriverlo con la somma delle stime dei job selezionati.
    let priceEdited = $state(false)

    function emptyForm() {
        return {client_id: '', price: '', delivery_date: '', status: 'in_lavorazione', note: ''}
    }

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const clientOptions = $derived(clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'})))
    const canCreate = $derived(Boolean(form.client_id) && selected.size > 0)

    // Somma delle stime dei job selezionati: forfait di default dello sprint.
    const selectedTotal = $derived(
        billableJobs.reduce((sum, j) => sum + (selected.has(j._id) ? Number(j.estimate) || 0 : 0), 0)
    )

    // Finché l'utente non modifica il forfait a mano, lo teniamo allineato alla
    // somma delle stime dei job selezionati.
    $effect(() => {
        if (priceEdited) return
        form.price = selectedTotal ? String(selectedTotal) : ''
    })

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

    function openCreate() {
        form = emptyForm()
        priceEdited = false
        if (filterClient) form.client_id = filterClient
        billableJobs = []
        selected = new Set()
        modalOpen = true
        if (form.client_id) loadBillable()
    }

    async function loadBillable() {
        selected = new Set()
        billableJobs = []
        priceEdited = false
        if (!form.client_id) return
        loadingJobs = true
        try {
            billableJobs = await api.jobs.billable(form.client_id)
            // Di default tutti i job non ancora associati a uno sprint entrano nello sprint.
            selected = new Set(billableJobs.map((j) => j._id))
        } catch (e) {
            toast.error(`Errore caricamento job: ${e.message}`)
        } finally {
            loadingJobs = false
        }
    }

    function toggle(id) {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        selected = next
    }

    async function createSprint(e) {
        e.preventDefault()
        if (!canCreate) return
        submitting = true
        try {
            const r = await api.sprints.create({
                client_id: form.client_id,
                job_ids: [...selected],
                price: form.price,
                delivery_date: form.delivery_date || undefined,
                status: form.status,
                note: form.note
            })
            toast.success(`Sprint creato (forfait ${formatCurrency(r.price)})`)
            modalOpen = false
            go(`/sprints/${r.sprint_id}`)
        } catch (e) {
            toast.error(`Creazione sprint fallita: ${e.message}`)
        } finally {
            submitting = false
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
        <p class="text-slate-400 text-sm mt-1">Lavori fatturati a forfait per cliente, raggruppando i job completati.</p>
    </div>
    <Button onclick={openCreate} disabled={clients.length === 0}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo sprint
    </Button>
</div>

<Card padding="sm" class="mb-5">
    <Select label="Cliente" bind:value={filterClient}
            options={[{value: '', label: 'Tutti i clienti'}, ...clientOptions]}/>
</Card>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if sprints.length === 0}
    <Card>
        <EmptyState title="Nessuno sprint" description="Crea uno sprint raggruppando i job completati di un cliente e fissando il forfait."/>
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
                        <StatusBadge status={s.status}/>
                    </div>
                    <h3 class="font-semibold text-slate-100 truncate">{clientName[s.client_id] ?? '—'}</h3>
                    <p class="text-xs text-slate-500 mt-1 truncate">{s.note || 'Nessuna nota'}</p>
                    <div class="mt-4 flex items-center justify-between text-xs">
                        <span class="text-lg font-bold text-slate-100 tabular-nums">{formatCurrency(s.price)}</span>
                        <span class="text-slate-500">{formatRelative(s.created_at)}</span>
                    </div>
                </Card>
            </button>
        {/each}
    </div>
{/if}

<Modal open={modalOpen} title="Nuovo sprint" onclose={() => modalOpen = false}>
    <form onsubmit={createSprint} class="space-y-4">
        <Select label="Cliente" bind:value={form.client_id} required placeholder="Seleziona cliente"
                options={clientOptions} onchange={loadBillable}/>

        {#if form.client_id}
            <div>
                <div class="flex items-center justify-between mb-1.5">
                    <span class="block text-sm font-medium text-slate-300">Job da includere</span>
                    {#if selected.size > 0}<span class="text-xs text-brand-300">{selected.size} selezionati</span>{/if}
                </div>
                {#if loadingJobs}
                    <div class="flex justify-center py-6"><Spinner size={24}/></div>
                {:else if billableJobs.length === 0}
                    <p class="text-sm text-slate-500 bg-slate-950/50 rounded-lg ring-1 ring-slate-800 px-3 py-4">
                        Nessun job completato e non ancora fatturato per questo cliente.
                    </p>
                {:else}
                    <ul class="max-h-56 overflow-y-auto divide-y divide-slate-800 rounded-lg ring-1 ring-slate-800">
                        {#each billableJobs as job (job._id)}
                            <li class="flex items-center gap-3 px-3 py-2.5">
                                <input type="checkbox" checked={selected.has(job._id)}
                                       onchange={() => toggle(job._id)}
                                       class="h-4 w-4 rounded border-slate-700 bg-slate-950 text-brand-500 focus:ring-brand-500"/>
                                <span class="flex-1 min-w-0 text-sm text-slate-200 truncate">{job.title ?? job.clickup?.title ?? '(senza titolo)'}</span>
                                <span class="text-xs text-slate-400 tabular-nums shrink-0">{formatCurrency(Number(job.estimate) || 0)}</span>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>

            <div class="grid grid-cols-2 gap-3">
                <Field label="Forfait (€)" type="number" step="0.01" min="0" bind:value={form.price}
                       placeholder="0.00" oninput={() => priceEdited = true}
                       hint="Default: somma delle stime dei job selezionati."/>
                <Field label="Data consegna" type="date" bind:value={form.delivery_date}/>
            </div>
            <Select label="Stato" bind:value={form.status} options={SPRINT_STATUSES}/>
            <Field label="Nota" bind:value={form.note} multiline rows={2} placeholder="Nota opzionale sullo sprint"/>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => modalOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting || !canCreate}>Crea sprint</Button>
        </div>
    </form>
</Modal>
