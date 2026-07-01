<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Button from '../components/Button.svelte'
    import Card from '../components/Card.svelte'
    import Modal from '../components/Modal.svelte'
    import Field from '../components/Field.svelte'
    import Select from '../components/Select.svelte'
    import Spinner from '../components/Spinner.svelte'
    import EmptyState from '../components/EmptyState.svelte'
    import {SERVICE_NAMES} from '../lib/serviceName.js'
    import {TASK_SOURCES} from '../lib/taskSource.js'
    import {sortByClientName} from '../lib/projectSort.js'

    let projects = $state([])
    let clients = $state([])
    let loading = $state(true)
    let modalOpen = $state(false)
    let submitting = $state(false)

    let form = $state({
        name: '',
        client_id: '',
        service_name: '',
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
    const sortedProjects = $derived(sortByClientName(projects, clientName))

    async function load() {
        loading = true
        try {
            const [ps, cs] = await Promise.all([api.projects.list(), api.clients.list()])
            projects = ps
            clients = cs
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
            service_name: '',
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
            await load()
        } catch (e) {
            toast.error(`Creazione fallita: ${e.message}`)
        } finally {
            submitting = false
        }
    }

    $effect(() => { load() })
</script>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">Progetti</h1>
        <p class="text-slate-400 text-sm mt-1">Mappa una lista ClickUp a un repo GitLab.</p>
    </div>
    <Button onclick={() => modalOpen = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Nuovo progetto
    </Button>
</div>

{#if loading}
    <div class="flex justify-center py-16"><Spinner size={32}/></div>
{:else if projects.length === 0}
    <Card>
        <EmptyState
            title="Nessun progetto"
            description="Crea il primo progetto per iniziare a importare task da ClickUp.">
            {#snippet action()}
                <Button onclick={() => modalOpen = true}>Crea progetto</Button>
            {/snippet}
        </EmptyState>
    </Card>
{:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each sortedProjects as p (p._id)}
            <button
                onclick={() => go(`/projects/${p._id}`)}
                class="text-left group">
                <Card class="hover:ring-brand-500/40 transition cursor-pointer h-full">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/30 to-brand-700/30 ring-1 ring-brand-500/30 flex items-center justify-center text-brand-200 font-semibold">
                            {(p.name ?? '?').slice(0, 1).toUpperCase()}
                        </div>
                        <svg class="text-slate-500 group-hover:text-brand-300 transition" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                    </div>
                    <h3 class="font-semibold text-slate-100 truncate">{p.name ?? '(senza nome)'}</h3>
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
        <Select label="Servizio" bind:value={form.service_name} options={SERVICE_NAMES} placeholder="Seleziona un servizio"/>
        <Select label="Origine task" bind:value={form.task_source} options={TASK_SOURCES}
                hint="Da dove importare i task del progetto."/>
        {#if form.task_source === 'clickup'}
            <Field label="ClickUp list ID" bind:value={form.clickup_list_id} required placeholder="901xxxxxxxx"
                   hint="Identificatore della lista ClickUp da cui leggere i task."/>
        {/if}
        <Field label="GitLab repo URL" bind:value={form.gitlab_url} required placeholder="https://gitlab.com/org/repo.git"/>
        <Field label="GitLab service account" bind:value={form.gitlab_service_account} required placeholder="nome-gruppo"
               hint="Nome del service account (path del gruppo top-level). Il token vive nel worker in GITLAB_SERVICE_ACCOUNTS."/>
        <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onclick={() => modalOpen = false}>Annulla</Button>
            <Button type="submit" loading={submitting} disabled={submitting}>Crea</Button>
        </div>
    </form>
</Modal>
