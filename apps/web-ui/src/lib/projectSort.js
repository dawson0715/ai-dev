// Ordina i progetti per nome cliente (case-insensitive); i progetti senza
// cliente vanno in fondo. `clientNameMap` è {client_id: name}.
export function sortByClientName(projects, clientNameMap) {
    return [...projects].sort((a, b) => {
        const nameA = clientNameMap[a.client_id]
        const nameB = clientNameMap[b.client_id]
        if (!nameA && !nameB) return 0
        if (!nameA) return 1
        if (!nameB) return -1
        return nameA.localeCompare(nameB)
    })
}
