import 'server-only'

import { unstable_cache } from 'next/cache'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { shopCacheTag } from '@/lib/server/cache-tags'
import { tashkentDayRange, tashkentMonthRangeFromKey } from '@/lib/timezone'
import { getUsdUzsRate } from '@/lib/server/currency'
import { computeShopStatsFromRows } from '@/lib/shop-stats-formulas'
import {
  getShopAccrualAggregate,
  getNasiyaWriteOffAggregate,
  getShopObligationAggregate,
  getUpcomingScheduleIds,
} from '@/lib/server/shop-stats-queries'

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
  const { start: todayStart } = tashkentDayRange(now)
  const attributedTo = adminId ? { createdBy: adminId } : {}
  // Single rate fetch for the whole batch, matching every other "live view"
  // conversion in this codebase — best-effort, never blocks the dashboard.
  const usdUzsRate = await getUsdUzsRate().catch(() => null)

  const [
    totalDevices,
    accrualAggregate,
    saleReceivedAgg,
    nasiyaReceivedAgg,
    activeNasiyalar,
    obligationAggregate,
    inventoryAgg,
    returnAccountingAgg,
    returnsThisMonth,
    recentActivity,
    upcomingScheduleIds,
    writeOffAggregate,
  ] = await Promise.all([
    prisma.device.count({
      // Imported devices exist only to carry pre-Oryx debt — they were never
      // stocked through Oryx, so they don't count as the shop's devices.
      where: { shopId, deletedAt: null, isImported: false },
    }),

    getShopAccrualAggregate({ shopId, monthStart, monthEnd, adminId }),

    prisma.salePayment.aggregate({
      _sum: { amount: true },
      where: {
        shopId,
        deletedAt: null,
        paidAt: { gte: monthStart, lt: monthEnd },
        ...attributedTo,
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
      where: { shopId, deletedAt: null, resolutionState: 'ACTIVE', status: { in: ['ACTIVE', 'OVERDUE'] } },
    }),

    getShopObligationAggregate({ shopId, monthStart, monthEnd, todayStart }),

    prisma.device.aggregate({
      _sum: { purchasePrice: true },
      where: {
        shopId,
        deletedAt: null,
        status: 'IN_STOCK',
      },
    }),

    prisma.deviceReturn.aggregate({
      _sum: {
        refundAmount: true,
        revenueReversalAmountUzs: true,
        interestReversalAmountUzs: true,
        inventoryCostRecoveryUzs: true,
        retainedValueAmountUzs: true,
      },
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

    getUpcomingScheduleIds(shopId, 5),

    getNasiyaWriteOffAggregate({ shopId, monthStart, monthEnd, adminId }),
  ])

  const upcomingRows = upcomingScheduleIds.length
    ? await prisma.nasiyaSchedule.findMany({
        where: { id: { in: upcomingScheduleIds }, shopId },
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
      })
    : []
  const upcomingById = new Map(upcomingRows.map((row) => [row.id, row]))
  const upcomingPayments = upcomingScheduleIds
    .map((id) => upcomingById.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))

  const computed = computeShopStatsFromRows({
    now,
    monthStart,
    monthEnd,
    usdUzsRate,
    totalDevices,
    cashSalesThisMonth: [],
    accrualAggregate,
    saleReceivedSum: saleReceivedAgg._sum.amount,
    nasiyaSoldThisMonth: [],
    nasiyaReceivedSum: nasiyaReceivedAgg._sum.amount,
    activeNasiyalar: activeNasiyalar + obligationAggregate.falseCompletedCount,
    nasiyaSchedulesForStats: [],
    unpaidSales: [],
    obligationAggregate,
    inventoryPurchaseCostSum: inventoryAgg._sum.purchasePrice,
    returnRefundSum: returnAccountingAgg._sum.refundAmount,
    returnRevenueReversalSum: returnAccountingAgg._sum.revenueReversalAmountUzs,
    returnInterestReversalSum: returnAccountingAgg._sum.interestReversalAmountUzs,
    returnInventoryCostRecoverySum: returnAccountingAgg._sum.inventoryCostRecoveryUzs,
    returnRetainedValueSum: returnAccountingAgg._sum.retainedValueAmountUzs,
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
    writeOffsThisMonthNativeUzs: writeOffAggregate.nativeUzs,
    writeOffsThisMonthNativeUsd: writeOffAggregate.nativeUsd,
    writeOffsThisMonthFrozenUzs: writeOffAggregate.frozenUzs,
    writeOffCountThisMonth: writeOffAggregate.writeOffCount,
    writeOffReopenCountThisMonth: writeOffAggregate.reopenCount,
    monthKey: tashkentMonthRangeFromKey(monthKey, now).monthKey,
    filteredByAdmin: adminId,
    nonAttributableFields: ['totalDevices', 'activeNasiyalar', 'inventoryPurchaseCost', 'expectedThisMonth', 'overdueMoney', 'upcomingPayments'] as const,
  }
}
