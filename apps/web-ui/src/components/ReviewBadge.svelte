<script>
    // Stato della review automatica di una MR esterna.
    let {mr} = $props()

    const VERDICTS = {
        ok: ['Review ok', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'],
        issues: ['Da correggere', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
        blocking: ['Bloccante', 'bg-rose-500/15 text-rose-300 ring-rose-500/30'],
        failed: ['Review fallita', 'bg-rose-500/15 text-rose-300 ring-rose-500/30'],
        unknown: ['Senza verdetto', 'bg-slate-700/40 text-slate-300 ring-slate-600/40']
    }

    const badge = $derived.by(() => {
        if (mr.chat_status === 'pending' || mr.chat_status === 'running') {
            return ['Review in corso', 'bg-sky-500/15 text-sky-300 ring-sky-500/30']
        }
        if (!mr.review) return [mr.draft ? 'Draft: nessuna review' : 'In attesa di review', 'bg-slate-700/40 text-slate-300 ring-slate-600/40']
        return VERDICTS[mr.review.verdict] ?? VERDICTS.unknown
    })
</script>

<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset {badge[1]}">
    <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
    {badge[0]}
</span>
