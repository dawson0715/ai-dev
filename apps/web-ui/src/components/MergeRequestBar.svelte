<script>
    import {api} from '../lib/api.js'
    import {toast} from '../lib/toast.svelte.js'
    import {formatRelative} from '../lib/format.js'
    import Button from './Button.svelte'
    import ReviewBadge from './ReviewBadge.svelte'

    // Barra della chat di review di una MR esterna: verdetto e decisione
    // (merge, chiusura o nuova review). `chatStatus` ricarica la MR quando la
    // review termina.
    let {mergeRequestId, chatStatus = '', onchange} = $props()

    let mr = $state(null)
    let busy = $state('')
    let confirming = $state('')

    async function load() {
        try {
            mr = await api.mergeRequests.get(mergeRequestId)
        } catch (e) {
            toast.error(`Errore caricamento MR: ${e.message}`)
        }
    }

    $effect(() => {
        mergeRequestId
        chatStatus
        load()
    })

    const reviewing = $derived(chatStatus === 'pending' || chatStatus === 'running')
    const open = $derived(mr?.state === 'opened')
    const outdated = $derived(Boolean(mr?.review?.sha) && mr.review.sha !== mr.sha)
    const mergeBlocker = $derived(
        reviewing ? 'Review in corso'
            : !mr?.review ? 'Nessuna review'
            : outdated ? 'Nuovi commit dopo la review'
            : mr.has_conflicts ? 'Conflitti con il branch di destinazione'
            : ''
    )

    async function act(action) {
        busy = action
        confirming = ''
        try {
            mr = await api.mergeRequests[action](mergeRequestId)
            toast.success(action === 'merge' ? 'MR mergiata' : action === 'close' ? 'MR chiusa' : 'Review accodata')
            onchange?.()
        } catch (e) {
            toast.error(e.message)
        } finally {
            busy = ''
        }
    }
</script>

{#if mr}
    <div class="px-4 py-3 border-b border-slate-800 bg-slate-950/40 space-y-2">
        <div class="flex items-center gap-2 min-w-0 text-xs text-slate-400">
            <a href={mr.web_url} target="_blank" rel="noopener" class="font-mono text-slate-300 hover:text-brand-300">!{mr.iid}</a>
            <span class="truncate">{mr.author} · {mr.source_branch} → {mr.target_branch}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            {#if mr.decision}
                <span class="text-sm text-slate-300">
                    {mr.decision.action === 'merged' ? 'Mergiata' : 'Chiusa'} {formatRelative(mr.decision.at)}
                </span>
            {:else if !open}
                <span class="text-sm text-slate-400">MR {mr.state} su GitLab</span>
            {:else}
                <ReviewBadge mr={{...mr, chat_status: chatStatus}}/>
                {#if outdated && !reviewing}
                    <span class="text-xs text-amber-300">nuovi commit dopo la review</span>
                {/if}
                <div class="flex-1"></div>
                {#if confirming}
                    <Button size="sm" variant="ghost" onclick={() => confirming = ''}>Annulla</Button>
                    <Button size="sm" variant={confirming === 'merge' ? 'success' : 'danger'} onclick={() => act(confirming)}>
                        Conferma {confirming === 'merge' ? 'merge' : 'chiusura'}
                    </Button>
                {:else}
                    <Button size="sm" variant="ghost" onclick={() => act('review')} loading={busy === 'review'}
                            disabled={!!busy || reviewing} title="Accoda una nuova review completa">Rivedi</Button>
                    <Button size="sm" variant="secondary" onclick={() => confirming = 'close'} disabled={!!busy}>Chiudi MR</Button>
                    <Button size="sm" variant="success" onclick={() => confirming = 'merge'} loading={busy === 'merge'}
                            disabled={!!busy || !!mergeBlocker} title={mergeBlocker || 'Merge su GitLab del commit revisionato'}>Merge</Button>
                {/if}
            {/if}
        </div>
    </div>
{/if}
