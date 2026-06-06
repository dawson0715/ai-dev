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
    import Modal from '../components/Modal.svelte'
    import Field from '../components/Field.svelte'

    let {sprintId} = $props()

    // Tasso USD->EUR usato solo per stimare il costo AI in euro lato UI.
    const USD_EUR = 0.92

    let sprint = $state(null)
    let client = $state(null)
    let loading = $state(true)
    let confirmInvoice = $state(false)
    let invoicing = $state(false)
    let editOpen = $state(false)
    let editForm = $state({price: '', note: ''})
    let saving = $state(false)
    let confirmInvoiceUpdate = $state(false)
    let updatingInvoice = $state(false)

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

    async function generateInvoice() {
        invoicing = true
        try {
            const r = await api.sprints.invoice(sprintId)
            const ref = r.invoice_number ? `n. ${r.invoice_number}${r.invoice_year ? `/${r.invoice_year}` : ''}` : ''
            toast.success(ref ? `Fattura ${ref} generata` : 'Fattura generata')
            confirmInvoice = false
            await load()
        } catch (e) {
            toast.error(`Generazione fattura fallita: ${e.message}`)
        } finally {
            invoicing = false
        }
    }

    function openEdit() {
        editForm = {price: sprint?.price != null ? String(sprint.price) : '', note: sprint?.note ?? ''}
        editOpen = true
    }

    async function saveEdit(e) {
        e.preventDefault()
        saving = true
        try {
            await api.sprints.update(sprintId, {price: editForm.price, note: editForm.note})
            toast.success(sprint.invoice_id ? 'Sprint aggiornato — ricordati di aggiornare la fattura' : 'Sprint aggiornato')
            editOpen = false
            await load()
        } catch (e) {
            toast.error(`Aggiornamento fallito: ${e.message}`)
        } finally {
            saving = false
        }
    }

    async function syncInvoice() {
        updatingInvoice = true
        try {
            const r = await api.sprints.invoiceUpdate(sprintId)
            const ref = r.invoice_number ? `n. ${r.invoice_number}${r.invoice_year ? `/${r.invoice_year}` : ''}` : ''
            toast.success(ref ? `Fattura ${ref} aggiornata` : 'Fattura aggiornata')
            confirmInvoiceUpdate = false
            await load()
        } catch (e) {
            toast.error(`Aggiornamento fattura fallito: ${e.message}`)
        } finally {
            updatingInvoice = false
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
        <div class="flex flex-wrap items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" onclick={openEdit}>Modifica</Button>
            {#if sprint.invoice_id}
                <span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                    Fatturato{sprint.invoice_number ? ` · n. ${sprint.invoice_number}${sprint.invoice_year ? `/${sprint.invoice_year}` : ''}` : ''}
                </span>
                <Button size="sm" variant="secondary" onclick={() => confirmInvoiceUpdate = true}>Aggiorna fattura</Button>
            {:else}
                <Button size="sm" variant="secondary" onclick={() => confirmInvoice = true}>Genera fattura</Button>
            {/if}
            <StatusBadge status={sprint.status}/>
        </div>
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
                            <div class="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                                {#if job.estimate}
                                    <span class="text-slate-300">{formatCurrency(job.estimate)}</span>
                                {/if}
                                {#if job.cost_usd}
                                    <span class="text-slate-500">${job.cost_usd.toFixed(2)}</span>
                                {/if}
                            </div>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </Card>

    <Modal open={confirmInvoice} title="Generare la fattura?" onclose={() => confirmInvoice = false}>
        <p class="text-slate-300">
            Verrà creata una fattura sul backoffice per <strong>{client?.name ?? 'il cliente'}</strong>
            con forfait <strong>{formatCurrency(sprint.price)}</strong> (riga unica).
            Numero e totali sono assegnati dal backoffice. L'azione è verso un servizio esterno.
        </p>
        {#snippet footer()}
            <Button variant="ghost" onclick={() => confirmInvoice = false}>Annulla</Button>
            <Button onclick={generateInvoice} loading={invoicing}>Genera fattura</Button>
        {/snippet}
    </Modal>
{/if}
