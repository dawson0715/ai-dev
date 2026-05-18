<script>
    let {title, description = '', action} = $props()
</script>

<div class="text-center py-12 px-4">
    <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-800/60 ring-1 ring-slate-700 mb-4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-slate-400">
            <rect x="4" y="6" width="16" height="14" rx="2"/>
            <path d="M8 3v4M16 3v4M4 11h16"/>
        </svg>
    </div>
    <h3 class="text-slate-200 font-medium">{title}</h3>
    {#if description}
        <p class="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>
    {/if}
    {#if action}
        <div class="mt-5">{@render action?.()}</div>
    {/if}
</div>
