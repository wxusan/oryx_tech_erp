import 'server-only'

import { unstable_cache } from 'next/cache'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { shopCacheTag } from '@/lib/server/cache-tags'
import { tashkentMonthRangeFromKey } from '@/lib/timezone'
import { getUsdUzsRate } from '@/lib/server/currency'
import { computeShopStatsFromRows } from '@/lib/shop-stats-formulas'
import { contractScheduleOutstanding } from '@/lib/nasiya-contract'

type StatsRole = Session['user']['role']

/**
 * Item 8 — optional month + admin filter for the hisobot page. Both default
 * to "no filter" (current month, all admins), which is byte-identical to
 * this function's pre-item-8 behavior — existing callers (dashboard,
 * /api/stats/shop) that don't pass `options` are unaffected.
 *
 * `adminId` only narrows the flow stats that genuinely have a `createdBy`/
 * `actorId` (Sale, SalePayment, Nasiya, NasiyaPayment, DeviceReturn, Log).
 * Current-state stats with no single admin to attribute them to (device
 * stock value, currently-active nasiya count, currently-outstanding
 * schedules) are deliberately left shop-wide rather than faking attribution
 * — see docs/audits/dashboard-stat-formulas.md.
 */
export interface ShopStatsOptions {
  /** `YYYY-MM`, Tashkent calendar month. Defaults to the current month. */
  monthKey?: string | null
  /** Shop admin id to filter admin-attributable stats by. Null/omitted = all admins. */
  adminId?: string | null
}

export async function getShopStats(session: Session, shopId: string, options: ShopStatsOptions = {}) {
  const role = session.user.role
  const monthKey = options.monthKey ?? null
  const adminId = options.adminId ?? null

  return unstable_cache(
    () => getShopStatsFresh(role, shopId, monthKey, adminId),
    ['shop-stats:v2', shopId, role, monthKey ?? 'current', adminId ?? 'all'],
    {
      // Money/overdue figures are high-churn. Keep the TTL short and expire
      // these tags immediately after sale/payment/return mutations.
      revalidate: 15,
      tags: [
        shopCacheTag.stats(shopId),
        shopCacheTag.reports(shopId),
        shopCacheTag.devices(shopId),
        shopCacheTag.sales(shopId),
        shopCacheTag.nasiyalar(shopId),
        shopCacheTag.nasiyaSchedules(shopId),
        shopCacheTag.returns(shopId),
        shopCacheTag.logs(shopId),
        shopCacheTag.customers(shopId),
      ],
    },
  )()
}

async function getShopStatsFresh(role: StatsRole, shopId: string, monthKey: string | null, adminId: string | null) {
  const now = new Date()
  const { start: monthStart, end: monthEnd } = tashkentMonthRangeFromKey(monthKey, now)
  const attributedTo = adminId ? { createdBy: adminId } : {}
  // Single rate fetch for the whole batch, matching every other "live view"
  // conversion in this codebase — best-effort, never blocks the dashboard.
  const usdUzsRate = await getUsdUzsRate().catch(() => null)

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
      // Imported devices exist only to carry pre-Oryx debt — they were never
      // stocked through Oryx, so they don't count as the shop's devices.
      where: { shopId, deletedAt: null, isImported: false },
    }),

    prisma.sale.findMany({
      where: {
        shopId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...attributedTo,
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
        ...attributedTo,
      },
    }),

    prisma.nasiya.findMany({
      where: {
        shopId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
        // CRITICAL: imported (pre-Oryx) nasiyas are carried-over debt, not new
        // sales. Their originalTotalAmount / interest / device cost must NEVER
        // enter this month's gross, interest or profit.
        isImported: false,
        ...attributedTo,
      },
      select: {
        totalAmount: true,
        interestAmount: true,
        device: { select: { purchasePrice: true } },
      },
    }),

    prisma.nasiyaPayment.aggregate({
      _sum: { amount: true },
      where: {
        shopId,
        deletedAt: null,
        paidAt: { gte: monthStart, lt: monthEnd },
        ...attributedTo,
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
        contractExpectedAmount: true,
        contractPaidAmount: true,
        nasiya: {
          select: {
            id: true,
            status: true,
            contractCurrency: true,
          },
        },
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
        contractCurrency: true,
        contractRemainingAmount: true,
      },
    }),

    prisma.device.aggregate({
      _sum: { purchasePrice: true },
      where: {
        shopId,
        deletedAt: null,
        status: 'IN_STOCK',
      },
    }),

    prisma.deviceReturn.aggregate({
      _sum: { refundAmount: true },
      where: {
        shopId,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...attributedTo,
      },
    }),

    prisma.deviceReturn.count({
      where: {
        shopId,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...attributedTo,
      },
    }),

    prisma.log.findMany({
      where: {
        shopId,
        ...(role === 'SHOP_ADMIN' ? { actorType: 'SHOP_ADMIN' as const } : {}),
        ...(adminId ? { actorId: adminId } : {}),
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
        contractExpectedAmount: true,
        contractPaidAmount: true,
        nasiya: {
          select: {
            id: true,
            contractCurrency: true,
            customer: { select: { name: true } },
            device: { select: { model: true } },
          },
        },
      },
    }),
  ])

  // Parent status is normally maintained by the payment transaction. Older
  // rows can however be marked COMPLETED by legacy-UZS status derivation
  // while a PARTIAL/OVERDUE native schedule still owes money after FX drift.
  // Include those contracts in the active count without writing historical
  // data during a dashboard read; the repair plan covers persistent cleanup.
  const falseCompletedNasiyaIds = new Set(
    nasiyaSchedulesForStats
      .filter(
        (schedule) =>
          schedule.nasiya.status === 'COMPLETED' &&
          contractScheduleOutstanding(
            Number(schedule.contractExpectedAmount),
            Number(schedule.contractPaidAmount),
            schedule.nasiya.contractCurrency,
          ) > 0,
      )
      .map((schedule) => schedule.nasiya.id),
  )

  const computed = computeShopStatsFromRows({
    now,
    monthStart,
    monthEnd,
    usdUzsRate,
    totalDevices,
    cashSalesThisMonth,
    saleReceivedSum: saleReceivedAgg._sum.amount,
    nasiyaSoldThisMonth,
    nasiyaReceivedSum: nasiyaReceivedAgg._sum.amount,
    activeNasiyalar: activeNasiyalar + falseCompletedNasiyaIds.size,
    nasiyaSchedulesForStats,
    unpaidSales,
    inventoryPurchaseCostSum: inventoryAgg._sum.purchasePrice,
    returnRefundSum: returnRefundAgg._sum.refundAmount,
    returnsThisMonth,
    recentActivity,
    upcomingPayments,
  })

  // Item 8 — echo back which month/admin this snapshot reflects, and which
  // fields are NOT admin-attributable, so the UI never fakes attribution for
  // current-state figures (device stock value, currently-active nasiyalar,
  // currently-outstanding schedules) that have no single admin to blame/credit.
  return {
    ...computed,
    monthKey: tashkentMonthRangeFromKey(monthKey, now).monthKey,
    filteredByAdmin: adminId,
    nonAttributableFields: ['totalDevices', 'activeNasiyalar', 'inventoryPurchaseCost', 'expectedThisMonth', 'overdueMoney', 'upcomingPayments'] as const,
  }
}
