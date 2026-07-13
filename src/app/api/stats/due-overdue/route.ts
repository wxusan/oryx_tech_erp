/**
 * GET /api/stats/due-overdue — item 10 (portal persistent due/overdue
 * banner). Shop-scoped summary of currently overdue nasiya schedules and
 * sales, used by the shop layout's global banner (shown on every page, not
 * just the dashboard). Deliberately its own small query rather than reusing
 * getShopStats — the dashboard's overdue figures are month/admin-filterable
 * (item 8) and cached for 15s; this banner needs the current live count and
 * a direct link when there is exactly one overdue deal, which the dashboard
 * aggregate doesn't track.
 */
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { convertContractAmountToUzs } from '@/lib/nasiya-contract'
import { logger } from '@/lib/logger'
import { tashkentDayRange } from '@/lib/timezone'
import { getCurrentOverdueSummary } from '@/lib/server/shop-stats-queries'

export async function GET() {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, null)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const now = new Date()
    const { start: today } = tashkentDayRange(now)

    const [summary, currency] = await Promise.all([
      getCurrentOverdueSummary({ shopId, todayStart: today }),
      getShopCurrencyContext(shopId),
    ])

    const convertedUsd = convertContractAmountToUzs(summary.overdueNativeUsd, 'USD', currency.usdUzsRate)
    const overdueMoneyUzs = summary.overdueNativeUzs + (convertedUsd ?? 0)

    return ok(
      {
        overdueDealCount: summary.overdueDealCount,
        overdueMoneyUzs,
        overdueNativeUzs: summary.overdueNativeUzs,
        overdueNativeUsd: summary.overdueNativeUsd,
        overdueMoneyComplete: summary.overdueNativeUsd === 0 || convertedUsd !== null,
        currency,
        singleDeal: summary.singleDeal,
      },
      'Kechikkan to\'lovlar xulosasi',
    )
  } catch (err) {
    logger.error('[GET /api/stats/due-overdue]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
