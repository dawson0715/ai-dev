// Etichette dei servizi; il valore coincide con il nome del service account GitLab.
export const SERVICE_NAMES = [
    {value: 'ai-bb', label: 'AI-BB'},
    {value: 'oddmonitor', label: 'OddMonitor'},
    {value: 'deplot', label: 'Deplot'}
]

export function serviceLabel(value) {
    return SERVICE_NAMES.find((service) => service.value === value)?.label ?? value
}
