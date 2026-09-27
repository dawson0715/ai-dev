<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import {go} from '../lib/router.svelte.js'
    import Button from './Button.svelte'
    import Spinner from './Spinner.svelte'
    import ActivityFeed from './ActivityFeed.svelte'
    import NewJobModal from './NewJobModal.svelte'

    // Chat di sola lettura sul codice del progetto. Con `jobId` la
    // conversazione è legata al job: il worker risponde sul branch del job e
    // con il suo contesto. `chatId` vuoto = lista + nuova conversazione.
    let {projectId, projectName = '', jobId = '', chatId = '', onselect} = $props()

    const POLL_MS = 3000

    let chats = $state([])
    let chat = $state(null)
    let loadingList = $state(true)
    let loadingChat = $state(false)
    let text = $state('')
    let sending = $state(false)
    let drafting = $state(false)
    let confirmingDelete = $state(false)
    let scroller = $state(null)
    let draftForJob = $state(null)

    const waiting = $derived(chat?.status === 'pending' || chat?.status === 'running')

    async function loadList() {
        try {
            chats = await api.chats.list(projectId, {jobId})
        } catch (e) {
            toast.error(`Errore caricamento chat: ${e.message}`)
        } finally {
            loadingList = false
        }
    }

    async function loadChat(id) {
        try {
            chat = await api.chats.get(id)
        } catch (e) {
            chat = null
            toast.error(`Errore caricamento chat: ${e.message}`)
        }
    }

    $effect(() => {
        projectId
        jobId
        loadList()
    })

    $effect(() => {
        const id = chatId
        confirmingDelete = false
        if (!id) {
            chat = null
            return
        }
        loadingChat = true
        loadChat(id).finally(() => loadingChat = false)
    })

    // Polling finché il worker non ha risposto.
    $effect(() => {
        if (!waiting || !chat) return
        const id = chat._id
        const timer = setInterval(async () => {
            await loadChat(id)
            if (chat && chat.status !== 'pending' && chat.status !== 'running') loadList()
        }, POLL_MS)
        return () => clearInterval(timer)
    })

    // Scroll in fondo quando arrivano nuovi messaggi o nuova attività.
    $effect(() => {
        chat?.messages?.length
        chat?.progress?.entries?.length
        waiting
        if (scroller) queueMicrotask(() => scroller.scrollTop = scroller.scrollHeight)
    })

    async function send(e) {
        e?.preventDefault()
        const value = text.trim()
        if (!value || sending || waiting) return
        sending = true
        try {
            if (chat) {
                chat = await api.chats.send(chat._id, value)
            } else {
                chat = await api.chats.create(projectId, value, {jobId})
                onselect?.(chat._id)
            }
            text = ''
            await loadList()
        } catch (err) {
            toast.error(`Invio fallito: ${err.message}`)
        } finally {
            sending = false
        }
    }

    function onkeydown(e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e)
    }

    async function requestDraft() {
        drafting = true
        try {
            chat = await api.chats.draftJob(chat._id)
        } catch (e) {
            toast.error(`Richiesta bozza fallita: ${e.message}`)
        } finally {
            drafting = false
        }
    }

    async function remove() {
        try {
            await api.chats.remove(chat._id)
            toast.success('Chat eliminata')
            onselect?.('')
            await loadList()
        } catch (e) {
            toast.error(`Eliminazione fallita: ${e.message}`)
        }
    }
</script>

<div class="flex flex-col h-full min-h-0">
    {#if chatId}
        <div class="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <button class="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800" onclick={() => onselect?.('')} aria-label="Conversazioni">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h3 class="flex-1 min-w-0 text-sm font-medium text-slate-100 truncate">{chat?.title ?? '...'}</h3>
            {#if chat}
                {#if confirmingDelete}
                    <Button size="sm" variant="ghost" onclick={() => confirmingDelete = false}>Annulla</Button>
                    <Button size="sm" variant="danger" onclick={remove}>Elimina</Button>
                {:else}
                    <Button size="sm" variant="secondary" onclick={requestDraft} loading={drafting}
                            disabled={drafting || waiting} title="Trasforma la conversazione in un job manuale">
                        Crea job
                    </Button>
                    <button class="p-1.5 rounded-md text-slate-500 hover:text-rose-300 hover:bg-slate-800" onclick={() => confirmingDelete = true} aria-label="Elimina chat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                    </button>
                {/if}
            {/if}
        </div>
    {/if}

    <div bind:this={scroller} class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {#if !chatId}
            <p class="text-xs text-slate-500 mb-4">
                {jobId
                    ? "Domande su questo job: l'agente legge il branch del job (o il branch di default se è già stato unito) e il suo contesto. Sola lettura."
                    : "Domande sul codice del progetto: l'agente legge il branch di default senza modificarlo."}
            </p>
            {#if loadingList}
                <div class="flex justify-center py-6"><Spinner/></div>
            {:else if chats.length}
                <ul class="space-y-1">
                    {#each chats as c (c._id)}
                        <li>
                            <button onclick={() => onselect?.(c._id)}
                                    class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-800/60 transition">
                                <div class="text-sm text-slate-200 truncate">{c.title}</div>
                                <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 min-w-0">
                                    {#if c.status === 'pending' || c.status === 'running'}
                                        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 animate-pulse"></span>
                                    {:else if c.status === 'failed'}
                                        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"></span>
                                    {/if}
                                    <span class="shrink-0">{formatRelative(c.updated_at)}</span>
                                    {#if c.job_title && !jobId}
                                        <span class="truncate">· job: {c.job_title}</span>
                                    {/if}
                                </div>
                            </button>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="text-sm text-slate-500 text-center py-6">Nessuna conversazione. Scrivi la prima domanda qui sotto.</p>
            {/if}
        {:else if loadingChat && !chat}
            <div class="flex justify-center py-10"><Spinner/></div>
        {:else if chat}
            <div class="space-y-4">
                {#each chat.messages as m, i (i)}
                    <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
                        <div class="max-w-[90%] min-w-0 rounded-xl px-3.5 py-2.5 text-sm {m.role === 'user'
                            ? 'bg-brand-600/25 text-slate-100 ring-1 ring-brand-500/30'
                            : m.error ? 'bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30'
                            : 'bg-slate-800/60 text-slate-200 ring-1 ring-slate-700'}">
                            {#if m.error}
                                <div class="font-medium">Errore del worker</div>
                                <div class="whitespace-pre-wrap break-words text-xs mt-1">{m.error}</div>
                            {:else if m.kind === 'job_draft' && m.job_draft}
                                <div class="text-xs uppercase tracking-wider text-slate-500 mb-1">Bozza job</div>
                                <div class="font-medium text-slate-100">{m.job_draft.title}</div>
                                <div class="whitespace-pre-wrap break-words text-xs text-slate-300 mt-1.5 max-h-48 overflow-y-auto">{m.job_draft.description}</div>
                                <Button size="sm" class="mt-3" onclick={() => draftForJob = m.job_draft}>Rivedi e crea job</Button>
                            {:else}
                                <div class="whitespace-pre-wrap break-words">{m.text}</div>
                            {/if}
                            {#if m.activity?.length}
                                <details class="mt-2">
                                    <summary class="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Passaggi ({m.activity.length})</summary>
                                    <ActivityFeed entries={m.activity} class="mt-2"/>
                                </details>
                            {/if}
                            <div class="text-[11px] text-slate-500 mt-1.5 tabular-nums">
                                {formatRelative(m.created_at)}
                                {#if m.cost_usd != null} · ${m.cost_usd.toFixed(4)}{/if}
                                {#if m.duration_ms != null} · {Math.round(m.duration_ms / 1000)}s{/if}
                            </div>
                        </div>
                    </div>
                {/each}
                {#if waiting}
                    <div class="rounded-xl px-3.5 py-2.5 bg-slate-900/60 ring-1 ring-slate-800">
                        <div class="flex items-center gap-2 text-sm text-slate-400">
                            <Spinner size={14}/>
                            {chat.status === 'pending'
                                ? 'In coda...'
                                : chat.mode === 'draft_job' ? 'Preparo la bozza del job...' : "L'agente sta leggendo il codice..."}
                        </div>
                        {#if chat.progress?.entries?.length}
                            <ActivityFeed entries={chat.progress.entries} limit={8} class="mt-2"/>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <form onsubmit={send} class="border-t border-slate-800 p-3 flex gap-2 items-end">
        <textarea
            bind:value={text}
            {onkeydown}
            rows="2"
            placeholder={waiting ? 'Attendi la risposta...' : chatId ? 'Continua la conversazione (⌘/Ctrl+Invio)' : 'Nuova domanda (⌘/Ctrl+Invio)'}
            disabled={waiting}
            class="flex-1 min-w-0 rounded-lg bg-slate-950/50 ring-1 ring-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 resize-y"></textarea>
        <Button type="submit" loading={sending} disabled={sending || waiting || !text.trim()}>Invia</Button>
    </form>
</div>

<NewJobModal open={!!draftForJob} projects={[{_id: projectId, name: projectName || '(progetto corrente)'}]} {projectId}
             initial={draftForJob} onclose={() => draftForJob = null}
             oncreated={(created) => created?.job_id && go(`/jobs/${created.job_id}`)}/>
