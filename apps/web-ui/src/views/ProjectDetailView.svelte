<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatDate, formatRelative} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import StatusBadge from '../components/StatusBadge.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'
    import Modal from '../components/Modal.svelte'
    import Field from '../components/Field.svelte'

    let {projectId} = $props()

    let project = $state(null)
    let jobs = $state([])
    let loading = $state(true)
    let syncing = $state(false)
    let editOpen = $state(false)
    let confirmDelete = $state(false)
    let editForm = $state({name: '', clickup_list_id: '', gitlab_url: '', gitlab_service_account: '', gitlab_default_branch: ''})
    let saving = $state(false)

    async function load() {
        loading = true
        try {
            const [p, j] = await Promise.all([
                api.projects.get(projectId),
                api.projects.jobs(projectId)
            ])
            project = p
            jobs = j
            editForm = {
                name: p.name ?? '',
                clickup_list_id: p.clickup?.list_id ?? '',
                gitlab_url: p.gitlab?.url ?? '',
                gitlab_service_account: p.gitlab?.service_account ?? '',
                gitlab_default_branch: p.gitlab?.default_branch ?? ''
            }
        } catch (e) {
            toast.error(`Errore: ${e.message}`)
        } finally {
            loading = false
        }
    }

    async function sync() {
        syncing = true
        try {
            const r = await api.projects.sync(projectId)
            if (r.warning) toast.info(r.warning)
            else toast.success(`${r.created} nuovi job importati`)
            await load()
        } catch (e) {
            toast.error(`Sync fallita: ${e.message}`)
        } finally {
            syncing = false
        }
    }

    async function save(e) {
        e.preventDefault()
        saving = true
        try {
            await api.projects.update(projectId, {...editForm})
            toast.success('Progetto aggiornato')
            editOpen = false
            await load()
        } catch (e) {
            toast.error(`Aggiornamento fallito: ${e.message}`)
        } finally {
            saving = false
        }
    }

    async function remove() {
        try {
            await api.projects.remove(projectId)
            toast.success('Progetto eliminato')
            go('/projects')
        } catch (e) {
            toast.error(`Eliminazione fallita: ${e.message}`)
        }
    }

    $effect(() => {
        projectId
        load()
    })

    const counts = $derived.by(() => {
        const acc = {pending: 0, running: 0, completed: 0, failed: 0, awaiting_clarification: 0}
        for (const j of jobs) {
            if (acc[j.status] !== undefined) acc[j.status]++
        }
        return acc
    })
</script>

<a href="#/projects" class="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
    Progetti
</a>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if !project}
    <Card><EmptyState title="Progetto non trovato"/></Card>
{:else}
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div class="min-w-0">
            <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100 truncate">{project.name}</h1>
        </div>
        <div class="flex flex-wrap gap-2">
            <Button variant="secondary" onclick={sync} loading={syncing} disabled={syncing}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>
                Sync ClickUp
            </Button>
            <Button variant="ghost" onclick={() => editOpen = true}>Modifica</Button>
            <Button variant="danger" size="md" onclick={() => confirmDelete = true}>Elimina</Button>
        </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {#each [['Pending', counts.pending, 'amber'], ['Running', counts.running, 'sky'], ['Completed', counts.completed, 'emerald'], ['Failed', counts.failed, 'rose']] as [label, n, color]}
            <Card padding="sm">
                <div class="text-xs uppercase tracking-wider text-slate-500">{label}</div>
                <div class="text-2xl font-bold mt-1 text-{color}-300">{n}</div>
            </Card>
        {/each}
    </div>

    <Card padding="none">
        <div class="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 class="font-semibold text-slate-100">Job</h2>
            <span class="text-xs text-slate-500">{jobs.length} totali</span>
        </div>

        {#if jobs.length === 0}
            <EmptyState
                title="Nessun job"
                description="Premi 'Sync ClickUp' per importare i task in stato Todo della lista.">
                {#snippet action()}
                    <Button onclick={sync} loading={syncing}>Sync ora</Button>
                {/snippet}
            </EmptyState>
        {:else}
            <ul class="divide-y divide-slate-800">
                {#each jobs as job (job._id)}
                    <li>
                        <button
                            onclick={() => go(`/jobs/${job._id}`)}
                            class="w-full text-left px-4 sm:px-6 py-4 hover:bg-slate-800/40 transition flex flex-col sm:flex-row sm:items-center gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <StatusBadge status={job.status}/>
                                    {#if job.clickup?.task_id}
                                        <span class="text-xs text-slate-500 font-mono truncate">{job.clickup.task_id}</span>
                                    {:else}
                                        <span class="text-xs text-slate-400 px-1.5 py-0.5 rounded ring-1 ring-inset ring-slate-700">manuale</span>
                                    {/if}
                                </div>
                                <div class="font-medium text-slate-100 truncate">{job.title ?? job.clickup?.title ?? '(senza titolo)'}</div>
                            </div>
                            <div class="flex items-center gap-4 text-xs text-slate-500 shrink-0">
                                <span>{formatRelative(job.created_at)}</span>
                                <svg class="hidden sm:block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                            </div>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </Card>
{/if}

<Modal open={editOpen} title="Modifica progetto" onclose={() => editOpen = false}>
    <form onsubmit={save} class="space-y-4">
        <Field label="Nome" bind:value={editForm.name}/>
        <Field label="ClickUp list ID" bind:value={editForm.clickup_list_id}/>
        <Field label="GitLab URL" bind:value={editForm.gitlab_url}/>
        <Field label="GitLab service account" bind:value={editForm.gitlab_service_account} placeholder="nome-gruppo"
               hint="Path del gruppo top-level. Il token vive nel worker in GITLAB_SERVICE_ACCOUNTS."/>
        <Field label="Branch di default" bind:value={editForm.gitlab_default_branch} placeholder="main"/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => editOpen = false}>Annulla</Button>
            <Button type="submit" loading={saving}>Salva</Button>
        </div>
    </form>
</Modal>

<Modal open={confirmDelete} title="Eliminare il progetto?" onclose={() => confirmDelete = false}>
    <p class="text-slate-300">Il documento verrà rimosso da MongoDB. Il clone in <code>/opt/cache</code> e i job esistenti restano.</p>
    {#snippet footer()}
        <Button variant="ghost" onclick={() => confirmDelete = false}>Annulla</Button>
        <Button variant="danger" onclick={remove}>Elimina</Button>
    {/snippet}
</Modal>
