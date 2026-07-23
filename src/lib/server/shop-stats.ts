import 'server-only'

import { unstable_cache } from 'next/cache'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { shopCacheTag } from '@/lib/server/cache-tags'
import { tashkentDayRange, tashkentMonthRangeFromKey } from '@/lib/timezone'
import { getStoredUsdUzsRateSnapshot } from '@/lib/server/currency'
import { computeShopStatsFromRows } from '@/lib/shop-stats-formulas'
import {
  getShopMonthlyAccountingAggregate,
  getNasiyaWriteOffAggregate,
  getShopObligationAggregate,
  getShopDebtStatsAggregate,
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
    ['shop-stats:v6-realized-profit-only', shopId, role, monthKey ?? 'current', adminId ?? 'all'],
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
        shopCacheTag.debts(shopId),
      ],
    },
  )()
}

export type ShopStatsResult = Awaited<ReturnType<typeof getShopStats>>

/** Count-only dashboard path for operational staff. It never selects prices,
 * balances, payment amounts, cost basis, profit, refunds, or write-off money. */
export async function getShopOperationalStats(session: Session, shopId: string): Promise<ShopStatsResult> {
  const role = session.user.role
  return unstable_cache(
    () => getShopOperationalStatsFresh(role, shopId),
    ['shop-operational-stats:v1', shopId, role],
    {
      revalidate: 15,
      tags: [
        shopCacheTag.stats(shopId),
        shopCacheTag.devices(shopId),
        shopCacheTag.sales(shopId),
        shopCacheTag.nasiyalar(shopId),
        shopCacheTag.nasiyaSchedules(shopId),
        shopCacheTag.returns(shopId),
        shopCacheTag.logs(shopId),
      ],
    },
  )()
}

async function getShopOperationalStatsFresh(role: StatsRole, shopId: string): Promise<ShopStatsResult> {
  const now = new Date()
  const { start: monthStart, end: monthEnd, monthKey } = tashkentMonthRangeFromKey(null, now)
  const { start: todayStart } = tashkentDayRange(now)
  const openScheduleStatus = ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] as const
  const [
    totalDevices,
    soldThisMonth,
    activeNasiyalar,
    overdueNasiyaCount,
    overdueSaleCount,
    returnsThisMonth,
    recentActivity,
    upcomingPayments,
  ] = await Promise.all([
    prisma.device.count({ where: { shopId, deletedAt: null, isImported: false } }),
    prisma.sale.count({ where: { shopId, deletedAt: null, createdAt: { gte: monthStart, lt: monthEnd } } }),
    prisma.nasiya.count({
      where: { shopId, deletedAt: null, resolutionState: 'ACTIVE', status: { in: ['ACTIVE', 'OVERDUE'] } },
    }),
    prisma.nasiyaSchedule.count({
      where: {
        shopId,
        status: { in: [...openScheduleStatus] },
        OR: [
          { delayedUntil: { lt: todayStart } },
          { delayedUntil: null, dueDate: { lt: todayStart } },
        ],
        nasiya: { deletedAt: null, returnedAt: null, status: { not: 'CANCELLED' }, resolutionState: 'ACTIVE' },
      },
    }),
    prisma.sale.count({
      where: {
        shopId,
        deletedAt: null,
        returnedAt: null,
        paidFully: false,
        dueDate: { lt: todayStart },
      },
    }),
    prisma.deviceReturn.count({ where: { shopId, createdAt: { gte: monthStart, lt: monthEnd } } }),
    prisma.log.findMany({
      where: { shopId, ...(role === 'SHOP_ADMIN' ? { actorType: 'SHOP_ADMIN' as const } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, action: true, createdAt: true, actorId: true },
    }),
    prisma.nasiyaSchedule.findMany({
      where: {
        shopId,
        status: { in: [...openScheduleStatus] },
        nasiya: { deletedAt: null, returnedAt: null, status: { not: 'CANCELLED' }, resolutionState: 'ACTIVE' },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        dueDate: true,
        delayedUntil: true,
        status: true,
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

  const computed = computeShopStatsFromRows({
    now,
    monthStart,
    monthEnd,
    usdUzsRate: null,
    totalDevices,
    cashSalesThisMonth: [],
    accrualAggregate: {
      saleCount: soldThisMonth,
      saleRevenueUzs: 0,
      saleDeviceCostUzs: 0,
      nasiyaRevenueUzs: 0,
      nasiyaInterestUzs: 0,
      nasiyaDeviceCostUzs: 0,
    },
    saleReceivedSum: 0,
    nasiyaSoldThisMonth: [],
    nasiyaReceivedSum: 0,
    activeNasiyalar,
    nasiyaSchedulesForStats: [],
    unpaidSales: [],
    obligationAggregate: {
      expectedUzs: 0,
      expectedUsd: 0,
      overdueUzs: 0,
      overdueUsd: 0,
      overdueCount: overdueNasiyaCount + overdueSaleCount,
    },
    inventoryPurchaseCostSum: 0,
    returnRefundSum: 0,
    returnsThisMonth,
    recentActivity: recentActivity.map((activity) => ({ ...activity, actorId: '' })),
    upcomingPayments: upcomingPayments.map((payment) => ({
      ...payment,
      expectedAmount: 0,
      paidAmount: 0,
      contractExpectedAmount: 0,
      contractPaidAmount: 0,
      contractRemainingAmount: 0,
    })),
  })

  return {
    ...computed,
    supplierPayablesOpenAllTimeUzs: 0,
    supplierPayablesOpenAllTimeUsd: 0,
    supplierPayablesOpenAllTimeCount: 0,
    supplierPayablesDueSelectedMonthUzs: 0,
    supplierPayablesDueSelectedMonthUsd: 0,
    supplierPayablesDueSelectedMonthCount: 0,
    supplierPayablesOverdueWithinSelectedMonthUzs: 0,
    supplierPayablesOverdueWithinSelectedMonthUsd: 0,
    supplierPayablesOverdueWithinSelectedMonthCount: 0,
    customerPayLaterOpenAllTimeUzs: 0,
    customerPayLaterOpenAllTimeUsd: 0,
    customerPayLaterOpenAllTimeCount: 0,
    customerPayLaterDueSelectedMonthUzs: 0,
    customerPayLaterDueSelectedMonthUsd: 0,
    customerPayLaterDueSelectedMonthCount: 0,
    customerPayLaterOverdueWithinSelectedMonthUzs: 0,
    customerPayLaterOverdueWithinSelectedMonthUsd: 0,
    customerPayLaterOverdueWithinSelectedMonthCount: 0,
    supplierPaymentsMadeSelectedMonthUzs: 0,
    supplierPaymentsMadeSelectedMonthUsd: 0,
    supplierPaymentsMadeSelectedMonthCount: 0,
    writeOffsThisMonthNativeUzs: 0,
    writeOffsThisMonthNativeUsd: 0,
    writeOffsThisMonthFrozenUzs: 0,
    writeOffCountThisMonth: 0,
    writeOffReopenCountThisMonth: 0,
    monthKey,
    filteredByAdmin: null,
    nonAttributableFields: ['totalDevices', 'activeNasiyalar', 'inventoryPurchaseCost', 'expectedThisMonth', 'overdueMoney', 'upcomingPayments', 'supplierPayablesOpenAllTime', 'supplierPayablesDueSelectedMonth', 'customerPayLaterOpenAllTime', 'customerPayLaterDueSelectedMonth'] as const,
  }
}

/** Remove every monetary value before an operational-only dashboard response leaves the server. */
export function redactFinancialShopStats(stats: ShopStatsResult): ShopStatsResult {
  return {
    ...stats,
    cashReceivedThisMonth: 0,
    expectedThisMonth: 0,
    expectedThisMonthUzs: 0,
    expectedThisMonthUsd: 0,
    overdueMoney: 0,
    overdueMoneyUzs: 0,
    overdueMoneyUsd: 0,
    inventoryPurchaseCost: 0,
    realProfitThisMonth: 0,
    actualProfitThisMonth: 0,
    expectedProfitThisMonth: 0,
    expectedProfitThisMonthUzs: 0,
    expectedProfitThisMonthUsd: 0,
    expectedReceivablesThisMonth: 0,
    expectedReceivablesThisMonthUzs: 0,
    expectedReceivablesThisMonthUsd: 0,
    accrualRevenueThisMonth: 0,
    accrualRevenueBeforeReturnsThisMonth: 0,
    accrualGrossProfitThisMonth: 0,
    accrualGrossProfitBeforeReturnsThisMonth: 0,
    nasiyaInterestThisMonth: 0,
    nasiyaInterestBeforeReturnsThisMonth: 0,
    interestReceivedThisMonth: 0,
    nasiyaInterestExpectedThisMonth: 0,
    nasiyaInterestExpectedThisMonthUzs: 0,
    nasiyaInterestExpectedThisMonthUsd: 0,
    expectedProfitWithInterestThisMonth: 0,
    grossCashInThisMonth: 0,
    cashCollectedThisMonth: 0,
    returnRefundsThisMonth: 0,
    returnRevenueReversalsThisMonth: 0,
    returnInterestReversalsThisMonth: 0,
    returnInventoryCostRecoveriesThisMonth: 0,
    returnRetainedValueThisMonth: 0,
    netCashFlowThisMonth: 0,
    netCashAfterReturnsThisMonth: 0,
    writeOffsThisMonthNativeUzs: 0,
    writeOffsThisMonthNativeUsd: 0,
    writeOffsThisMonthFrozenUzs: 0,
    supplierPayablesOpenAllTimeUzs: 0,
    supplierPayablesOpenAllTimeUsd: 0,
    supplierPayablesOpenAllTimeCount: 0,
    supplierPayablesDueSelectedMonthUzs: 0,
    supplierPayablesDueSelectedMonthUsd: 0,
    supplierPayablesDueSelectedMonthCount: 0,
    supplierPayablesOverdueWithinSelectedMonthUzs: 0,
    supplierPayablesOverdueWithinSelectedMonthUsd: 0,
    supplierPayablesOverdueWithinSelectedMonthCount: 0,
    customerPayLaterOpenAllTimeUzs: 0,
    customerPayLaterOpenAllTimeUsd: 0,
    customerPayLaterOpenAllTimeCount: 0,
    customerPayLaterDueSelectedMonthUzs: 0,
    customerPayLaterDueSelectedMonthUsd: 0,
    customerPayLaterDueSelectedMonthCount: 0,
    customerPayLaterOverdueWithinSelectedMonthUzs: 0,
    customerPayLaterOverdueWithinSelectedMonthUsd: 0,
    customerPayLaterOverdueWithinSelectedMonthCount: 0,
    supplierPaymentsMadeSelectedMonthUzs: 0,
    supplierPaymentsMadeSelectedMonthUsd: 0,
    supplierPaymentsMadeSelectedMonthCount: 0,
    upcomingPayments: stats.upcomingPayments.map((payment) => ({
      ...payment,
      expectedAmount: 0,
      paidAmount: 0,
      contractExpectedAmount: 0,
      contractPaidAmount: 0,
      contractRemainingAmount: 0,
    })),
  }
}

async function getShopStatsFresh(role: StatsRole, shopId: string, monthKey: string | null, adminId: string | null) {
  const now = new Date()
  const { start: monthStart, end: monthEnd } = tashkentMonthRangeFromKey(monthKey, now)
  const { start: todayStart } = tashkentDayRange(now)
  const attributedTo = adminId ? { createdBy: adminId } : {}
  const [
    storedFxQuote,
    totalDevices,
    soldThisMonth,
    monthlyAccountingAggregate,
    saleReceivedAgg,
    nasiyaReceivedAgg,
    activeNasiyalar,
    obligationAggregate,
    inventoryAgg,
    returnAccountingAgg,
    returnProfitReversalAgg,
    returnsThisMonth,
    recentActivity,
    upcomingScheduleIds,
    writeOffAggregate,
    debtStatsAggregate,
  ] = await Promise.all([
    // Presentation uses only a governed stored quote. Run it beside the
    // bounded SQL batch instead of placing a possible CBU wait in front.
    getStoredUsdUzsRateSnapshot(),
    prisma.device.count({
      // Imported devices exist only to carry pre-Oryx debt — they were never
      // stocked through Oryx, so they don't count as the shop's devices.
      where: { shopId, deletedAt: null, isImported: false },
    }),

    prisma.sale.count({
      where: {
        shopId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...(adminId ? { createdBy: adminId } : {}),
      },
    }),

    getShopMonthlyAccountingAggregate({ shopId, monthStart, monthEnd, adminId }),

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

    prisma.returnProfitReversal.aggregate({
      _sum: {
        recognizedMarginAmountUzs: true,
        recognizedInterestAmountUzs: true,
      },
      where: {
        shopId,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...(adminId ? { deviceReturn: { createdBy: adminId } } : {}),
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

    getShopDebtStatsAggregate({ shopId, monthStart, monthEnd, todayStart, adminId }),
  ])
  const usdUzsRate = storedFxQuote?.rate ?? null

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
          contractRemainingAmount: true,
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
    accrualAggregate: {
      saleCount: soldThisMonth,
      saleRevenueUzs: 0,
      saleDeviceCostUzs: 0,
      nasiyaRevenueUzs: 0,
      nasiyaInterestUzs: 0,
      nasiyaDeviceCostUzs: 0,
    },
    monthlyAccountingAggregate,
    saleReceivedSum: saleReceivedAgg._sum.amount,
    nasiyaSoldThisMonth: [],
    nasiyaReceivedSum: nasiyaReceivedAgg._sum.amount,
    activeNasiyalar: activeNasiyalar + obligationAggregate.falseCompletedCount,
    nasiyaSchedulesForStats: [],
    unpaidSales: [],
    obligationAggregate,
    inventoryPurchaseCostSum: inventoryAgg._sum.purchasePrice,
    returnRefundSum: returnAccountingAgg._sum.refundAmount,
    returnRevenueReversalSum: returnProfitReversalAgg._sum.recognizedMarginAmountUzs,
    returnInterestReversalSum: returnProfitReversalAgg._sum.recognizedInterestAmountUzs,
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
    ...debtStatsAggregate,
    writeOffsThisMonthNativeUzs: writeOffAggregate.nativeUzs,
    writeOffsThisMonthNativeUsd: writeOffAggregate.nativeUsd,
    writeOffsThisMonthFrozenUzs: writeOffAggregate.frozenUzs,
    writeOffCountThisMonth: writeOffAggregate.writeOffCount,
    writeOffReopenCountThisMonth: writeOffAggregate.reopenCount,
    monthKey: tashkentMonthRangeFromKey(monthKey, now).monthKey,
    filteredByAdmin: adminId,
    nonAttributableFields: ['totalDevices', 'activeNasiyalar', 'inventoryPurchaseCost', 'expectedThisMonth', 'overdueMoney', 'upcomingPayments', 'supplierPayablesOpenAllTime', 'supplierPayablesDueSelectedMonth', 'customerPayLaterOpenAllTime', 'customerPayLaterDueSelectedMonth'] as const,
  }
}
