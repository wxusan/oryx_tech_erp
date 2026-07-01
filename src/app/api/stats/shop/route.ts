/**
 * GET /api/stats/shop?shopId=... — shop dashboard statistics
 *
 * Auth: SHOP_ADMIN (auto-scoped to their shop) or SUPER_ADMIN (shopId param required)
 * Returns: totalDevices, soldThisMonth, activeNasiyalar, expectedThisMonth,
 *          overdueCount, recentActivity, upcomingPayments
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { tashkentMonthRange } from '@/lib/timezone'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const now = new Date()
    const { start: monthStart, end: monthEnd } = tashkentMonthRange(now)

    const [
      totalDevices,
      cashSalesThisMonth,
      saleReceivedAgg,
      nasiyaSoldThisMonth,
      nasiyaReceivedAgg,
      activeNasiyalar,
      nasiyaSchedulesForStats,
      unpaidSales,
      inventoryAgg,
      returnRefundAgg,
      returnsThisMonth,
      recentActivity,
      upcomingPayments,
    ] = await Promise.all([
      // Total devices (not deleted)
      prisma.device.count({
        where: { shopId, deletedAt: null },
      }),

      // Cash sales this month with device cost for profit.
      prisma.sale.findMany({
        where: {
          shopId,
          deletedAt: null,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        include: { device: true },
      }),

      prisma.salePayment.aggregate({
        _sum: { amount: true },
        where: {
          shopId,
          deletedAt: null,
          paidAt: { gte: monthStart, lt: monthEnd },
          sale: { deletedAt: null },
        },
      }),

      // Nasiya plans created this month with device cost for cash-basis profit visibility.
      prisma.nasiya.findMany({
        where: {
          shopId,
          deletedAt: null,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        include: { device: true },
      }),

      // Nasiya money actually received this month
      prisma.nasiyaPayment.aggregate({
        _sum: { amount: true },
        where: {
          shopId,
          deletedAt: null,
          paidAt: { gte: monthStart, lt: monthEnd },
          nasiya: { deletedAt: null, status: { not: 'CANCELLED' } },
        },
      }),

      // Active nasiya count
      prisma.nasiya.count({
        where: { shopId, deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE'] } },
      }),

      // Schedules used for expected/overdue calculations. Compute outstanding
      // balances in JS because PARTIAL rows need expected - paid.
      prisma.nasiyaSchedule.findMany({
        where: {
          shopId,
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
          nasiya: { is: { deletedAt: null, status: { not: 'CANCELLED' } } },
        },
      }),

      // Direct-sale receivables are not schedules, but still expected/overdue money.
      prisma.sale.findMany({
        where: {
          shopId,
          deletedAt: null,
          paidFully: false,
          remainingAmount: { gt: 0 },
        },
      }),

      // Inventory purchase cost currently held in stock.
      prisma.device.aggregate({
        _sum: { purchasePrice: true },
        where: {
          shopId,
          deletedAt: null,
          status: { in: ['IN_STOCK', 'RESERVED'] },
        },
      }),

      prisma.deviceReturn.aggregate({
        _sum: { refundAmount: true },
        where: {
          shopId,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
      }),

      prisma.deviceReturn.count({
        where: {
          shopId,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
      }),

      // Last 5 log entries for this shop
      prisma.log.findMany({
        where: {
          shopId,
          ...(session.user.role === 'SHOP_ADMIN' ? { actorType: 'SHOP_ADMIN' as const } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      // Upcoming schedules are sorted by effective due date below because
      // delayed rows use delayedUntil instead of the original dueDate.
      prisma.nasiyaSchedule.findMany({
        where: {
          shopId,
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
          nasiya: { is: { deletedAt: null, status: { not: 'CANCELLED' } } },
        },
        orderBy: { dueDate: 'asc' },
        take: 50,
        include: {
          nasiya: {
            include: {
              customer: {
                select: {
                  id: true,
                  shopId: true,
                  name: true,
                  phone: true,
                  note: true,
                  createdAt: true,
                },
              },
              device: true,
            },
          },
        },
      }),
    ])

    const cashReceived = Number(saleReceivedAgg._sum.amount ?? 0)
    const soldDeviceCost = cashSalesThisMonth.reduce(
      (sum, sale) => sum + Number(sale.device.purchasePrice),
      0,
    )
    const nasiyaDeviceCost = nasiyaSoldThisMonth.reduce(
      (sum, nasiya) => sum + Number(nasiya.device.purchasePrice),
      0,
    )
    const nasiyaReceived = Number(nasiyaReceivedAgg._sum.amount ?? 0)
    const cashReceivedThisMonth = cashReceived + nasiyaReceived
    const accrualRevenueThisMonth =
      cashSalesThisMonth.reduce((sum, sale) => sum + Number(sale.salePrice), 0) +
      nasiyaSoldThisMonth.reduce((sum, nasiya) => sum + Number(nasiya.totalAmount), 0)
    const accrualGrossProfitThisMonth = accrualRevenueThisMonth - soldDeviceCost - nasiyaDeviceCost
    const cashBasisProfitThisMonth = cashReceivedThisMonth - soldDeviceCost - nasiyaDeviceCost
    const outstanding = (expected: unknown, paid: unknown) => Math.max(0, Number(expected) - Number(paid))
    const effectiveDue = (row: { delayedUntil: Date | null; dueDate: Date }) => row.delayedUntil ?? row.dueDate
    const expectedThisMonth =
      nasiyaSchedulesForStats.reduce((sum, schedule) => {
        const due = effectiveDue(schedule)
        if (due < monthStart || due >= monthEnd) return sum
        return sum + outstanding(schedule.expectedAmount, schedule.paidAmount)
      }, 0) +
      unpaidSales.reduce((sum, sale) => {
        if (!sale.dueDate || sale.dueDate < monthStart || sale.dueDate >= monthEnd) return sum
        return sum + Number(sale.remainingAmount)
      }, 0)
    const overdueSchedules = nasiyaSchedulesForStats.filter((schedule) => {
      if (outstanding(schedule.expectedAmount, schedule.paidAmount) <= 0) return false
      return effectiveDue(schedule) < now
    })
    const overdueSales = unpaidSales.filter((sale) => sale.dueDate && sale.dueDate < now)
    const overdueMoney =
      overdueSchedules.reduce((sum, schedule) => sum + outstanding(schedule.expectedAmount, schedule.paidAmount), 0) +
      overdueSales.reduce((sum, sale) => sum + Number(sale.remainingAmount), 0)
    const inventoryPurchaseCost = Number(inventoryAgg._sum.purchasePrice ?? 0)
    const returnRefundsThisMonth = Number(returnRefundAgg._sum.refundAmount ?? 0)
    const overdueCount = overdueSchedules.length + overdueSales.length

    return ok({
      totalDevices,
      cashReceivedThisMonth,
      soldThisMonth: cashSalesThisMonth.length,
      activeNasiyalar,
      expectedThisMonth,
      overdueMoney,
      inventoryPurchaseCost,
      realProfitThisMonth: cashBasisProfitThisMonth,
      accrualGrossProfitThisMonth,
      cashCollectedThisMonth: cashReceivedThisMonth,
      returnRefundsThisMonth,
      returnsThisMonth,
      netCashAfterReturnsThisMonth: cashReceivedThisMonth - returnRefundsThisMonth,
      overdueCount,
      recentActivity,
      upcomingPayments: upcomingPayments
        .sort((left, right) => effectiveDue(left).getTime() - effectiveDue(right).getTime())
        .slice(0, 5),
    })
  } catch (err) {
    console.error('[GET /api/stats/shop]', err)
    return serverError()
  }
}
