function pad(value) {
    return String(value).padStart(2, '0')
}

export function compactUtcTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) throw new Error('invalid Liquibase timestamp')

    return [
        String(date.getUTCFullYear()).slice(-2),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds())
    ].join('')
}

export function normalizeTaskId(value) {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'TASK'
}

export function createLiquibaseId(taskId, value = new Date()) {
    return `${compactUtcTimestamp(value)}_${normalizeTaskId(taskId)}`
}

function compactTimestampDate(value) {
    const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value ?? '')
    if (!match) return null
    const [, year, month, day, hour, minute, second] = match
    const date = new Date(Date.UTC(
        2000 + Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    ))
    return Number.isNaN(date.getTime()) ? null : date
}

export function createNextLiquibaseId(taskId, previousId, value = new Date()) {
    const requested = value instanceof Date ? new Date(value) : new Date(value)
    if (Number.isNaN(requested.getTime())) throw new Error('invalid Liquibase timestamp')
    requested.setUTCMilliseconds(0)

    const previous = compactTimestampDate(previousId)
    const sequenceDate = previous && previous >= requested
        ? new Date(previous.getTime() + 1000)
        : requested
    return createLiquibaseId(taskId, sequenceDate)
}
