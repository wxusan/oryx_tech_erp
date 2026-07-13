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

export async function GET() {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const now = new Date()
    const { start: monthStart, end: monthEnd } = tashkentMonthRange(now)
    const dueSoonCutoff = addDays(now, 7)

    const [thisMonthResult, totalRevenueResult, totalShops, activeShops, suspendedShops, dueSoon, overdue, expectedRevenueRows] =
      await Promise.all([
      // This month's total revenue
      prisma.shopPayment.aggregate({
        _sum: { amount: true },
        where: { deletedAt: null, paidAt: { gte: monthStart, lt: monthEnd } },
      }),

      prisma.shopPayment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: { deletedAt: null },
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

      // Aggregate over every active shop without loading a capped shop/admin/
      // payment payload into the function. Due-shop reporting and payment
      // history have their own authoritative paginated projections.
      prisma.$queryRaw<Array<{ expectedRevenue: number }>>`
        SELECT COALESCE(
          SUM(latest.amount / GREATEST(latest.months, 1)),
          0
        )::double precision AS "expectedRevenue"
        FROM "Shop" shop
        LEFT JOIN LATERAL (
          SELECT payment.amount, payment.months
          FROM "ShopPayment" payment
          WHERE payment."shopId" = shop.id
            AND payment."deletedAt" IS NULL
          ORDER BY payment."paidAt" DESC
          LIMIT 1
        ) latest ON true
        WHERE shop.status = 'ACTIVE'::"ShopStatus"
          AND shop."deletedAt" IS NULL
      `,
    ])

    const thisMonthRevenue = Number(thisMonthResult._sum.amount ?? 0)
    const totalRevenue = Number(totalRevenueResult._sum.amount ?? 0)
    const totalPayments = totalRevenueResult._count.id
    const expectedRevenue = Number(expectedRevenueRows[0]?.expectedRevenue ?? 0)

    return ok({
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
