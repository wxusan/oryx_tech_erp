import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import ExportCenter from './export-center'

const exportPermissions = [
  'EXPORT_DEVICES',
  'EXPORT_CUSTOMERS',
  'EXPORT_SALES',
  'EXPORT_NASIYA',
  'EXPORT_OLIB',
  'EXPORT_RETURNS',
  'EXPORT_LOGS',
  'EXPORT_REPORTS',
] as const

export default async function ExportPage() {
  const guarded = await requireCurrentShopAnyPermission(exportPermissions)
  if (!guarded.ok) redirect('/shop')
  return <ExportCenter />
}
