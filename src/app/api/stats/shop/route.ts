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
import { startOfMonth, endOfMonth } from 'date-fns'

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
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)

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
          createdAt: { gte: monthStart, lte: monthEnd },
        },
        include: { device: true },
      }),

      prisma.salePayment.aggregate({
        _sum: { amount: true },
        where: {
          shopId,
          deletedAt: null,
          paidAt: { gte: monthStart, lte: monthEnd },
        },
      }),

      // Nasiya plans created this month with device cost for cash-basis profit visibility.
      prisma.nasiya.findMany({
        where: {
          shopId,
          deletedAt: null,
          createdAt: { gte: monthStart, lte: monthEnd },
        },
        include: { device: true },
      }),

      // Nasiya money actually received this month
      prisma.nasiyaPayment.aggregate({
        _sum: { amount: true },
        where: {
          shopId,
          deletedAt: null,
          paidAt: { gte: monthStart, lte: monthEnd },
        },
      }),

      // Active nasiya count
      prisma.nasiya.count({
        where: { shopId, deletedAt: null, status: 'ACTIVE' },
      }),

      // Schedules used for expected/overdue calculations. Compute outstanding
      // balances in JS because PARTIAL rows need expected - paid.
      prisma.nasiyaSchedule.findMany({
        where: {
          shopId,
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
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

      // Last 5 log entries for this shop
      prisma.log.findMany({
        where: { shopId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      // Next 5 upcoming pending/partial schedules
      prisma.nasiyaSchedule.findMany({
        where: {
          shopId,
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
        },
        orderBy: { dueDate: 'asc' },
        take: 5,
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
    const outstanding = (expected: unknown, paid: unknown) => Math.max(0, Number(expected) - Number(paid))
    const effectiveDue = (row: { delayedUntil: Date | null; dueDate: Date }) => row.delayedUntil ?? row.dueDate
    const expectedThisMonth =
      nasiyaSchedulesForStats.reduce((sum, schedule) => {
        const due = effectiveDue(schedule)
        if (due < monthStart || due > monthEnd) return sum
        return sum + outstanding(schedule.expectedAmount, schedule.paidAmount)
      }, 0) +
      unpaidSales.reduce((sum, sale) => {
        if (!sale.dueDate || sale.dueDate < monthStart || sale.dueDate > monthEnd) return sum
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
    const overdueCount = overdueSchedules.length + overdueSales.length

    return ok({
      totalDevices,
      cashReceivedThisMonth,
      soldThisMonth: cashSalesThisMonth.length,
      activeNasiyalar,
      expectedThisMonth,
      overdueMoney,
      inventoryPurchaseCost,
      realProfitThisMonth: cashReceivedThisMonth - soldDeviceCost - nasiyaDeviceCost,
      accrualGrossProfitThisMonth,
      cashCollectedThisMonth: cashReceivedThisMonth,
      overdueCount,
      recentActivity,
      upcomingPayments,
    })
  } catch (err) {
    console.error('[GET /api/stats/shop]', err)
    return serverError()
  }
}
