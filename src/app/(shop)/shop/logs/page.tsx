import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
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
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const cursor = await latestChangeCursorForSession(guarded.session)
  const [payload, currency] = await Promise.all([
    getShopLogsInitial(guarded.shopId),
    getShopCurrencyContext(guarded.shopId),
  ])

  const params = await searchParams
  const requestedCategory = scalarParam(params?.category)
  const category = logCategoryOptions.some((option) => option.value === requestedCategory)
    ? (requestedCategory as LogCategory)
    : 'all'

  return (
    <>
    <IncrementalSnapshotBoundary cursor={cursor} />
    <ShopLogsClient
      initialPayload={payload}
      initialRequestKey={initialLogsRequestKey()}
      currency={currency}
      initialState={{
        search: scalarParam(params?.q).slice(0, 100),
        dateFrom: scalarParam(params?.from),
        dateTo: scalarParam(params?.to),
        category,
        actorId: scalarParam(params?.actorId),
        page: positivePage(params?.page),
      }}
    />
    </>
  )
}
