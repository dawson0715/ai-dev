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
    import Select from '../components/Select.svelte'
    import NewJobModal from '../components/NewJobModal.svelte'
    import {SERVICE_NAMES} from '../lib/serviceName.js'
    import {TASK_SOURCES} from '../lib/taskSource.js'

    let {projectId} = $props()

    let project = $state(null)
    let jobs = $state([])
    let clients = $state([])
    let gitlabServiceAccounts = $state([])
    let loading = $state(true)
    let syncing = $state(false)
    let editOpen = $state(false)
    let jobModalOpen = $state(false)
    let confirmDelete = $state(false)
    let editForm = $state({
        name: '',
        client_id: '',
        service_name: '',
        task_source: 'clickup',
        clickup_list_id: '',
        gitlab_url: '',
        gitlab_service_account: '',
        gitlab_default_branch: ''
    })
    let saving = $state(false)

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const clientOptions = $derived([
        {value: '', label: 'Nessun cliente'},
        ...clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'}))
    ])
    const gitlabServiceAccountOptions = $derived.by(() => {
        const options = gitlabServiceAccounts.map((name) => ({value: name, label: name}))
        const current = editForm.gitlab_service_account
        if (current && !gitlabServiceAccounts.includes(current)) {
            options.push({value: current, label: `${current} (non configurato)`})
        }
        return options
    })

    async function load() {
        loading = true
        try {
            const [p, j, cs, gitlabConfig] = await Promise.all([
                api.projects.get(projectId),
                api.projects.jobs(projectId),
                api.clients.list(),
                api.gitlab.serviceAccounts()
            ])
            project = p
            jobs = j
            clients = cs
            gitlabServiceAccounts = gitlabConfig.service_accounts ?? []
            editForm = {
                name: p.name ?? '',
                client_id: p.client_id ?? '',
                service_name: p.service_name ?? '',
                task_source: p.task_source ?? 'clickup',
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
        const acc = {pending: 0, running: 0, awaiting_merge: 0, merged: 0, completed: 0, failed: 0, awaiting_clarification: 0}
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
            <p class="text-slate-400 text-sm mt-1 truncate">
                {project.client_id ? (clientName[project.client_id] ?? 'Cliente sconosciuto') : 'Nessun cliente'}
            </p>
        </div>
        <div class="flex flex-wrap gap-2">
            {#if project.task_source !== 'manual'}
                <Button variant="secondary" onclick={sync} loading={syncing} disabled={syncing}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>
                    {project.task_source === 'gitlab_issues' ? 'Sync GitLab issues' : 'Sync ClickUp'}
                </Button>
            {/if}
            <Button variant="secondary" onclick={() => jobModalOpen = true}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
                Nuovo job
            </Button>
            <Button variant="ghost" onclick={() => editOpen = true}>Modifica</Button>
            <Button variant="danger" size="md" onclick={() => confirmDelete = true}>Elimina</Button>
        </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {#each [['Pending', counts.pending, 'amber'], ['Running', counts.running, 'sky'], ['Attesa merge', counts.awaiting_merge, 'indigo'], ['Merged', counts.merged + counts.completed, 'emerald'], ['Failed', counts.failed, 'rose']] as [label, n, color]}
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
                description={project.task_source === 'manual'
                    ? "Progetto manuale: crea un job con 'Nuovo job'."
                    : "Premi 'Sync' per importare i task disponibili."}>
                {#snippet action()}
                    {#if project.task_source !== 'manual'}
                        <Button onclick={sync} loading={syncing}>Sync ora</Button>
                    {/if}
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
        <Select label="Cliente" bind:value={editForm.client_id} options={clientOptions}
                hint="Cliente a cui appartiene il progetto (per la fatturazione a sprint)."/>
        <Select label="Servizio" bind:value={editForm.service_name} options={SERVICE_NAMES} placeholder="Seleziona un servizio"/>
        <Select label="Origine task" bind:value={editForm.task_source} options={TASK_SOURCES}
                hint="Da dove importare i task del progetto."/>
        {#if editForm.task_source === 'clickup'}
            <Field label="ClickUp list ID" bind:value={editForm.clickup_list_id}/>
        {/if}
        <Field label="GitLab URL" bind:value={editForm.gitlab_url}/>
        <Select label="GitLab service account" bind:value={editForm.gitlab_service_account}
                options={gitlabServiceAccountOptions} required
                placeholder={gitlabServiceAccountOptions.length ? 'Seleziona un service account' : 'Nessun service account configurato'}
                hint="Il menu espone solo i nomi configurati in GITLAB_SERVICE_ACCOUNTS, mai le credenziali."/>
        <Field label="Branch di default" bind:value={editForm.gitlab_default_branch} placeholder="main"/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => editOpen = false}>Annulla</Button>
            <Button type="submit" loading={saving}>Salva</Button>
        </div>
    </form>
</Modal>

<NewJobModal open={jobModalOpen} projects={project ? [project] : []} projectId={projectId}
             onclose={() => jobModalOpen = false} oncreated={load}/>

<Modal open={confirmDelete} title="Eliminare il progetto?" onclose={() => confirmDelete = false}>
    <p class="text-slate-300">Il documento verrà rimosso da MongoDB. Il clone in <code>/opt/cache</code> e i job esistenti restano.</p>
    {#snippet footer()}
        <Button variant="ghost" onclick={() => confirmDelete = false}>Annulla</Button>
        <Button variant="danger" onclick={remove}>Elimina</Button>
    {/snippet}
</Modal>
