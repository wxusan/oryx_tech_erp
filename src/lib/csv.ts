export function csvCell(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : value == null ? '' : String(value)
  const safe = typeof value === 'string' && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw

  return `"${safe.replaceAll('"', '""')}"`
}

export function csvRows(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}
