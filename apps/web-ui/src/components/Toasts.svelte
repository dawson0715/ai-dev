<script>
    import {toast} from '../lib/toast.svelte.js'

    const variants = {
        success: 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/40',
        error: 'bg-rose-500/10 text-rose-200 ring-rose-500/40',
        info: 'bg-sky-500/10 text-sky-200 ring-sky-500/40'
    }
</script>

<div class="fixed top-4 right-4 left-4 sm:left-auto sm:max-w-sm z-[60] space-y-2 pointer-events-none">
    {#each toast.items as t (t.id)}
        <div class="pointer-events-auto rounded-lg ring-1 ring-inset px-4 py-3 text-sm shadow-lg backdrop-blur {variants[t.type]} flex items-start gap-3">
            <span class="flex-1">{t.message}</span>
            <button
                class="text-current opacity-60 hover:opacity-100"
                onclick={() => toast.dismiss(t.id)}
                aria-label="Chiudi">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>
    {/each}
</div>
