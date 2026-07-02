import 'server-only'

import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { tashkentMonthRange } from '@/lib/timezone'

export async function getShopStats(session: Session, shopId: string) {
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
    prisma.device.count({
      where: { shopId, deletedAt: null },
    }),

    prisma.sale.findMany({
      where: {
        shopId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      select: {
        salePrice: true,
        device: { select: { purchasePrice: true } },
      },
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

    prisma.nasiya.findMany({
      where: {
        shopId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      select: {
        totalAmount: true,
        device: { select: { purchasePrice: true } },
      },
    }),

    prisma.nasiyaPayment.aggregate({
      _sum: { amount: true },
      where: {
        shopId,
        deletedAt: null,
        paidAt: { gte: monthStart, lt: monthEnd },
        nasiya: { deletedAt: null, status: { not: 'CANCELLED' } },
      },
    }),

    prisma.nasiya.count({
      where: { shopId, deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE'] } },
    }),

    prisma.nasiyaSchedule.findMany({
      where: {
        shopId,
        status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
        nasiya: { is: { deletedAt: null, status: { not: 'CANCELLED' } } },
      },
      select: {
        dueDate: true,
        delayedUntil: true,
        expectedAmount: true,
        paidAmount: true,
        status: true,
      },
    }),

    prisma.sale.findMany({
      where: {
        shopId,
        deletedAt: null,
        paidFully: false,
        remainingAmount: { gt: 0 },
      },
      select: {
        dueDate: true,
        remainingAmount: true,
      },
    }),

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

    prisma.log.findMany({
      where: {
        shopId,
        ...(session.user.role === 'SHOP_ADMIN' ? { actorType: 'SHOP_ADMIN' as const } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actorId: true,
      },
    }),

    prisma.nasiyaSchedule.findMany({
      where: {
        shopId,
        status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
        nasiya: { is: { deletedAt: null, status: { not: 'CANCELLED' } } },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
      select: {
        id: true,
        dueDate: true,
        delayedUntil: true,
        expectedAmount: true,
        paidAmount: true,
        status: true,
        nasiya: {
          select: {
            customer: { select: { name: true } },
            device: { select: { model: true } },
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

  return {
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
      .slice(0, 5)
      .map((payment) => ({
        ...payment,
        expectedAmount: Number(payment.expectedAmount),
        paidAmount: Number(payment.paidAmount),
      })),
  }
}
