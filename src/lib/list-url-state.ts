export type ListUrlValue = string | number | null | undefined

/** Replace only list-state keys without triggering an RSC navigation. */
export function replaceListUrlState(values: Record<string, ListUrlValue>) {
  const url = new URL(window.location.href)
  for (const [key, rawValue] of Object.entries(values)) {
    const value = rawValue == null ? '' : String(rawValue)
    if (!value || value === '1' || value === 'Barchasi' || value === 'all') url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export function positivePage(value: string | string[] | undefined, fallback = 1) {
  const scalar = Array.isArray(value) ? value[0] : value
  const parsed = Number(scalar)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function scalarParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}
