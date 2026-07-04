import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopDevicesList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import QurilmalarClient from './qurilmalar-client'

export default async function QurilmalarPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const [devices, currency] = await Promise.all([
    getShopDevicesList(guarded.shopId),
    getShopCurrencyContext(guarded.shopId),
  ])

  return <QurilmalarClient initialDevices={devices} currency={currency} />
}
