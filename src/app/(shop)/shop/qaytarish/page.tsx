import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import ReturnWorkQueue from './return-work-queue'

export default async function ReturnPage() {
  const guarded = await requireCurrentShopAnyPermission(['SALE_RETURN_REFUND'])
  if (!guarded.ok) redirect('/shop/yangi-operatsiya')
  return <ReturnWorkQueue />
}
