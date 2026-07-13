import { ok, serverError } from '@/lib/api-helpers'
import { requireReceivableView, resolveActiveShopId } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { getReceivableCohortSummaries } from '@/lib/server/shop-stats-queries'
import { tashkentDayRange } from '@/lib/timezone'

export async function GET() {
  try {
    const guarded = await requireReceivableView()
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, null)
    if (!resolved.ok) return resolved.response

    const { start: todayStart, end: tomorrowStart, dayKey } = tashkentDayRange(new Date())
    const [cohorts, currency] = await Promise.all([
      getReceivableCohortSummaries({
        shopId: resolved.shopId,
        todayStart,
        tomorrowStart,
        includeCashSales: guarded.includeCashSales,
        includeNasiya: guarded.includeNasiya,
      }),
      getShopCurrencyContext(resolved.shopId),
    ])

    return ok({
      dueToday: cohorts.DUE_TODAY,
      overdue: cohorts.OVERDUE,
      currency,
      dayKey,
    }, "Bugungi va kechikkan to'lovlar xulosasi")
  } catch (error) {
    logger.error('[GET /api/stats/due-overdue]', { event: 'api.route_error', error })
    return serverError()
  }
}
