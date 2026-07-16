const NAVIGATION_START_MARK = 'oryx:navigation-intent'

function canMeasure() {
  return typeof window !== 'undefined' && typeof performance !== 'undefined'
}

function safeMetricId(value: string) {
  return value.replace(/[^a-z0-9:_/-]/gi, '-').slice(0, 100)
}

export function markNavigationIntent(destination: string) {
  if (!canMeasure()) return
  performance.mark(NAVIGATION_START_MARK, { detail: { destination: safeMetricId(destination) } })
}

export function markNavigationFeedback(destination: string) {
  if (!canMeasure() || !performance.getEntriesByName(NAVIGATION_START_MARK).length) return
  const name = `oryx:navigation-feedback:${safeMetricId(destination)}`
  performance.mark(name)
  performance.measure(name, NAVIGATION_START_MARK, name)
}

export function markNavigationSettled(pathname: string) {
  if (!canMeasure() || !performance.getEntriesByName(NAVIGATION_START_MARK).length) return
  const name = `oryx:navigation-shell:${safeMetricId(pathname)}`
  performance.mark(name)
  performance.measure(name, NAVIGATION_START_MARK, name)
  performance.clearMarks(NAVIGATION_START_MARK)
}

export function markQueryIntent(metricId: string) {
  if (!canMeasure()) return
  performance.mark(`oryx:query-intent:${safeMetricId(metricId)}`)
}

export function markQuerySettled(metricId: string) {
  if (!canMeasure()) return
  const id = safeMetricId(metricId)
  const start = `oryx:query-intent:${id}`
  if (!performance.getEntriesByName(start).length) return
  const end = `oryx:query-settled:${id}`
  performance.mark(end)
  performance.measure(end, start, end)
  performance.clearMarks(start)
}
