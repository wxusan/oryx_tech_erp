/** Browser-safe URL helper for authenticated, shop-scoped export downloads. */

export type ExportEntity = 'devices' | 'customers' | 'sales' | 'nasiya' | 'olib' | 'returns' | 'logs' | 'report'
export type ExportFormat = 'csv' | 'xlsx'

export function exportUrl(entity: ExportEntity, format: ExportFormat = 'xlsx'): string {
  const base = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXTAUTH_URL ?? 'http://localhost:3000')
  const url = new URL(`/api/export/${entity}`, base)
  url.searchParams.set('format', format)
  return url.toString()
}
