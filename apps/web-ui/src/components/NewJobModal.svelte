<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {statusLabel} from '../lib/format.js'
    import Button from './Button.svelte'
    import Modal from './Modal.svelte'
    import Field from './Field.svelte'

    // Se projectId è passato, il progetto è fisso (niente picker): usato dalla
    // pagina di un progetto. Altrimenti va passato `projects` per il picker
    // (vista globale /jobs).
    let {open = false, projects = [], projectId = undefined, onclose, oncreated} = $props()

    const statusOptions = ['pending', 'running', 'awaiting_merge', 'awaiting_clarification', 'completed', 'merged', 'failed']

    let submitting = $state(false)
    let form = $state({project_id: '', title: '', description: '', estimate: '', status: 'pending'})

    const selectClass = 'block w-full rounded-lg bg-slate-950/50 ring-1 ring-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 transition'

    $effect(() => {
        if (open) form = {project_id: projectId ?? projects[0]?._id ?? '', title: '', description: '', estimate: '', status: 'pending'}
    })

    const fixedProjectName = $derived(projects.find((p) => p._id === projectId)?.name ?? '(progetto corrente)')

    async function submit(e) {
        e.preventDefault()
        submitting = true
        try {
            const {project_id, ...data} = form
            await api.jobs.create(project_id, data)
            toast.success('Job creato e messo in coda')
            onclose?.()
            await oncreated?.()
        } catch (err) {
            toast.error(`Creazione fallita: ${err.message}`)
        } finally {
            submitting = false
        }
    }
</script>

<Modal {open} title="Nuovo job manuale" {onclose}>
    <form onsubmit={submit} class="space-y-4">
        {#if projectId}
            <div class="block">
                <span class="block text-sm font-medium text-slate-300 mb-1.5">Progetto</span>
                <div class="px-3 py-2 rounded-lg bg-slate-950/50 ring-1 ring-slate-800 text-slate-300">{fixedProjectName}</div>
            </div>
        {:else}
            <label class="block">
                <span class="block text-sm font-medium text-slate-300 mb-1.5">Progetto <span class="text-rose-400">*</span></span>
                <select bind:value={form.project_id} required class={selectClass}>
                    {#each projects as p (p._id)}
                        <option value={p._id}>{p.name ?? '(senza nome)'}</option>
                    {/each}
                </select>
                <span class="block text-xs text-slate-500 mt-1">Il repo del progetto in cui l'agente lavorerà.</span>
            </label>
        {/if}
        <Field label="Titolo" bind:value={form.title} required placeholder="Es. Aggiungi endpoint /metrics"
               hint="Usato come messaggio di commit."/>
        <Field label="Descrizione" bind:value={form.description} multiline rows={6}
               placeholder="Cosa deve fare l'agente. Più dettagli = meno domande."
               hint="Diventa il prompt per l'agente. Nessuna card ClickUp viene creata o aggiornata."/>
        <Field label="Stima (€)" type="number" step="0.01" min="0" bind:value={form.estimate}
               placeholder="0.00" hint="Forfait stimato del task, sommato nel forfait dello sprint."/>
        <label class="block">
            <span class="block text-sm font-medium text-slate-300 mb-1.5">Stato</span>
            <select bind:value={form.status} class={selectClass}>
                {#each statusOptions as s (s)}
                    <option value={s}>{statusLabel(s)}</option>
                {/each}
            </select>
            <span class="block text-xs text-slate-500 mt-1">Di norma resta "pending"; il worker lo prende in carico dalla coda.</span>
        </label>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => onclose?.()}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting}>Crea job</Button>
        </div>
    </form>
</Modal>
