const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function localDate(value: string): Date | null {
  const match = LOCAL_DATE.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const parts = [year, month, day].map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  return date.getFullYear() === parts[0]
    && date.getMonth() === parts[1] - 1
    && date.getDate() === parts[2] ? date : null
}

function requiredLocalDate(value: string): Date {
  const date = localDate(value)
  if (!date) throw new Error('invalid-audit-local-date')
  return date
}

/** Convert browser-local date inputs to the inclusive timestamp range expected by the API. */
export function auditDateRangeForQuery(from: string, to: string): {
  from?: string
  to?: string
} {
  const fromDate = from ? requiredLocalDate(from) : null
  const toDate = to ? requiredLocalDate(to) : null
  const nextLocalDay = toDate
    ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1)
    : null
  return {
    ...(fromDate ? { from: fromDate.toISOString() } : {}),
    ...(nextLocalDay ? { to: new Date(nextLocalDay.getTime() - 1).toISOString() } : {}),
  }
}
