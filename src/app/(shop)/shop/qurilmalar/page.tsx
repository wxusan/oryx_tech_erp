import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopDevicesList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import QurilmalarClient from './qurilmalar-client'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import { latestChangeCursorForSession } from '@/lib/server/change-events'

interface QurilmalarPageProps {
  searchParams?: Promise<{ status?: string | string[]; q?: string | string[]; page?: string | string[] }>
}

// Matches PER_PAGE in qurilmalar-client.tsx (first page is server-rendered
// here for a fast initial paint with no loading flash; every subsequent
// page/search/status change is a client-side fetch to /api/devices?paginated=1).
const PER_PAGE = 25

export default async function QurilmalarPage({ searchParams }: QurilmalarPageProps) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const params = await searchParams
  const status = Array.isArray(params?.status) ? params?.status[0] : params?.status
  const initialSearch = scalarParam(params?.q).slice(0, 100)
  const initialPage = positivePage(params?.page)
  const validStatuses = ['IN_STOCK', 'SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA', 'RETURNED'] as const
  const initialStatus = validStatuses.includes(status as (typeof validStatuses)[number])
    ? (status as (typeof validStatuses)[number])
    : 'Barchasi'

  const snapshotCursor = await latestChangeCursorForSession(guarded.session)
  const [{ items: devices, total }, currency] = await Promise.all([
    getShopDevicesList(guarded.shopId, {
      status: initialStatus === 'Barchasi' ? undefined : initialStatus,
      search: initialSearch || undefined,
      skip: (initialPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    getShopCurrencyContext(guarded.shopId),
  ])

  return (
    <QurilmalarClient
      initialDevices={devices}
      initialTotal={total}
      currency={currency}
      initialStatus={initialStatus}
      initialSearch={initialSearch}
      initialPage={initialPage}
      initialSyncCursor={snapshotCursor}
    />
  )
}
