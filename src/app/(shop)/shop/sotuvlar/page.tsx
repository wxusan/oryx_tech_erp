import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import SalesWorkQueue from './sales-work-queue'

export default async function SalesPage() {
  const guarded = await requireCurrentShopAnyPermission(['SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'])
  if (!guarded.ok) redirect('/shop')
  return <SalesWorkQueue />
}
