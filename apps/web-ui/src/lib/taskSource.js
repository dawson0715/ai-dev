// Sorgente da cui un progetto importa i task, allineata a TASK_SOURCES del
// backend (projects.service.js).
export const TASK_SOURCES = [
    {value: 'clickup', label: 'ClickUp'},
    {value: 'gitlab_issues', label: 'GitLab Issues'},
    {value: 'manual', label: 'Solo manuale'}
]

export const TASK_SOURCE_LABELS = Object.fromEntries(
    TASK_SOURCES.map((s) => [s.value, s.label])
)
