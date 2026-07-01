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

    const [thisMonthResult, activeShops, dueSoon, shops] = await Promise.all([
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

      // All shops ordered by subscriptionDue for the table
      prisma.shop.findMany({
        where: { deletedAt: null },
        include: {
          admins: { where: { deletedAt: null, isActive: true }, select: shopAdminPublicSelect },
          payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' }, take: 1 },
          _count: { select: { devices: true, nasiya: true } },
        },
        orderBy: { subscriptionDue: 'asc' },
      }),
    ])

    const thisMonthRevenue = Number(thisMonthResult._sum.amount ?? 0)
    // expectedRevenue: approximate — active shop count × 500 000 (no per-shop price stored)
    const expectedRevenue = activeShops * 500000

    return ok({
      thisMonthRevenue,
      expectedRevenue,
      activeShops,
      dueSoon,
      shops,
    })
  } catch (err) {
    console.error('[GET /api/stats/admin]', err)
    return serverError()
  }
}
