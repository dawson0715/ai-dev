<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatDateOnly, formatCurrency} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import {TASK_STATUSES} from '../lib/taskStatus.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import Modal from '../components/Modal.svelte'
    import Field from '../components/Field.svelte'
    import Select from '../components/Select.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'

    let clients = $state([])
    let tasks = $state([])
    let loading = $state(true)
    let submitting = $state(false)

    // Filtri
    let filterClient = $state('')
    let filterStatus = $state('')

    // Selezione per creazione sprint
    let selected = $state(new Set())

    // Modali
    let taskModalOpen = $state(false)
    let editingId = $state(null)
    let form = $state(emptyForm())

    let sprintModalOpen = $state(false)
    let sprintNote = $state('')

    function emptyForm() {
        return {
            client_id: '',
            project_name: '',
            description: '',
            delivery_date: '',
            price: '',
            status: 'preventivo'
        }
    }

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const clientOptions = $derived(clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'})))
    const statusOptions = TASK_STATUSES

    async function load() {
        loading = true
        try {
            const [cs, ts] = await Promise.all([
                api.clients.list(),
                api.tasks.list({
                    client_id: filterClient || undefined,
                    status: filterStatus || undefined
                })
            ])
            clients = cs
            tasks = ts
            selected = new Set()
        } catch (e) {
            toast.error(`Errore caricamento task: ${e.message}`)
        } finally {
            loading = false
        }
    }

    function openCreate() {
        editingId = null
        form = emptyForm()
        if (filterClient) form.client_id = filterClient
        taskModalOpen = true
    }

    function openEdit(task) {
        editingId = task._id
        form = {
            client_id: task.client_id,
            project_name: task.project_name ?? '',
            description: task.description ?? '',
            delivery_date: task.delivery_date ? new Date(task.delivery_date).toISOString().slice(0, 10) : '',
            price: task.price ?? '',
            status: task.status ?? 'preventivo'
        }
        taskModalOpen = true
    }

    async function submitTask(e) {
        e.preventDefault()
        submitting = true
        try {
            if (editingId) {
                const {client_id, ...rest} = form
                await api.tasks.update(editingId, rest)
                toast.success('Task aggiornato')
            } else {
                await api.tasks.create(form)
                toast.success('Task creato')
            }
            taskModalOpen = false
            await load()
        } catch (e) {
            toast.error(`Operazione fallita: ${e.message}`)
        } finally {
            submitting = false
        }
    }

    async function removeTask(task) {
        try {
            await api.tasks.remove(task._id)
            toast.success('Task eliminato')
            await load()
        } catch (e) {
            toast.error(`Eliminazione fallita: ${e.message}`)
        }
    }

    function toggleSelect(id) {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        selected = next
    }

    async function createSprint(e) {
        e.preventDefault()
        if (!filterClient) {
            toast.error('Seleziona un cliente nel filtro per creare uno sprint')
            return
        }
        submitting = true
        try {
            const r = await api.sprints.create({
                client_id: filterClient,
                task_ids: [...selected],
                note: sprintNote
            })
            toast.success(`Sprint creato (totale ${formatCurrency(r.total)})`)
            sprintModalOpen = false
            sprintNote = ''
            go(`/sprints/${r.sprint_id}`)
        } catch (e) {
            toast.error(`Creazione sprint fallita: ${e.message}`)
        } finally {
            submitting = false
        }
    }

    // Task selezionabili: senza sprint assegnato.
    const selectableTasks = $derived(tasks.filter((t) => !t.sprint_id))
    const canCreateSprint = $derived(Boolean(filterClient) && selected.size > 0)

    $effect(() => {
        filterClient
        filterStatus
        load()
    })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Task</h1>
        <p class="text-slate-400 text-sm mt-1">Attività preventivate per cliente.</p>
    </div>
    <Button onclick={openCreate}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo task
    </Button>
</div>

<Card padding="sm" class="mb-5">
    <div class="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div class="flex-1">
            <Select label="Cliente" bind:value={filterClient} placeholder="Tutti i clienti"
                    options={[{value: '', label: 'Tutti i clienti'}, ...clientOptions]}/>
        </div>
        <div class="flex-1">
            <Select label="Stato" bind:value={filterStatus}
                    options={[{value: '', label: 'Tutti gli stati'}, ...statusOptions]}/>
        </div>
        {#if canCreateSprint}
            <Button onclick={() => sprintModalOpen = true}>
                Crea sprint ({selected.size})
            </Button>
        {/if}
    </div>
    {#if filterClient && selectableTasks.length > 0 && !canCreateSprint}
        <p class="text-xs text-slate-500 mt-3">Seleziona uno o più task non assegnati per raggrupparli in uno sprint.</p>
    {/if}
</Card>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if tasks.length === 0}
    <Card>
        <EmptyState title="Nessun task" description="Crea il primo task preventivato per un cliente.">
            {#snippet action()}
                <Button onclick={openCreate}>Nuovo task</Button>
            {/snippet}
        </EmptyState>
    </Card>
{:else}
    <Card padding="none">
        <ul class="divide-y divide-slate-800">
            {#each tasks as task (task._id)}
                <li class="px-4 sm:px-6 py-4 flex items-center gap-3">
                    {#if filterClient && !task.sprint_id}
                        <input
                            type="checkbox"
                            checked={selected.has(task._id)}
                            onchange={() => toggleSelect(task._id)}
                            class="h-4 w-4 rounded border-slate-700 bg-slate-950 text-brand-500 focus:ring-brand-500"/>
                    {/if}
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                            <StatusBadge status={task.status}/>
                            {#if task.sprint_id}
                                <button onclick={() => go(`/sprints/${task.sprint_id}`)}
                                        class="text-xs text-brand-300 hover:underline">in sprint</button>
                            {/if}
                            {#if task.paid}<span class="text-xs text-emerald-300">pagato</span>{/if}
                        </div>
                        <div class="font-medium text-slate-100 truncate">{task.project_name || '(senza nome)'}</div>
                        <div class="text-xs text-slate-500 mt-0.5 truncate">
                            {clientName[task.client_id] ?? '—'}
                            {#if task.delivery_date} · consegna {formatDateOnly(task.delivery_date)}{/if}
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="font-semibold text-slate-100 tabular-nums">{formatCurrency(task.price)}</div>
                        <div class="flex gap-2 justify-end mt-1">
                            <button onclick={() => openEdit(task)} class="text-xs text-slate-400 hover:text-slate-200">Modifica</button>
                            {#if !task.sprint_id}
                                <button onclick={() => removeTask(task)} class="text-xs text-rose-400 hover:text-rose-300">Elimina</button>
                            {/if}
                        </div>
                    </div>
                </li>
            {/each}
        </ul>
    </Card>
{/if}

<Modal open={taskModalOpen} title={editingId ? 'Modifica task' : 'Nuovo task'} onclose={() => taskModalOpen = false}>
    <form onsubmit={submitTask} class="space-y-4">
        {#if !editingId}
            <Select label="Cliente" bind:value={form.client_id} required placeholder="Seleziona cliente"
                    options={clientOptions}/>
        {/if}
        <Field label="Nome progetto" bind:value={form.project_name} required placeholder="Es. Restyling sito"/>
        <Field label="Descrizione" bind:value={form.description} multiline rows={3}/>
        <div class="grid grid-cols-2 gap-3">
            <Field label="Data consegna" type="date" bind:value={form.delivery_date}/>
            <Field label="Prezzo (€)" type="number" bind:value={form.price} placeholder="0.00"/>
        </div>
        <Select label="Stato" bind:value={form.status} options={TASK_STATUSES}/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => taskModalOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting}>{editingId ? 'Salva' : 'Crea'}</Button>
        </div>
    </form>
</Modal>

<Modal open={sprintModalOpen} title="Crea sprint" onclose={() => sprintModalOpen = false}>
    <form onsubmit={createSprint} class="space-y-4">
        <p class="text-sm text-slate-400">
            {selected.size} task selezionati per <strong class="text-slate-200">{clientName[filterClient] ?? ''}</strong>.
            Verranno raggruppati e marcati come "approvato".
        </p>
        <Field label="Nota" bind:value={sprintNote} multiline rows={2} placeholder="Nota opzionale sullo sprint"/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => sprintModalOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting}>Crea sprint</Button>
        </div>
    </form>
</Modal>
