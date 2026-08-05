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
    import BillableJobPicker from '../components/BillableJobPicker.svelte'

    let clients = $state([])
    let sprints = $state([])
    let loading = $state(true)
    let filterClient = $state('')
    // Attivi = sprint non chiusi; Storico = sprint chiusi senza fattura (job archiviati).
    let view = $state('attivi')

    // Creazione sprint
    let modalOpen = $state(false)
    let submitting = $state(false)
    let billableJobs = $state([])
    let loadingJobs = $state(false)
    let selected = $state(new Set())
    let form = $state(emptyForm())

    function emptyForm() {
        return {client_id: '', discount: '', status: 'in_lavorazione', note: ''}
    }

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const clientOptions = $derived(clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'})))
    const canCreate = $derived(Boolean(form.client_id) && selected.size > 0)

    // Costo finale = somma delle stime dei job selezionati - sconto. Non e' un
    // campo editabile: e' sempre derivato dai job effettivamente nello sprint.
    const selectedTotal = $derived(
        billableJobs.reduce((sum, j) => sum + (selected.has(j._id) ? Number(j.estimate) || 0 : 0), 0)
    )
    const finalPrice = $derived(Math.max(0, selectedTotal - (Number(form.discount) || 0)))

    async function load() {
        loading = true
        try {
            const [cs, ss] = await Promise.all([
                api.clients.list(),
                api.sprints.list({client_id: filterClient || undefined, archived: view === 'storico' ? 'true' : undefined})
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
        if (filterClient) form.client_id = filterClient
        billableJobs = []
        selected = new Set()
        modalOpen = true
        if (form.client_id) loadBillable()
    }

    async function loadBillable() {
        selected = new Set()
        billableJobs = []
        form.discount = ''
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

    async function createSprint(e) {
        e.preventDefault()
        if (!canCreate) return
        submitting = true
        try {
            const r = await api.sprints.create({
                client_id: form.client_id,
                job_ids: [...selected],
                discount: form.discount,
                status: form.status,
                note: form.note
            })
            toast.success(`Sprint creato (costo finale ${formatCurrency(finalPrice)})`)
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
        view
        load()
    })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Sprint</h1>
        <p class="text-slate-400 text-sm mt-1">Lavori fatturati a costo finale per cliente, raggruppando i job completati.</p>
    </div>
    <Button onclick={openCreate} disabled={clients.length === 0}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo sprint
    </Button>
</div>

<div class="flex gap-2 mb-4">
    {#each [{key: 'attivi', label: 'Attivi'}, {key: 'storico', label: 'Storico'}] as t}
        <button
            onclick={() => view = t.key}
            class="px-3 py-1.5 rounded-full text-sm whitespace-nowrap ring-1 ring-inset transition {view === t.key ? 'bg-brand-600 text-white ring-brand-500' : 'text-slate-300 ring-slate-700 hover:ring-slate-600 hover:bg-slate-800/60'}">
            {t.label}
        </button>
    {/each}
</div>

<Card padding="sm" class="mb-5">
    <Select label="Cliente" bind:value={filterClient}
            options={[{value: '', label: 'Tutti i clienti'}, ...clientOptions]}/>
</Card>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if sprints.length === 0}
    <Card>
        <EmptyState title={view === 'storico' ? 'Nessuno sprint in storico' : 'Nessuno sprint'}
                    description={view === 'storico' ? 'Gli sprint chiusi senza fattura compaiono qui.' : 'Crea uno sprint raggruppando i job completati di un cliente e fissando il costo finale.'}/>
    </Card>
{:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each sprints as s (s._id)}
            <button onclick={() => go(`/sprints/${s._id}`)} class="text-left group">
                <Card class="hover:ring-brand-500/40 transition cursor-pointer h-full {s.archived ? 'opacity-70' : ''}">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/30 to-brand-700/30 ring-1 ring-brand-500/30 flex items-center justify-center text-brand-200">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>
                        </div>
                        <div class="flex items-center gap-1.5">
                            {#if s.archived}
                                <span class="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-700/40 text-slate-300 ring-1 ring-inset ring-slate-600/40">Archiviato</span>
                            {/if}
                            <StatusBadge status={s.status}/>
                        </div>
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
                    <BillableJobPicker jobs={billableJobs} bind:selected/>
                {/if}
            </div>

            <div class="flex items-center justify-between text-sm bg-slate-950/50 rounded-lg ring-1 ring-slate-800 px-3 py-2">
                <span class="text-slate-400">Totale stime selezionate</span>
                <span class="text-slate-100 font-medium tabular-nums">{formatCurrency(selectedTotal)}</span>
            </div>

            <div class="grid grid-cols-2 gap-3 items-end">
                <Field label="Sconto (€)" type="number" step="0.01" min="0" bind:value={form.discount}
                       placeholder="0.00"/>
                <div>
                    <span class="block text-sm font-medium text-slate-300 mb-1.5">Costo finale</span>
                    <div class="rounded-lg bg-slate-950/50 ring-1 ring-slate-800 px-3 py-2 text-slate-100 font-medium tabular-nums">
                        {formatCurrency(finalPrice)}
                    </div>
                </div>
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
