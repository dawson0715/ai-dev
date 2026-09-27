<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import {go, router} from '../lib/router.svelte.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import Modal from '../components/Modal.svelte'
    import Field from '../components/Field.svelte'
    import Select from '../components/Select.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'
    import {serviceLabel} from '../lib/serviceName.js'
    import {TASK_SOURCES} from '../lib/taskSource.js'
    import {sortByClientName} from '../lib/projectSort.js'

    let projects = $state([])
    let clients = $state([])
    let gitlabServiceAccounts = $state([])
    let loading = $state(true)
    let modalOpen = $state(false)
    let submitting = $state(false)

    let form = $state({
        name: '',
        client_id: '',
        task_source: 'clickup',
        clickup_list_id: '',
        gitlab_url: '',
        gitlab_service_account: ''
    })

    const clientName = $derived(Object.fromEntries(clients.map((c) => [c._id, c.name || '(senza nome)'])))
    const clientOptions = $derived([
        {value: '', label: 'Nessun cliente'},
        ...clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'}))
    ])
    const gitlabServiceAccountOptions = $derived(
        gitlabServiceAccounts.map((name) => ({value: name, label: serviceLabel(name)}))
    )
    const sortedProjects = $derived(sortByClientName(projects, clientName))

    // Filtri riflessi nell'URL (#/projects?client=<id>&archived=1, `none` = senza cliente).
    // I progetti archiviati li esclude il backend, salvo `archived=1`.
    const NO_CLIENT = 'none'
    const clientFilter = $derived(router.current.params.client ?? '')
    const showArchived = $derived(router.current.params.archived === '1')
    const clientFilterOptions = $derived([
        {value: '', label: 'Tutti i clienti'},
        {value: NO_CLIENT, label: 'Nessun cliente'},
        ...clients.map((c) => ({value: c._id, label: c.name || '(senza nome)'}))
    ])
    const filteredProjects = $derived(sortedProjects.filter((p) => {
        if (clientFilter === '') return true
        if (clientFilter === NO_CLIENT) return !p.client_id
        return p.client_id === clientFilter
    }))
    const hasFilters = $derived(clientFilter !== '' || showArchived)

    function setClientFilter(value) {
        router.setParams({...router.current.params, client: value})
    }

    function setShowArchived(value) {
        router.setParams({...router.current.params, archived: value ? '1' : ''})
    }

    function resetFilters() {
        router.setParams({})
    }

    async function loadMeta() {
        try {
            const [cs, gitlabConfig] = await Promise.all([
                api.clients.list(),
                api.gitlab.serviceAccounts()
            ])
            clients = cs
            gitlabServiceAccounts = gitlabConfig.service_accounts ?? []
        } catch (e) {
            toast.error(`Errore caricamento progetti: ${e.message}`)
        }
    }

    async function loadProjects(includeArchived) {
        try {
            projects = await api.projects.list({includeArchived})
        } catch (e) {
            toast.error(`Errore caricamento progetti: ${e.message}`)
        } finally {
            loading = false
        }
    }

    function resetForm() {
        form = {
            name: '',
            client_id: '',
            task_source: 'clickup',
            clickup_list_id: '',
            gitlab_url: '',
            gitlab_service_account: ''
        }
    }

    async function submit(e) {
        e.preventDefault()
        submitting = true
        try {
            await api.projects.create(form)
            toast.success('Progetto creato')
            modalOpen = false
            resetForm()
            await loadProjects(showArchived)
        } catch (e) {
            toast.error(`Creazione fallita: ${e.message}`)
        } finally {
            submitting = false
        }
    }

    $effect(() => { loadMeta() })
    // Ricarica dal backend quando cambia il toggle "Mostra archiviati".
    $effect(() => { loadProjects(showArchived) })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Progetti</h1>
        <p class="text-slate-400 text-sm mt-1">Collega un repo GitLab a task ClickUp, issue GitLab o job manuali.</p>
    </div>
    <Button onclick={() => modalOpen = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo progetto
    </Button>
</div>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else}
    <div class="mb-4 flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-6">
        <div class="sm:w-72">
            <Select label="Cliente" value={clientFilter} options={clientFilterOptions}
                    onchange={(e) => setClientFilter(e.currentTarget.value)}/>
        </div>
        <label class="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer sm:pb-2.5">
            <input type="checkbox" checked={showArchived}
                   onchange={(e) => setShowArchived(e.currentTarget.checked)}
                   class="h-4 w-4 rounded border-slate-700 bg-slate-950/50 accent-brand-500"/>
            Mostra archiviati
        </label>
    </div>
    {#if projects.length === 0 && !hasFilters}
        <Card>
            <EmptyState
                title="Nessun progetto"
                description="Crea il primo progetto e scegli se importare task o gestirli manualmente.">
                {#snippet action()}
                    <Button onclick={() => modalOpen = true}>Crea progetto</Button>
                {/snippet}
            </EmptyState>
        </Card>
    {:else if filteredProjects.length === 0}
        <Card>
            <EmptyState
                title="Nessun progetto"
                description="Nessun progetto corrisponde ai filtri selezionati.">
                {#snippet action()}
                    <Button variant="ghost" onclick={resetFilters}>Azzera filtri</Button>
                {/snippet}
            </EmptyState>
        </Card>
    {/if}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each filteredProjects as p (p._id)}
            <button
                onclick={() => go(`/projects/${p._id}`)}
                class="text-left group">
                <Card class="hover:ring-brand-500/40 transition cursor-pointer h-full {p.archived ? 'opacity-60' : ''}">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/30 to-brand-700/30 ring-1 ring-brand-500/30 flex items-center justify-center text-brand-200 font-semibold">
                            {(p.name ?? '?').slice(0, 1).toUpperCase()}
                        </div>
                        <svg class="text-slate-500 group-hover:text-brand-300 transition" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                    </div>
                    <div class="flex items-center gap-2 min-w-0">
                        <h3 class="font-semibold text-slate-100 truncate">{p.name ?? '(senza nome)'}</h3>
                        {#if p.archived}
                            <span class="shrink-0 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 ring-1 ring-slate-700">Archiviato</span>
                        {/if}
                    </div>
                    <p class="text-xs text-slate-500 mt-1 truncate">
                        {p.client_id ? (clientName[p.client_id] ?? 'Cliente sconosciuto') : 'Nessun cliente'}
                    </p>
                    <div class="mt-4 flex items-center justify-between text-xs">
                        <span class="text-slate-500">
                            {#if (p.task_source ?? 'clickup') === 'gitlab_issues'}
                                GitLab Issues
                            {:else if p.task_source === 'manual'}
                                Solo manuale
                            {:else}
                                List <code class="text-slate-400">{p.clickup?.list_id ?? '—'}</code>
                            {/if}
                        </span>
                        <span class="text-slate-500">{formatRelative(p.created_at)}</span>
                    </div>
                </Card>
            </button>
        {/each}
    </div>
{/if}

<Modal open={modalOpen} title="Nuovo progetto" onclose={() => modalOpen = false}>
    <form onsubmit={submit} class="space-y-4">
        <Field label="Nome" bind:value={form.name} required placeholder="Il mio progetto"/>
        <Select label="Cliente" bind:value={form.client_id} options={clientOptions}
                hint="Cliente a cui appartiene il progetto (per la fatturazione a sprint)."/>
        <Select label="Servizio" bind:value={form.gitlab_service_account}
                options={gitlabServiceAccountOptions} required
                placeholder={gitlabServiceAccounts.length ? 'Seleziona un servizio' : 'Nessun servizio configurato'}
                hint={gitlabServiceAccounts.length
                    ? 'Il servizio identifica il service account GitLab configurato; le credenziali non vengono esposte.'
                    : 'Configura GITLAB_SERVICE_ACCOUNTS nel servizio API per creare un progetto.'}/>
        <Select label="Origine task" bind:value={form.task_source} options={TASK_SOURCES}
                hint="Da dove importare i task del progetto."/>
        {#if form.task_source === 'clickup'}
            <Field label="ClickUp list ID" bind:value={form.clickup_list_id} required placeholder="901xxxxxxxx"
                   hint="Identificatore della lista ClickUp da cui leggere i task."/>
        {/if}
        <Field label="GitLab repo URL" bind:value={form.gitlab_url} required placeholder="https://gitlab.com/org/repo.git"/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => modalOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting || gitlabServiceAccounts.length === 0}>Crea</Button>
        </div>
    </form>
</Modal>
