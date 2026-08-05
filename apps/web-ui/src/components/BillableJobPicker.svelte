<script>
    import {formatDateOnly, formatCurrency} from '../lib/format.js'

    // jobs: job fatturabili (completati/manual review, non ancora in uno sprint).
    // Ogni job include project_name (risolto lato API) e una data di completamento.
    let {jobs = [], selected = $bindable(new Set())} = $props()

    let projectFilter = $state('')

    function projectLabel(job) {
        return job.project_name ?? (job.source === 'support' ? 'Supporto' : 'Senza progetto')
    }

    function jobDate(job) {
        return job.completed_at ?? job.implemented_at ?? job.created_at
    }

    const projectNames = $derived([...new Set(jobs.map(projectLabel))])
    const filtered = $derived(projectFilter ? jobs.filter((j) => projectLabel(j) === projectFilter) : jobs)

    function toggle(id) {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        selected = next
    }

    // Se il filtro nasconde tutti i selezionati precedenti non li deseleziona:
    // restano assegnati anche se non visibili con questo filtro.
</script>

{#if projectNames.length > 1}
    <div class="flex flex-wrap gap-1.5 mb-2">
        <button type="button" onclick={() => projectFilter = ''}
                class="px-2.5 py-1 rounded-full text-xs ring-1 ring-inset transition {projectFilter === '' ? 'bg-brand-600 text-white ring-brand-500' : 'text-slate-300 ring-slate-700 hover:ring-slate-600 hover:bg-slate-800/60'}">
            Tutti
        </button>
        {#each projectNames as name}
            <button type="button" onclick={() => projectFilter = name}
                    class="px-2.5 py-1 rounded-full text-xs ring-1 ring-inset transition {projectFilter === name ? 'bg-brand-600 text-white ring-brand-500' : 'text-slate-300 ring-slate-700 hover:ring-slate-600 hover:bg-slate-800/60'}">
                {name}
            </button>
        {/each}
    </div>
{/if}

{#if filtered.length === 0}
    <p class="text-sm text-slate-500 bg-slate-950/50 rounded-lg ring-1 ring-slate-800 px-3 py-4">
        Nessun job disponibile.
    </p>
{:else}
    <ul class="max-h-64 overflow-y-auto divide-y divide-slate-800 rounded-lg ring-1 ring-slate-800">
        {#each filtered as job (job._id)}
            <li class="flex items-center gap-3 px-3 py-2.5">
                <input type="checkbox" checked={selected.has(job._id)}
                       onchange={() => toggle(job._id)}
                       class="h-4 w-4 rounded border-slate-700 bg-slate-950 text-brand-500 focus:ring-brand-500"/>
                <div class="flex-1 min-w-0">
                    <div class="text-sm text-slate-200 truncate">{job.title ?? job.clickup?.title ?? '(senza titolo)'}</div>
                    <div class="text-xs text-slate-500 truncate">{projectLabel(job)} · {formatDateOnly(jobDate(job))}</div>
                </div>
                <span class="text-xs text-slate-400 tabular-nums shrink-0">{formatCurrency(Number(job.estimate) || 0)}</span>
            </li>
        {/each}
    </ul>
{/if}
