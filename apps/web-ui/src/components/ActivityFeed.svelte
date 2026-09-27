<script>
    // Voci di attività di un'esecuzione Claude (vedi worker summarizeEvent):
    // {kind: text|tool|denied, tool?, text, at?}.
    let {entries = [], limit = 0, class: extraClass = ''} = $props()

    const visible = $derived(limit > 0 ? entries.slice(-limit) : entries)

    // I path assoluti del worktree (/opt/worktrees/<id>/...) sono rumore: mostro il relativo.
    function shortPath(text) {
        return String(text ?? '').replace(/^\/?(?:[^\s/]+\/)*worktrees\/[^/]+\//, '')
    }
</script>

<ol class="space-y-1.5 text-xs {extraClass}">
    {#each visible as entry, i (i)}
        <li class="flex gap-2 min-w-0">
            {#if entry.kind === 'tool'}
                <span class="shrink-0 font-mono px-1.5 rounded bg-slate-800 text-sky-300 ring-1 ring-slate-700">{entry.tool}</span>
                <span class="font-mono text-slate-400 truncate" title={entry.text}>{shortPath(entry.text)}</span>
            {:else if entry.kind === 'denied'}
                <span class="shrink-0 font-mono px-1.5 rounded bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30">{entry.tool}</span>
                <span class="text-rose-300/80">negato dai permessi</span>
            {:else}
                <span class="text-slate-300 whitespace-pre-wrap break-words">{entry.text}</span>
            {/if}
        </li>
    {/each}
</ol>
