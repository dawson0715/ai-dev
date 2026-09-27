<script>
    import ChatPanel from './ChatPanel.svelte'

    // Pannello laterale con la chat: resta aperto sopra la pagina corrente
    // (progetto o job), così si fanno domande senza perdere il contesto.
    let {open = false, onclose, title = "Chiedi all'agente", subtitle = '', ...panelProps} = $props()
</script>

{#if open}
    <div class="fixed inset-0 z-40 flex justify-end">
        <button class="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] lg:bg-transparent lg:backdrop-blur-none cursor-default"
                onclick={() => onclose?.()} aria-label="Chiudi chat"></button>
        <aside class="relative w-full sm:w-[30rem] lg:w-[34rem] h-full bg-slate-900 ring-1 ring-slate-800 shadow-2xl flex flex-col">
            <div class="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <h2 class="font-semibold text-slate-100">{title}</h2>
                    {#if subtitle}<p class="text-xs text-slate-500 truncate">{subtitle}</p>{/if}
                </div>
                <button class="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                        onclick={() => onclose?.()} aria-label="Chiudi">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="flex-1 min-h-0">
                <ChatPanel {...panelProps}/>
            </div>
        </aside>
    </div>
{/if}
