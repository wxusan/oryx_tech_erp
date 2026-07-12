/** Browser-safe URL helpers for Oryx API downloads. */

function buildUrl(
  path: string,
  params: Record<string, string | undefined> = {},
): string {
  const base =
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXTAUTH_URL ?? 'http://localhost:3000')
  const url = new URL(path, base)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, value)
  })
  return url.toString()
}

/** Entities supported by GET /api/export/[entity]. */
export type ExportEntity = 'devices' | 'customers' | 'sales' | 'nasiya' | 'returns' | 'logs'
export type ExportFormat = 'csv' | 'xlsx'

/**
 * Build an authenticated, shop-scoped export URL. The server route resolves
 * the active shop from the session cookie; callers never provide a shop ID.
 */
export function exportUrl(entity: ExportEntity, format: ExportFormat = 'xlsx'): string {
  return buildUrl(`/api/export/${entity}`, { format })
}
