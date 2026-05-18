<script>
    import {statusColors, statusLabel} from '../lib/format.js'

    let {status} = $props()
    const cls = $derived(statusColors[status] ?? 'bg-slate-700/40 text-slate-300 ring-slate-600/40')
</script>

<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset {cls}">
    <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
    {statusLabel(status)}
</span>
