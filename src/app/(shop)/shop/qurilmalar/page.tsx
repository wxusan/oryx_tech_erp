import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopDevicesList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import QurilmalarClient from './qurilmalar-client'

interface QurilmalarPageProps {
  searchParams?: Promise<{ status?: string | string[] }>
}

export default async function QurilmalarPage({ searchParams }: QurilmalarPageProps) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const params = await searchParams
  const status = Array.isArray(params?.status) ? params?.status[0] : params?.status
  // "Band"/RESERVED is intentionally NOT a supported filter.
  const validStatuses = ['IN_STOCK', 'SOLD_CASH', 'SOLD_NASIYA', 'RETURNED'] as const
  const initialStatus = validStatuses.includes(status as (typeof validStatuses)[number])
    ? (status as (typeof validStatuses)[number])
    : 'Barchasi'

  const [{ items: devices, truncated }, currency] = await Promise.all([
    getShopDevicesList(guarded.shopId),
    getShopCurrencyContext(guarded.shopId),
  ])

  return (
    <QurilmalarClient
      initialDevices={devices}
      currency={currency}
      initialStatus={initialStatus}
      truncated={truncated}
    />
  )
}
