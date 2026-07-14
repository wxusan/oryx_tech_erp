import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { getShopNasiyalarList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import NasiyalarClient from './nasiyalar-client'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'
import { principalHasPermission } from '@/lib/server/shop-access'

interface NasiyalarPageProps {
  searchParams?: Promise<{ tab?: string | string[]; status?: string | string[]; q?: string | string[]; page?: string | string[] }>
}

// Matches PER_PAGE in nasiyalar-client.tsx (first page is server-rendered
// here for a fast initial paint with no loading flash; every subsequent
// page/search/filter change is a client-side fetch to /api/nasiya).
const PER_PAGE = 25

export default async function NasiyalarPage({ searchParams }: NasiyalarPageProps) {
  const guarded = await requireCurrentShopAnyPermission([
    'NASIYA_VIEW',
    'NASIYA_EDIT',
    'NASIYA_REMINDER_MANAGE',
    'NASIYA_ARCHIVE',
    'NASIYA_WRITE_OFF',
    'NASIYA_REOPEN',
  ])
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')

  const params = await searchParams
  const tab = Array.isArray(params?.tab) ? params?.tab[0] : params?.tab
  const status = tab ?? (Array.isArray(params?.status) ? params?.status[0] : params?.status)
  const initialSearch = scalarParam(params?.q).slice(0, 100)
  const initialPage = positivePage(params?.page)
  const statusFilters = ['ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'] as const
  const validFilters = [...statusFilters, 'DUE_TODAY', 'UPCOMING', 'ARCHIVED', 'WRITTEN_OFF'] as const
  const requestedFilter = validFilters.includes(status as (typeof validFilters)[number])
    ? (status as (typeof validFilters)[number])
    : 'Barchasi'
  const canViewResolutionHistory = guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
    guarded.principal && ['NASIYA_ARCHIVE', 'NASIYA_WRITE_OFF', 'NASIYA_REOPEN'].some((permission) => (
      principalHasPermission(
        guarded.principal!,
        permission as 'NASIYA_ARCHIVE' | 'NASIYA_WRITE_OFF' | 'NASIYA_REOPEN',
      )
    )),
  )
  if (!canViewResolutionHistory && (requestedFilter === 'ARCHIVED' || requestedFilter === 'WRITTEN_OFF')) {
    redirect('/shop/nasiyalar')
  }
  const initialFilter = requestedFilter
  const initialCohort = tab && ['ACTIVE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING'].includes(initialFilter)
    ? initialFilter as 'ACTIVE' | 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING'
    : undefined
  const initialStatus = !initialCohort && statusFilters.includes(initialFilter as (typeof statusFilters)[number])
    ? initialFilter as (typeof statusFilters)[number]
    : undefined
  const cursor = await latestChangeCursorForSession(guarded.session)
  const [{ items: nasiyalar, total }, currency] = await Promise.all([
    getShopNasiyalarList(guarded.shopId, {
      status: initialStatus,
      cohort: initialCohort,
      resolutionState: initialFilter === 'ARCHIVED' || initialFilter === 'WRITTEN_OFF'
        ? initialFilter
        : undefined,
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
