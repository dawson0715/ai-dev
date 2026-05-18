<script>
    let {size = 24, class: extraClass = ''} = $props()
</script>

<svg class="animate-spin text-brand-500 {extraClass}" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2"/>
    <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>
