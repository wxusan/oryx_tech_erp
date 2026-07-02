import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopLogsInitial, initialLogsRequestKey } from '@/lib/server/shop-lists'
import ShopLogsClient from './logs-client'

export default async function ShopLogsPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const payload = await getShopLogsInitial(guarded.shopId)

  return <ShopLogsClient initialPayload={payload} initialRequestKey={initialLogsRequestKey()} />
}
