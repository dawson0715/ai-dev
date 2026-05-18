<script>
    let {
        label,
        type = 'text',
        value = $bindable(''),
        placeholder = '',
        required = false,
        hint = '',
        multiline = false,
        rows = 4
    } = $props()

    const base = 'block w-full rounded-lg bg-slate-950/50 ring-1 ring-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition'
</script>

<label class="block">
    <span class="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
        {#if required}<span class="text-rose-400">*</span>{/if}
    </span>
    {#if multiline}
        <textarea bind:value {placeholder} {required} {rows} class={base}></textarea>
    {:else}
        <input bind:value {type} {placeholder} {required} class={base}/>
    {/if}
    {#if hint}
        <span class="block text-xs text-slate-500 mt-1">{hint}</span>
    {/if}
</label>
