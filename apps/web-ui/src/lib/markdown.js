import {marked} from 'marked'
import DOMPurify from 'dompurify'

// Markdown delle risposte di Claude (GFM: tabelle, liste, code fence).
// `breaks`: un a-capo singolo resta un a-capo, come nel testo originale.
marked.setOptions({gfm: true, breaks: true})

// Link sempre in una nuova scheda e senza accesso a window.opener.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
    }
})

// Il testo arriva da un LLM (e indirettamente dal codice del repo): l'HTML
// generato va sempre sanitizzato prima di finire in {@html}. Niente immagini:
// eviterebbero richieste verso host arbitrari.
export function renderMarkdown(text) {
    const html = marked.parse(String(text ?? ''), {async: false})
    return DOMPurify.sanitize(html, {FORBID_TAGS: ['img', 'style'], FORBID_ATTR: ['style']})
}
