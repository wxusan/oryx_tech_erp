import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopNasiyalarList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import NasiyalarClient from './nasiyalar-client'

interface NasiyalarPageProps {
  searchParams?: Promise<{ status?: string | string[] }>
}

export default async function NasiyalarPage({ searchParams }: NasiyalarPageProps) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const params = await searchParams
  const status = Array.isArray(params?.status) ? params?.status[0] : params?.status
  const validStatuses = ['ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'] as const
  const initialFilter = validStatuses.includes(status as (typeof validStatuses)[number])
    ? (status as (typeof validStatuses)[number])
    : 'Barchasi'
  const [nasiyalar, currency] = await Promise.all([
    getShopNasiyalarList(guarded.shopId),
    getShopCurrencyContext(guarded.shopId),
  ])

  return <NasiyalarClient initialNasiyalar={nasiyalar} initialFilter={initialFilter} currency={currency} />
}
