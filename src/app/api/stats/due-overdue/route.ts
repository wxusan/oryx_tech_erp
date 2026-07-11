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
import { prisma } from '@/lib/prisma'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { isContractScheduleOverdue, contractOutstandingAsUzs, convertContractAmountToUzs } from '@/lib/nasiya-contract'
import { logger } from '@/lib/logger'

export async function GET() {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, null)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const now = new Date()

    const [overdueSchedules, overdueSales, currency] = await Promise.all([
      prisma.nasiyaSchedule.findMany({
        where: {
          shopId,
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
          OR: [
            { delayedUntil: { lt: now } },
            { delayedUntil: null, dueDate: { lt: now } },
          ],
          nasiya: { is: { deletedAt: null, status: { not: 'CANCELLED' } } },
        },
        select: {
          dueDate: true,
          delayedUntil: true,
          status: true,
          contractExpectedAmount: true,
          contractPaidAmount: true,
          nasiya: { select: { id: true, contractCurrency: true } },
        },
      }),
      prisma.sale.findMany({
        where: {
          shopId,
          deletedAt: null,
          paidFully: false,
          remainingAmount: { gt: 0 },
          dueDate: { lt: now },
        },
        select: { id: true, dueDate: true, contractCurrency: true, contractRemainingAmount: true },
      }),
      getShopCurrencyContext(shopId),
    ])

    const overdueNasiyaSchedules = overdueSchedules.filter((s) =>
      isContractScheduleOverdue(
        { status: s.status, dueDate: s.dueDate, delayedUntil: s.delayedUntil, expectedAmount: Number(s.contractExpectedAmount), paidAmount: Number(s.contractPaidAmount) },
        s.nasiya.contractCurrency,
        now,
      ),
    )
    const overdueSalesRows = overdueSales.filter((s) => s.dueDate && s.dueDate < now)

    const overdueMoneyUzs =
      overdueNasiyaSchedules.reduce(
        (sum, s) => sum + contractOutstandingAsUzs(s.contractExpectedAmount, s.contractPaidAmount, s.nasiya.contractCurrency, currency.usdUzsRate),
        0,
      ) +
      overdueSalesRows.reduce((sum, s) => sum + convertContractAmountToUzs(Number(s.contractRemainingAmount), s.contractCurrency, currency.usdUzsRate), 0)

    const distinctNasiyaIds = new Set(overdueNasiyaSchedules.map((s) => s.nasiya.id))
    const distinctDealCount = distinctNasiyaIds.size + overdueSalesRows.length

    // A direct link only when there is exactly one overdue deal in total —
    // otherwise the banner links to the filtered list instead.
    let singleDeal: { type: 'nasiya' | 'sale'; id: string } | null = null
    if (distinctDealCount === 1) {
      if (distinctNasiyaIds.size === 1) singleDeal = { type: 'nasiya', id: [...distinctNasiyaIds][0] }
      else singleDeal = { type: 'sale', id: overdueSalesRows[0].id }
    }

    return ok(
      {
        overdueDealCount: distinctDealCount,
        overdueMoneyUzs,
        currency,
        singleDeal,
      },
      'Kechikkan to\'lovlar xulosasi',
    )
  } catch (err) {
    logger.error('[GET /api/stats/due-overdue]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
