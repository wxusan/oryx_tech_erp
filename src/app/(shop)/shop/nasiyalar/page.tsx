import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopNasiyalarList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import NasiyalarClient from './nasiyalar-client'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'

interface NasiyalarPageProps {
  searchParams?: Promise<{ status?: string | string[]; q?: string | string[]; page?: string | string[] }>
}

// Matches PER_PAGE in nasiyalar-client.tsx (first page is server-rendered
// here for a fast initial paint with no loading flash; every subsequent
// page/search/filter change is a client-side fetch to /api/nasiya).
const PER_PAGE = 25

export default async function NasiyalarPage({ searchParams }: NasiyalarPageProps) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const params = await searchParams
  const status = Array.isArray(params?.status) ? params?.status[0] : params?.status
  const initialSearch = scalarParam(params?.q).slice(0, 100)
  const initialPage = positivePage(params?.page)
  const validStatuses = ['ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'] as const
  const initialFilter = validStatuses.includes(status as (typeof validStatuses)[number])
    ? (status as (typeof validStatuses)[number])
    : 'Barchasi'
  const cursor = await latestChangeCursorForSession(guarded.session)
  const [{ items: nasiyalar, total }, currency] = await Promise.all([
    getShopNasiyalarList(guarded.shopId, {
      status: initialFilter === 'Barchasi' ? undefined : initialFilter,
      search: initialSearch || undefined,
      skip: (initialPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    getShopCurrencyContext(guarded.shopId),
  ])

  return (
    <>
      <IncrementalSnapshotBoundary cursor={cursor} />
      <NasiyalarClient
        initialNasiyalar={nasiyalar}
        initialTotal={total}
        initialFilter={initialFilter}
        initialSearch={initialSearch}
        initialPage={initialPage}
        currency={currency}
      />
    </>
  )
}
