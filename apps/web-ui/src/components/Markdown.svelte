<script>
    import {renderMarkdown} from '../lib/markdown.js'

    // `compact`: spaziature ridotte, per le voci di attività.
    let {text = '', compact = false, class: extraClass = ''} = $props()

    const html = $derived(renderMarkdown(text))
</script>

<div class="markdown {compact ? 'markdown-compact' : ''} {extraClass}">{@html html}</div>
