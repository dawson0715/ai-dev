<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import EmptyState from '../components/EmptyState.svelte'
    import Field from '../components/Field.svelte'
    import Modal from '../components/Modal.svelte'
    import Spinner from '../components/Spinner.svelte'

    function emptyForm() {
        return {external_id: '', name: '', email: '', numbers: '', hourly_rate_eur: ''}
    }

    let clients = $state([])
    let loading = $state(true)
    let editorOpen = $state(false)
    let editingId = $state(null)
    let submitting = $state(false)
    let deleteOpen = $state(false)
    let deleting = $state(false)
    let clientToDelete = $state(null)
    let form = $state(emptyForm())

    async function load() {
        loading = true
        try {
            clients = await api.clients.list()
        } catch (e) {
            toast.error(`Errore caricamento clienti: ${e.message}`)
        } finally {
            loading = false
        }
    }

    function openCreate() {
        editingId = null
        form = emptyForm()
        editorOpen = true
    }

    function openEdit(client) {
        editingId = client._id
        form = {
            external_id: client.external_id ?? '',
            name: client.name ?? '',
            email: client.email ?? '',
            numbers: (client.numbers ?? []).join('\n'),
            hourly_rate_eur: client.hourly_rate_eur ? String(client.hourly_rate_eur) : ''
        }
        editorOpen = true
    }

    function parseNumbers(value) {
        return String(value ?? '')
            .split(/[\n,;]+/)
            .map((number) => number.trim())
            .filter(Boolean)
    }

    async function submit(e) {
        e.preventDefault()
        submitting = true
        const payload = {
            external_id: form.external_id,
            name: form.name,
            email: form.email,
            numbers: parseNumbers(form.numbers),
            hourly_rate_eur: form.hourly_rate_eur
        }

        try {
            if (editingId) {
                await api.clients.update(editingId, payload)
                toast.success('Cliente aggiornato')
            } else {
                await api.clients.create(payload)
                toast.success('Cliente creato')
            }
            editorOpen = false
            await load()
        } catch (e) {
            toast.error(`${editingId ? 'Aggiornamento' : 'Creazione'} fallita: ${e.message}`)
        } finally {
            submitting = false
        }
    }

    function askDelete(client) {
        clientToDelete = client
        deleteOpen = true
    }

    async function removeClient() {
        if (!clientToDelete) return
        deleting = true
        try {
            await api.clients.remove(clientToDelete._id)
            toast.success('Cliente eliminato')
            deleteOpen = false
            clientToDelete = null
            await load()
        } catch (e) {
            toast.error(`Eliminazione fallita: ${e.message}`)
        } finally {
            deleting = false
        }
    }

    $effect(() => { load() })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Clienti</h1>
        <p class="text-slate-400 text-sm mt-1">Gestisci anagrafica, contatti e collegamento con il backoffice.</p>
    </div>
    <Button onclick={openCreate}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo cliente
    </Button>
</div>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if clients.length === 0}
    <Card>
        <EmptyState title="Nessun cliente" description="Crea il primo cliente per associarlo a progetti, job e sprint.">
            {#snippet action()}
                <Button onclick={openCreate}>Crea cliente</Button>
            {/snippet}
        </EmptyState>
    </Card>
{:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each clients as client (client._id)}
            <Card class="h-full flex flex-col">
                <div class="flex items-start gap-3">
                    <div class="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-brand-500/30 to-brand-700/30 ring-1 ring-brand-500/30 flex items-center justify-center text-brand-200 font-semibold text-lg">
                        {(client.name ?? '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div class="min-w-0 flex-1">
                        <h2 class="font-semibold text-slate-100 truncate">{client.name || '(senza nome)'}</h2>
                        <p class="text-xs text-slate-500 mt-0.5 truncate">ID backoffice: {client.external_id || '—'}</p>
                        {#if client.hourly_rate_eur}
                            <p class="text-xs text-slate-500 mt-0.5 truncate">Tariffa: {client.hourly_rate_eur}€/h</p>
                        {/if}
                    </div>
                </div>

                <div class="mt-5 space-y-2 text-sm flex-1">
                    <div class="flex items-center gap-2 text-slate-400 min-w-0">
                        <svg class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4zM22 6l-10 7L2 6"/></svg>
                        {#if client.email}
                            <a class="truncate hover:text-brand-300" href={`mailto:${client.email}`}>{client.email}</a>
                        {:else}
                            <span class="text-slate-600">Email non indicata</span>
                        {/if}
                    </div>
                    <div class="flex items-start gap-2 text-slate-400 min-w-0">
                        <svg class="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.3 1.73.5 2.63.62A2 2 0 0 1 22 16.92z"/></svg>
                        {#if client.numbers?.length}
                            <span class="break-words">{client.numbers.join(', ')}</span>
                        {:else}
                            <span class="text-slate-600">Nessun numero</span>
                        {/if}
                    </div>
                </div>

                <div class="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
                    <span class="text-xs text-slate-600">Aggiornato {formatRelative(client.updated_at ?? client.created_at)}</span>
                    <div class="flex gap-1">
                        <Button variant="ghost" size="sm" onclick={() => openEdit(client)} aria-label={`Modifica ${client.name}`}>
                            Modifica
                        </Button>
                        <Button variant="ghost" size="sm" class="text-rose-300 hover:text-rose-200" onclick={() => askDelete(client)} aria-label={`Elimina ${client.name}`}>
                            Elimina
                        </Button>
                    </div>
                </div>
            </Card>
        {/each}
    </div>
{/if}

<Modal open={editorOpen} title={editingId ? 'Modifica cliente' : 'Nuovo cliente'} onclose={() => editorOpen = false}>
    <form onsubmit={submit} class="space-y-4">
        <Field label="ID backoffice" bind:value={form.external_id} required placeholder="1234"
               hint="Identificativo univoco usato per fatture e sincronizzazione."/>
        <Field label="Nome" bind:value={form.name} required placeholder="Azienda S.r.l."/>
        <Field label="Email" type="email" bind:value={form.email} placeholder="amministrazione@azienda.it"/>
        <Field label="Numeri di telefono" bind:value={form.numbers} multiline rows={3}
               placeholder={'+39 02 123456\n+39 333 1234567'}
               hint="Inserisci un numero per riga; sono accettati anche virgole e punti e virgola."/>
        <Field label="Tariffa oraria (€)" type="number" step="0.01" min="0" bind:value={form.hourly_rate_eur}
               placeholder="0.00"
               hint="Usata per calcolare la Stima (€) dei job dal tempo umano stimato dall'agente. Vuoto/0 = nessun calcolo automatico."/>

        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => editorOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting}>
                {editingId ? 'Salva modifiche' : 'Crea cliente'}
            </Button>
        </div>
    </form>
</Modal>

<Modal open={deleteOpen} title="Elimina cliente" onclose={() => deleteOpen = false}>
    <p class="text-sm text-slate-300">
        Vuoi eliminare <strong class="text-slate-100">{clientToDelete?.name ?? 'questo cliente'}</strong>?
        I progetti, i job e gli sprint già collegati non verranno eliminati.
    </p>
    <div class="flex justify-end gap-2 pt-6">
        <Button variant="ghost" onclick={() => deleteOpen = false}>Annulla</Button>
        <Button variant="danger" loading={deleting} disabled={deleting} onclick={removeClient}>Elimina</Button>
    </div>
</Modal>
