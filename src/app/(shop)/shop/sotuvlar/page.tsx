import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import SalesWorkQueue from './sales-work-queue'
import { getSalesList } from '@/lib/server/sales-list'
import { positivePage } from '@/lib/list-url-state'

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string | string[] }>
}) {
  const guarded = await requireCurrentShopAnyPermission(['SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'])
  if (!guarded.ok || !guarded.shopId) redirect('/shop')
  const params = await searchParams
  const page = positivePage(params?.page)
  const take = 25
  const initialData = await getSalesList({
    shopId: guarded.shopId,
    skip: (page - 1) * take,
    take,
    includeOwnerFinancials: guarded.principal?.memberKind === 'SHOP_OWNER',
  })
  return <SalesWorkQueue initialData={initialData} initialPage={page} />
}
