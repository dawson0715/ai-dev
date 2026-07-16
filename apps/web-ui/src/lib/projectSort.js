const collator = new Intl.Collator('it', {sensitivity: 'base', numeric: true})

// Ordina per nome cliente e poi per nome progetto (case-insensitive); i
// progetti senza cliente vanno in fondo. `clientNameMap` è {client_id: name}.
export function sortByClientName(projects, clientNameMap) {
    return [...projects].sort((a, b) => {
        const clientA = clientNameMap[a.client_id]
        const clientB = clientNameMap[b.client_id]

        if (!clientA && clientB) return 1
        if (clientA && !clientB) return -1

        const byClient = clientA && clientB ? collator.compare(clientA, clientB) : 0
        if (byClient !== 0) return byClient

        return collator.compare(a.name ?? '', b.name ?? '')
    })
}
