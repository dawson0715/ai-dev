<script>
    let {class: extraClass = '', children, padding = 'md', ...rest} = $props()
    const paddings = {
        none: '',
        sm: 'p-3 sm:p-4',
        md: 'p-4 sm:p-6',
        lg: 'p-6 sm:p-8'
    }
</script>

<div class="rounded-xl bg-slate-900/60 ring-1 ring-slate-800 backdrop-blur-sm {paddings[padding]} {extraClass}" {...rest}>
    {@render children?.()}
</div>
