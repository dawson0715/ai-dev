// Stati di uno sprint, allineati a SPRINT_STATUSES del backend (sprints.service.js).
export const SPRINT_STATUSES = [
    {value: 'preventivo', label: 'Preventivo'},
    {value: 'approvato', label: 'Approvato'},
    {value: 'in_lavorazione', label: 'In lavorazione'},
    {value: 'completato', label: 'Completato'}
]

export const SPRINT_STATUS_LABELS = Object.fromEntries(
    SPRINT_STATUSES.map((s) => [s.value, s.label])
)
