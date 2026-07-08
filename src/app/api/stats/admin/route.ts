/**
 * GET /api/stats/admin — dashboard stats for the super admin
 * Returns: thisMonthRevenue, expectedRevenue, activeShops, dueSoon, shops
 */

import { prisma } from '@/lib/prisma'
import { ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
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

    const [thisMonthResult, totalRevenueResult, totalShops, activeShops, suspendedShops, dueSoon, overdue, shops] =
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

      // All shops ordered by subscriptionDue for the table. `expectedRevenue`
      // below is a real aggregate over every ACTIVE shop, so this can't be
      // paginated without breaking that number — the cap here is purely a
      // safety net against unbounded growth (this is the platform operator's
      // own shop count, not user-generated data), not a page size.
      prisma.shop.findMany({
        where: { deletedAt: null },
        take: 2000,
        include: {
          admins: { where: { deletedAt: null, isActive: true }, select: shopAdminPublicSelect },
          payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' }, take: 1 },
          _count: {
            select: {
              devices: { where: { deletedAt: null } },
              nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
            },
          },
        },
        orderBy: { subscriptionDue: 'asc' },
      }),
    ])

    const thisMonthRevenue = Number(thisMonthResult._sum.amount ?? 0)
    const totalRevenue = Number(totalRevenueResult._sum.amount ?? 0)
    const totalPayments = totalRevenueResult._count.id
    const expectedRevenue = shops.reduce((sum, shop) => {
      if (shop.status !== 'ACTIVE') return sum
      const latestPayment = shop.payments[0]
      if (!latestPayment) return sum
      return sum + Number(latestPayment.amount) / Math.max(1, latestPayment.months)
    }, 0)

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
      shops,
    })
  } catch (err) {
    logger.error('[GET /api/stats/admin]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
