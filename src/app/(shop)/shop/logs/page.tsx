import { redirect } from 'next/navigation'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { getShopLogsInitial, initialLogsRequestKey } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import ShopLogsClient from './logs-client'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import { logCategoryOptions, type LogCategory } from '@/lib/log-categories'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'

export default async function ShopLogsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<'q' | 'from' | 'to' | 'category' | 'actorId' | 'page', string | string[] | undefined>>
}) {
  const guarded = await requireCurrentShopPermission('LOG_VIEW')
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')

  const params = await searchParams
  const requestedCategory = scalarParam(params?.category)
  const category = logCategoryOptions.some((option) => option.value === requestedCategory)
    ? (requestedCategory as LogCategory)
    : 'all'
  const initialState = {
    search: scalarParam(params?.q).slice(0, 100),
    dateFrom: scalarParam(params?.from),
    dateTo: scalarParam(params?.to),
    category,
    actorId: scalarParam(params?.actorId),
    page: positivePage(params?.page),
  }
  const requestKey = initialLogsRequestKey({ ...initialState, take: 10 })
  const [cursor, payload, currency] = await Promise.all([
    latestChangeCursorForSession(guarded.session),
    getShopLogsInitial(guarded.shopId, {
      includeOwnerFinancials: guarded.principal?.memberKind === 'SHOP_OWNER',
    }, { ...initialState, take: 10 }),
    getShopCurrencyContext(guarded.shopId),
  ])

  return (
    <>
    <IncrementalSnapshotBoundary cursor={cursor} />
    <ShopLogsClient
      initialPayload={payload}
      initialRequestKey={requestKey}
      currency={currency}
      initialState={initialState}
    />
    </>
  )
}
