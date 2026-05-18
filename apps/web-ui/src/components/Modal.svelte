<script>
    let {open = false, title = '', onclose, children, footer} = $props()

    function handleBackdrop(e) {
        if (e.target === e.currentTarget) onclose?.()
    }

    function handleKey(e) {
        if (e.key === 'Escape' && open) onclose?.()
    }
</script>

<svelte:window onkeydown={handleKey}/>

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-0 sm:p-4"
        onclick={handleBackdrop}
        role="presentation">
        <div class="w-full sm:max-w-lg bg-slate-900 ring-1 ring-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div class="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-800">
                <h3 class="text-lg font-semibold text-slate-100">{title}</h3>
                <button
                    class="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                    onclick={() => onclose?.()}
                    aria-label="Chiudi">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="px-5 sm:px-6 py-5 overflow-y-auto">
                {@render children?.()}
            </div>
            {#if footer}
                <div class="px-5 sm:px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
                    {@render footer?.()}
                </div>
            {/if}
        </div>
    </div>
{/if}
