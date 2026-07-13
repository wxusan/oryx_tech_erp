import { NextRequest } from 'next/server'
import { badRequest, ok, serverError } from '@/lib/api-helpers'
import { requireReceivableView, resolveActiveShopId } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { getReceivableCohortPage, type ReceivableCohort } from '@/lib/server/shop-stats-queries'
import { tashkentDayRange } from '@/lib/timezone'

export async function GET(request: NextRequest) {
  try {
    const guarded = await requireReceivableView()
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, null)
    if (!resolved.ok) return resolved.response

    const cohortValue = request.nextUrl.searchParams.get('cohort')?.trim().toUpperCase()
    if (cohortValue !== 'DUE_TODAY' && cohortValue !== 'OVERDUE') {
      return badRequest('cohort DUE_TODAY yoki OVERDUE bo\'lishi kerak')
    }
    const cohort = cohortValue as ReceivableCohort
    const skip = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get('skip') ?? '0', 10) || 0)
    const take = Math.max(1, Math.min(100, Number.parseInt(request.nextUrl.searchParams.get('take') ?? '30', 10) || 30))
    const { start: todayStart, end: tomorrowStart, dayKey } = tashkentDayRange(new Date())
    const [page, currency] = await Promise.all([
      getReceivableCohortPage({
        shopId: resolved.shopId,
        todayStart,
        tomorrowStart,
        includeCashSales: guarded.includeCashSales,
        includeNasiya: guarded.includeNasiya,
        cohort,
        skip,
        take,
      }),
      getShopCurrencyContext(resolved.shopId),
    ])

    return ok({ ...page, cohort, skip, take, dayKey, currency })
  } catch (error) {
    logger.error('[GET /api/receivables]', { event: 'api.route_error', error })
    return serverError()
  }
}
