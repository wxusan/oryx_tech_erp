import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import ImportCenter from './import-center'

export default async function ImportPage() {
  const guarded = await requireCurrentShopAnyPermission(['IMPORT_CUSTOMERS', 'IMPORT_OLD_NASIYA'])
  if (!guarded.ok) redirect('/shop')
  return <ImportCenter />
}
