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

    let sprint = $state(null)
    let client = $state(null)
    let loading = $state(true)
    let confirmInvoice = $state(false)
    let invoicing = $state(false)
    let editOpen = $state(false)
    let editForm = $state({price: '', discount: '', note: ''})
    let saving = $state(false)
    let confirmInvoiceUpdate = $state(false)
    let updatingInvoice = $state(false)
    let confirmClose = $state(false)
    let closing = $state(false)

    const publicUrl = $derived(
        client?.token ? `${window.location.origin}${window.location.pathname}#/public/sprint/${client.token}` : ''
    )
    // Somma delle stime dei job dello sprint, prima dello sconto.
    const subtotal = $derived((sprint?.jobs ?? []).reduce((sum, j) => sum + (j.estimate ?? 0), 0))
    // Job dello sprint raggruppati per progetto (i job di supporto/manuali senza
    // progetto finiscono in un gruppo residuo), nell'ordine di prima comparsa.
    const jobGroups = $derived.by(() => {
        const groups = new Map()
        for (const job of sprint?.jobs ?? []) {
            const key = job.project_name ?? (job.source === 'support' ? 'Supporto' : 'Senza progetto')
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key).push(job)
        }
        return [...groups.entries()].map(([name, jobs]) => ({name, jobs}))
    })

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
        editForm = {
            price: sprint?.price != null ? String(sprint.price) : '',
            discount: sprint?.discount != null ? String(sprint.discount) : '',
            note: sprint?.note ?? ''
        }
        editOpen = true
    }

    async function saveEdit(e) {
        e.preventDefault()
        saving = true
        try {
            await api.sprints.update(sprintId, {price: editForm.price, discount: editForm.discount, note: editForm.note})
            toast.success(sprint.invoice_id ? 'Sprint aggiornato — ricordati di aggiornare la fattura' : 'Sprint aggiornato')
            editOpen = false
            await load()
        } catch (e) {
            toast.error(`Aggiornamento fallito: ${e.message}`)
        } finally {
            saving = false
        }
    }

    async function closeSprint() {
        closing = true
        try {
            await api.sprints.close(sprintId)
            toast.success('Sprint chiuso: i job sono stati archiviati')
            confirmClose = false
            await load()
        } catch (e) {
            toast.error(`Chiusura sprint fallita: ${e.message}`)
        } finally {
            closing = false
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
            {#if !sprint.archived}
                <Button size="sm" variant="ghost" onclick={openEdit}>Modifica</Button>
            {/if}
            {#if sprint.archived}
                <span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-slate-700/40 text-slate-300 ring-1 ring-inset ring-slate-600/40">
                    Archiviato{sprint.archived_at ? ` · ${formatDateOnly(sprint.archived_at)}` : ''}
                </span>
            {:else if sprint.invoice_id}
                <span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                    Fatturato{sprint.invoice_number ? ` · n. ${sprint.invoice_number}${sprint.invoice_year ? `/${sprint.invoice_year}` : ''}` : ''}
                </span>
                <Button size="sm" variant="secondary" onclick={() => confirmInvoiceUpdate = true}>Aggiorna fattura</Button>
            {:else}
                <Button size="sm" variant="secondary" onclick={() => confirmInvoice = true}>Genera fattura</Button>
            {/if}
            {#if !sprint.archived}
                <Button size="sm" variant="ghost" onclick={() => confirmClose = true}>Chiudi sprint</Button>
            {/if}
            <StatusBadge status={sprint.status}/>
        </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Totale stime</div>
            <div class="text-2xl font-bold mt-1 text-slate-100 tabular-nums">{formatCurrency(subtotal)}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Sconto</div>
            <div class="text-2xl font-bold mt-1 text-slate-100 tabular-nums">{sprint.discount ? `-${formatCurrency(sprint.discount)}` : '—'}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Costo finale</div>
            <div class="text-2xl font-bold mt-1 text-emerald-300 tabular-nums">{formatCurrency(sprint.price)}</div>
        </Card>
        <Card padding="sm">
            <div class="text-xs uppercase tracking-wider text-slate-500">Job</div>
            <div class="text-2xl font-bold mt-1 text-slate-100">{sprint.jobs?.length ?? 0}</div>
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
            {#each jobGroups as group (group.name)}
                <div class="px-4 sm:px-6 py-2 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-800">
                    {group.name}
                </div>
                <ul class="divide-y divide-slate-800">
                    {#each group.jobs as job (job._id)}
                        <li>
                            <button onclick={() => go(`/jobs/${job._id}`)}
                                    class="w-full text-left px-4 sm:px-6 py-4 hover:bg-slate-800/40 transition flex items-center gap-3">
                                <div class="flex-1 min-w-0">
                                    <div class="mb-1"><StatusBadge status={job.status}/></div>
                                    <div class="font-medium text-slate-100 truncate">{job.title}</div>
                                    {#if job.completed_at}
                                        <div class="text-xs text-slate-500 mt-0.5">Completato {formatDateOnly(job.completed_at)}</div>
                                    {/if}
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
            {/each}
        {/if}
    </Card>

    <Modal open={confirmInvoice} title="Generare la fattura?" onclose={() => confirmInvoice = false}>
        <p class="text-slate-300">
            Verrà creata una fattura sul backoffice per <strong>{client?.name ?? 'il cliente'}</strong>
            con costo finale <strong>{formatCurrency(sprint.price)}</strong> (riga unica).
            Numero e totali sono assegnati dal backoffice. L'azione è verso un servizio esterno.
        </p>
        {#snippet footer()}
            <Button variant="ghost" onclick={() => confirmInvoice = false}>Annulla</Button>
            <Button onclick={generateInvoice} loading={invoicing}>Genera fattura</Button>
        {/snippet}
    </Modal>

    <Modal open={editOpen} title="Modifica sprint" onclose={() => editOpen = false}>
        <form onsubmit={saveEdit} class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
                <Field label="Sconto (€)" type="number" step="0.01" min="0" bind:value={editForm.discount} placeholder="0.00"/>
                <Field label="Costo finale (€)" type="number" step="0.01" min="0" bind:value={editForm.price} placeholder="0.00"/>
            </div>
            <Field label="Nota" bind:value={editForm.note} multiline rows={3} placeholder="Nota dello sprint (diventa la descrizione in fattura)"/>
            {#if sprint.invoice_id}
                <p class="text-xs text-amber-300/90">Lo sprint è già fatturato: dopo aver salvato, usa "Aggiorna fattura" per propagare le modifiche al backoffice.</p>
            {/if}
            <div class="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onclick={() => editOpen = false}>Annulla</Button>
                <Button type="submit" loading={saving}>Salva</Button>
            </div>
        </form>
    </Modal>

    <Modal open={confirmInvoiceUpdate} title="Aggiornare la fattura?" onclose={() => confirmInvoiceUpdate = false}>
        <p class="text-slate-300">
            La fattura {sprint.invoice_number ? `n. ${sprint.invoice_number}${sprint.invoice_year ? `/${sprint.invoice_year}` : ''} ` : ''}sul backoffice
            verrà ri-sincronizzata con il costo finale attuale <strong>{formatCurrency(sprint.price)}</strong>.
            Numero e data restano invariati; i totali vengono ricalcolati. L'azione è verso un servizio esterno.
        </p>
        {#snippet footer()}
            <Button variant="ghost" onclick={() => confirmInvoiceUpdate = false}>Annulla</Button>
            <Button onclick={syncInvoice} loading={updatingInvoice}>Aggiorna fattura</Button>
        {/snippet}
    </Modal>

    <Modal open={confirmClose} title="Chiudere lo sprint?" onclose={() => confirmClose = false}>
        <p class="text-slate-300">
            Lo sprint verrà chiuso <strong>senza inviare la fattura</strong>. Tutti i suoi job verranno archiviati:
            spariscono dalla pagina Job e restano visibili solo da qui (storico sprint). Lo sprint non sarà più modificabile.
        </p>
        {#snippet footer()}
            <Button variant="ghost" onclick={() => confirmClose = false}>Annulla</Button>
            <Button variant="danger" onclick={closeSprint} loading={closing}>Chiudi sprint</Button>
        {/snippet}
    </Modal>
{/if}
