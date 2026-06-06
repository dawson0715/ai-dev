// Stati di un task, allineati a TASK_STATUSES del backend (tasks.service.js).
export const TASK_STATUSES = [
    {value: 'preventivo', label: 'Preventivo'},
    {value: 'approvato', label: 'Approvato'},
    {value: 'in_lavorazione', label: 'In lavorazione'},
    {value: 'completato', label: 'Completato'}
]

export const TASK_STATUS_LABELS = Object.fromEntries(
    TASK_STATUSES.map((s) => [s.value, s.label])
)
