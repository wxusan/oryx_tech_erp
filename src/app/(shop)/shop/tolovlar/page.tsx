import { redirect } from 'next/navigation'
import { requireReceivableView } from '@/lib/api-auth'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { getReceivableCohortPage, type ReceivableCohort } from '@/lib/server/shop-stats-queries'
import { tashkentDayRange } from '@/lib/timezone'
import ReceivablesClient from './receivables-client'

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams?: Promise<{ cohort?: string | string[]; skip?: string | string[] }>
}) {
  const guarded = await requireReceivableView()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')

  const params = await searchParams
  const cohortParam = Array.isArray(params?.cohort) ? params.cohort[0] : params?.cohort
  const cohort: ReceivableCohort = cohortParam?.toUpperCase() === 'DUE_TODAY' ? 'DUE_TODAY' : 'OVERDUE'
  const skipParam = Array.isArray(params?.skip) ? params.skip[0] : params?.skip
  const skip = Math.max(0, Number.parseInt(skipParam ?? '0', 10) || 0)
  const take = 30
  const { start: todayStart, end: tomorrowStart, dayKey } = tashkentDayRange(new Date())
  const [initialPage, currency] = await Promise.all([
    getReceivableCohortPage({
      shopId: guarded.shopId,
      todayStart,
      tomorrowStart,
      includeCashSales: guarded.includeCashSales,
      includeNasiya: guarded.includeNasiya,
      cohort,
      skip,
      take,
    }),
    getShopCurrencyContext(guarded.shopId),
  ])

  return (
    <ReceivablesClient
      initialData={{ ...initialPage, cohort, skip, take, dayKey, currency }}
    />
  )
}
