/**
 * GET /api/stats/admin — dashboard stats for the super admin
 * Returns: thisMonthRevenue, expectedRevenue, activeShops, dueSoon, shops
 */

import { prisma } from '@/lib/prisma'
import { ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { tashkentMonthRange } from '@/lib/timezone'
import { addDays } from 'date-fns'
import { logger } from '@/lib/logger'
import { adminReportingContext, summarizeShopPaymentGroups } from '@/lib/admin-money'
import { getSuperAdminCurrencyContext } from '@/lib/server/currency'

const PLATFORM_REVENUE_REPORT_WINDOW_ID = 'platform'

function startsAtOrAfter(periodStart: Date, revenueStart: Date | null) {
  return revenueStart && revenueStart > periodStart ? revenueStart : periodStart
}

export async function GET() {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const now = new Date()
    const { start: monthStart, end: monthEnd } = tashkentMonthRange(now)
    const dueSoonCutoff = addDays(now, 7)
    const revenueWindow = await prisma.platformRevenueReportWindow.findUnique({
      where: { id: PLATFORM_REVENUE_REPORT_WINDOW_ID },
      select: { subscriptionRevenueStartsAt: true },
    })
    const subscriptionRevenueStartsAt = revenueWindow?.subscriptionRevenueStartsAt ?? null
    const reportablePaymentWhere = {
      deletedAt: null,
      ...(subscriptionRevenueStartsAt ? { paidAt: { gte: subscriptionRevenueStartsAt } } : {}),
    }

    const [thisMonthResult, totalRevenueResult, totalShops, activeShops, suspendedShops, dueSoon, overdue, expectedRevenueRows, currency] =
      await Promise.all([
      // This month's total revenue
      prisma.shopPayment.groupBy({
        by: ['currency'],
        _sum: { amount: true, amountUzsSnapshot: true, amountUsdSnapshot: true },
        _count: { id: true, amountUzsSnapshot: true, amountUsdSnapshot: true },
        where: {
          deletedAt: null,
          paidAt: { gte: startsAtOrAfter(monthStart, subscriptionRevenueStartsAt), lt: monthEnd },
        },
      }),

      prisma.shopPayment.groupBy({
        by: ['currency'],
        _sum: { amount: true, amountUzsSnapshot: true, amountUsdSnapshot: true },
        _count: { id: true, amountUzsSnapshot: true, amountUsdSnapshot: true },
        where: reportablePaymentWhere,
      }),

      prisma.shop.count({
        where: { deletedAt: null },
      }),

      // Active shops count
      prisma.shop.count({
        where: { status: 'ACTIVE', deletedAt: null },
      }),

      prisma.shop.count({
        where: { status: 'SUSPENDED', deletedAt: null },
      }),

      // Shops with subscription due within 7 days
      prisma.shop.count({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          subscriptionDue: { gte: now, lte: dueSoonCutoff },
        },
      }),

      prisma.shop.count({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          subscriptionDue: { lt: now },
        },
      }),

      // Expected subscription revenue comes from each active shop's current
      // reviewed package, partitioned by its native billing currency. It is a
      // future/current obligation and may be converted at the governed live
      // rate by the UI; historical receipts above use frozen snapshots.
      prisma.$queryRaw<Array<{ expected_uzs: unknown; expected_usd: unknown }>>`
        SELECT
          COALESCE(SUM(current_package.monthly_price) FILTER (WHERE current_package.currency = 'UZS'), 0)::numeric AS expected_uzs,
          COALESCE(SUM(current_package.monthly_price) FILTER (WHERE current_package.currency = 'USD'), 0)::numeric AS expected_usd
        FROM "Shop" shop
        LEFT JOIN LATERAL (
          SELECT
            package.currency,
            GREATEST(
              package."basePrice"
                + COALESCE(SUM(feature."recurringPrice") FILTER (WHERE feature.enabled), 0)
                - package."discountAmount",
              0
            )::numeric AS monthly_price
          FROM "ShopPackageVersion" package
          LEFT JOIN "ShopPackageFeature" feature ON feature."packageVersionId" = package.id
          WHERE package."shopId" = shop.id
            AND package."effectiveOn" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tashkent')::date
            AND package."pricingNeedsReview" = FALSE
          GROUP BY package.id
          ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
          LIMIT 1
        ) current_package ON true
        WHERE shop.status = 'ACTIVE'::"ShopStatus"
          AND shop."deletedAt" IS NULL
      `,
      getSuperAdminCurrencyContext(guarded.session.user.id),
    ])

    const thisMonthRevenue = summarizeShopPaymentGroups(thisMonthResult)
    const totalRevenue = summarizeShopPaymentGroups(totalRevenueResult)
    const totalPayments = totalRevenue.count
    const expectedRevenue = {
      uzs: Number(expectedRevenueRows[0]?.expected_uzs ?? 0),
      usd: Number(expectedRevenueRows[0]?.expected_usd ?? 0),
    }

    return ok({
      reporting: adminReportingContext(currency),
      thisMonthRevenue,
      totalRevenue,
      totalPayments,
      expectedRevenue,
      totalShops,
      activeShops,
      suspendedShops,
      dueSoon,
      overdue,
    })
  } catch (err) {
    logger.error('[GET /api/stats/admin]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
