<script>
    import {router, matchRoute, go} from './lib/router.svelte.js'
    import {api} from './lib/api.js'
    import Toasts from './components/Toasts.svelte'
    import ProjectsView from './views/ProjectsView.svelte'
    import ProjectDetailView from './views/ProjectDetailView.svelte'
    import JobsView from './views/JobsView.svelte'
    import JobDetailView from './views/JobDetailView.svelte'

    let mobileMenuOpen = $state(false)
    let healthStatus = $state('checking')

    $effect(() => {
        if (!window.location.hash) window.location.hash = '#/projects'
        api.health()
            .then(() => healthStatus = 'up')
            .catch(() => healthStatus = 'down')
    })

    const route = $derived(matchRoute())

    function isActive(prefix) {
        return route[0] === prefix
    }

    const nav = [
        {label: 'Progetti', path: '/projects', icon: 'folder'},
        {label: 'Job', path: '/jobs', icon: 'list'}
    ]

    function navigate(path) {
        go(path)
        mobileMenuOpen = false
    }
</script>

<Toasts/>

<div class="min-h-full flex flex-col lg:flex-row">
    <!-- Mobile topbar -->
    <header class="lg:hidden sticky top-0 z-30 bg-slate-950/90 backdrop-blur ring-1 ring-slate-800 px-4 py-3 flex items-center justify-between">
        <a href="#/projects" class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-bold text-white shadow-lg shadow-brand-900/50">A</div>
            <span class="font-semibold tracking-tight">AI Dev</span>
        </a>
        <button
            class="p-2 rounded-md text-slate-300 hover:bg-slate-800"
            onclick={() => mobileMenuOpen = !mobileMenuOpen}
            aria-label="Menu">
            {#if mobileMenuOpen}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            {:else}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            {/if}
        </button>
    </header>

    <!-- Sidebar -->
    <aside
        class="lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-slate-950/80 ring-1 ring-slate-800 backdrop-blur flex flex-col {mobileMenuOpen ? 'block' : 'hidden lg:flex'}">
        <div class="hidden lg:flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
            <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-bold text-white shadow-lg shadow-brand-900/50">A</div>
            <div>
                <div class="font-semibold tracking-tight text-slate-100">AI Dev Agent</div>
                <div class="text-xs text-slate-500">control panel</div>
            </div>
        </div>

        <nav class="flex-1 px-3 py-4 space-y-1">
            {#each nav as item}
                <button
                    onclick={() => navigate(item.path)}
                    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors {isActive(item.path.slice(1)) ? 'bg-brand-600/20 text-brand-200 ring-1 ring-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'}">
                    {#if item.icon === 'folder'}
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                    {:else}
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                    {/if}
                    {item.label}
                </button>
            {/each}
        </nav>

        <div class="px-5 py-4 border-t border-slate-800 text-xs text-slate-500">
            <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full {healthStatus === 'up' ? 'bg-emerald-400' : healthStatus === 'down' ? 'bg-rose-500' : 'bg-amber-400'}"></span>
                API {healthStatus === 'up' ? 'online' : healthStatus === 'down' ? 'offline' : '...'}
            </div>
            <div class="mt-2 text-slate-600 tabular-nums">v{__APP_VERSION__}</div>
        </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 min-w-0">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
            {#if route.length === 0 || (route[0] === 'projects' && route.length === 1)}
                <ProjectsView/>
            {:else if route[0] === 'projects' && route.length >= 2}
                <ProjectDetailView projectId={route[1]}/>
            {:else if route[0] === 'jobs' && route.length === 1}
                <JobsView/>
            {:else if route[0] === 'jobs' && route.length >= 2}
                <JobDetailView jobId={route[1]}/>
            {:else}
                <div class="text-center py-20 text-slate-500">
                    <h2 class="text-2xl font-semibold text-slate-200">Pagina non trovata</h2>
                    <p class="mt-2">La route <code class="text-slate-400">{router.current.path}</code> non esiste.</p>
                </div>
            {/if}
        </div>
    </main>
</div>
