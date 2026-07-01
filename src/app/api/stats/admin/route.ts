/**
 * GET /api/stats/admin — dashboard stats for the super admin
 * Returns: thisMonthRevenue, expectedRevenue, activeShops, dueSoon, shops
 */

import { prisma } from '@/lib/prisma'
import { ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { startOfMonth, endOfMonth, addDays } from 'date-fns'

export async function GET() {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const now = new Date()
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)
    const dueSoonCutoff = addDays(now, 7)

    const [thisMonthResult, activeShops, dueSoon, overdue, shops] = await Promise.all([
      // This month's total revenue
      prisma.shopPayment.aggregate({
        _sum: { amount: true },
        where: { deletedAt: null, paidAt: { gte: monthStart, lte: monthEnd } },
      }),

      // Active shops count
      prisma.shop.count({
        where: { status: 'ACTIVE', deletedAt: null },
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

      // All shops ordered by subscriptionDue for the table
      prisma.shop.findMany({
        where: { deletedAt: null },
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
    const expectedRevenue = shops.reduce((sum, shop) => {
      if (shop.status !== 'ACTIVE') return sum
      const latestPayment = shop.payments[0]
      if (!latestPayment) return sum
      return sum + Number(latestPayment.amount) / Math.max(1, latestPayment.months)
    }, 0)

    return ok({
      thisMonthRevenue,
      expectedRevenue,
      activeShops,
      dueSoon,
      overdue,
      shops,
    })
  } catch (err) {
    console.error('[GET /api/stats/admin]', err)
    return serverError()
  }
}
