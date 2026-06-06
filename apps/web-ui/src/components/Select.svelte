<script>
    let {
        label,
        value = $bindable(''),
        options = [],
        placeholder = '',
        required = false,
        hint = ''
    } = $props()

    const base = 'block w-full rounded-lg bg-slate-950/50 ring-1 ring-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 transition'
</script>

<label class="block">
    {#if label}
        <span class="block text-sm font-medium text-slate-300 mb-1.5">
            {label}
            {#if required}<span class="text-rose-400">*</span>{/if}
        </span>
    {/if}
    <select bind:value {required} class={base}>
        {#if placeholder}
            <option value="" disabled>{placeholder}</option>
        {/if}
        {#each options as opt}
            <option value={opt.value}>{opt.label}</option>
        {/each}
    </select>
    {#if hint}
        <span class="block text-xs text-slate-500 mt-1">{hint}</span>
    {/if}
</label>
