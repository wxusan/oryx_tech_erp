/**
 * Pure formula layer for the dashboard/report stats — see
 * docs/audits/dashboard-stat-formulas.md for the business definition of
 * every field below. Deliberately has NO `import 'server-only'` and no
 * Prisma dependency (unlike `src/lib/server/shop-stats.ts`, which fetches
 * the raw rows and calls `computeShopStatsFromRows` here) so the actual
 * arithmetic can be unit-tested directly with synthetic rows, instead of
 * only through source-string guard tests — mirrors the same pure-helper
 * pattern already used by `src/lib/nasiya-contract.ts`.
 */

import { contractScheduleOutstanding, convertContractAmountToUzs } from '@/lib/nasiya-contract'
import { isBeforeTashkentToday } from '@/lib/timezone'

export interface ShopStatsRows {
  now: Date
  monthStart: Date
  monthEnd: Date
  usdUzsRate: number | null
  totalDevices: number
  /** Every Sale created this month — ACCRUAL basis, regardless of payment status. */
  cashSalesThisMonth: { salePrice: unknown; device: { purchasePrice: unknown } }[]
  /**
   * Set-based equivalent used by production. Unit tests may keep supplying
   * rows; production never needs to hydrate every contract merely to sum it.
   */
  accrualAggregate?: {
    saleCount: number
    saleRevenueUzs: unknown
    saleDeviceCostUzs: unknown
    nasiyaRevenueUzs: unknown
    nasiyaInterestUzs: unknown
    nasiyaDeviceCostUzs: unknown
  }
  /** Production payment-basis recognition aggregate. */
  monthlyAccountingAggregate?: {
    saleMarginReceivedUzs: unknown
    nasiyaMarginReceivedUzs: unknown
    nasiyaInterestReceivedUzs: unknown
    returnProfitAdjustmentUzs: unknown
    actualProfitUzs: unknown
    expectedProfitUzs: unknown
    expectedProfitUsd: unknown
    expectedInterestUzs: unknown
    expectedInterestUsd: unknown
    reconstructionGapCount: number
  }
  /** Sum of SalePayment.amount (legacy UZS) with paidAt this month — CASH basis. */
  saleReceivedSum: unknown
  /** Every Nasiya created this month (excluding imports) — ACCRUAL basis. */
  nasiyaSoldThisMonth: { totalAmount: unknown; interestAmount: unknown; device: { purchasePrice: unknown } }[]
  /** Sum of NasiyaPayment.amount (legacy UZS) with paidAt this month — CASH basis. */
  nasiyaReceivedSum: unknown
  activeNasiyalar: number
  nasiyaSchedulesForStats: {
    dueDate: Date
    delayedUntil: Date | null
    expectedAmount: unknown
    paidAmount: unknown
    contractExpectedAmount: unknown
    contractPaidAmount: unknown
    nasiya: { contractCurrency: 'UZS' | 'USD' }
  }[]
  unpaidSales: { dueDate: Date | null; remainingAmount: unknown; contractCurrency: 'UZS' | 'USD'; contractRemainingAmount: unknown }[]
  /** Native-currency partitions calculated by PostgreSQL over open debt. */
  obligationAggregate?: {
    expectedUzs: unknown
    expectedUsd: unknown
    overdueUzs: unknown
    overdueUsd: unknown
    overdueCount: number
  }
  inventoryPurchaseCostSum: unknown
  returnRefundSum: unknown
  returnRevenueReversalSum?: unknown
  returnInterestReversalSum?: unknown
  returnInventoryCostRecoverySum?: unknown
  returnRetainedValueSum?: unknown
  returnsThisMonth: number
  recentActivity: { id: string; action: string; createdAt: Date; actorId: string }[]
  upcomingPayments: {
    dueDate: Date
    delayedUntil: Date | null
    expectedAmount: unknown
    paidAmount: unknown
    status: string
    contractExpectedAmount: unknown
    contractPaidAmount: unknown
    nasiya: { id: string; contractCurrency: 'UZS' | 'USD'; customer: { name: string }; device: { model: string } }
  }[]
}

export function computeShopStatsFromRows(rows: ShopStatsRows) {
  const {
    now,
    monthStart,
    monthEnd,
    usdUzsRate,
    totalDevices,
    cashSalesThisMonth,
    accrualAggregate,
    monthlyAccountingAggregate,
    saleReceivedSum,
    nasiyaSoldThisMonth,
    nasiyaReceivedSum,
    activeNasiyalar,
    nasiyaSchedulesForStats,
    unpaidSales,
    obligationAggregate,
    inventoryPurchaseCostSum,
    returnRefundSum,
    returnRevenueReversalSum,
    returnInterestReversalSum,
    returnInventoryCostRecoverySum,
    returnRetainedValueSum,
    returnsThisMonth,
    recentActivity,
    upcomingPayments,
  } = rows

  // CASH basis: what actually changed hands this month (SalePayment/NasiyaPayment
  // rows with paidAt in this month) — see docs/audits/dashboard-stat-formulas.md
  // "Umumiy aylanma" / "Sof tushum". A sale created this month but not yet paid
  // contributes 0 here until a payment is actually recorded, by design.
  const cashReceived = Number(saleReceivedSum ?? 0)
  const nasiyaReceived = Number(nasiyaReceivedSum ?? 0)
  const cashReceivedThisMonth = cashReceived + nasiyaReceived

  // Legacy row-derived values remain only as a compatibility fallback for old
  // pure callers. Production supplies monthlyAccountingAggregate below, which
  // replaces creation-time accrual with payment-date recognition.
  const soldDeviceCost = accrualAggregate
    ? Number(accrualAggregate.saleDeviceCostUzs)
    : cashSalesThisMonth.reduce((sum, sale) => sum + Number(sale.device.purchasePrice), 0)
  const nasiyaDeviceCost = accrualAggregate
    ? Number(accrualAggregate.nasiyaDeviceCostUzs)
    : nasiyaSoldThisMonth.reduce((sum, nasiya) => sum + Number(nasiya.device.purchasePrice), 0)
  const accrualRevenueThisMonth = accrualAggregate
    ? Number(accrualAggregate.saleRevenueUzs) + Number(accrualAggregate.nasiyaRevenueUzs)
    : cashSalesThisMonth.reduce((sum, sale) => sum + Number(sale.salePrice), 0) +
      nasiyaSoldThisMonth.reduce((sum, nasiya) => sum + Number(nasiya.totalAmount), 0)
  const nasiyaInterestThisMonth = accrualAggregate
    ? Number(accrualAggregate.nasiyaInterestUzs)
    : nasiyaSoldThisMonth.reduce((sum, nasiya) => sum + Number(nasiya.interestAmount), 0)
  const accrualGrossProfitBeforeReturnsThisMonth = accrualRevenueThisMonth - soldDeviceCost - nasiyaDeviceCost
  const cashBasisProfitThisMonth = cashReceivedThisMonth - soldDeviceCost - nasiyaDeviceCost

  // Both Nasiya schedules and Sale must read their own contract-currency
  // balance, converted to UZS via TODAY's rate exactly once (see
  // contractScheduleOutstanding / convertContractAmountToUzs above) — never the
  // legacy UZS remainingAmount, which for a USD-native sale is the SUM of
  // several payments each converted at whatever rate was live on that
  // payment's own day, and can drift internally from the true contract-
  // currency balance once the rate has moved between payments.
  const scheduleOutstandingNative = (schedule: {
    contractExpectedAmount: unknown
    contractPaidAmount: unknown
    nasiya: { contractCurrency: 'UZS' | 'USD' }
  }) => contractScheduleOutstanding(
    Number(schedule.contractExpectedAmount),
    Number(schedule.contractPaidAmount),
    schedule.nasiya.contractCurrency,
  )
  type MoneyPartition = { uzs: number; usd: number }
  const addNative = (partition: MoneyPartition, amount: number, currency: 'UZS' | 'USD') => {
    partition[currency === 'USD' ? 'usd' : 'uzs'] += amount
  }
  const partitionTotalUzs = (partition: MoneyPartition) =>
    partition.uzs + (convertContractAmountToUzs(partition.usd, 'USD', usdUzsRate) ?? 0)
  const effectiveDue = (row: { delayedUntil: Date | null; dueDate: Date }) => row.delayedUntil ?? row.dueDate
  const expectedPartition: MoneyPartition = obligationAggregate
    ? { uzs: Number(obligationAggregate.expectedUzs), usd: Number(obligationAggregate.expectedUsd) }
    : { uzs: 0, usd: 0 }
  if (!obligationAggregate) {
    for (const schedule of nasiyaSchedulesForStats) {
      const due = effectiveDue(schedule)
      if (due < monthStart || due >= monthEnd) continue
      addNative(expectedPartition, scheduleOutstandingNative(schedule), schedule.nasiya.contractCurrency)
    }
    for (const sale of unpaidSales) {
      if (!sale.dueDate || sale.dueDate < monthStart || sale.dueDate >= monthEnd) continue
      addNative(expectedPartition, Number(sale.contractRemainingAmount), sale.contractCurrency)
    }
  }
  const expectedThisMonth = partitionTotalUzs(expectedPartition)
  const expectedProfitPartition: MoneyPartition = monthlyAccountingAggregate
    ? {
        uzs: Number(monthlyAccountingAggregate.expectedProfitUzs),
        usd: Number(monthlyAccountingAggregate.expectedProfitUsd),
      }
    : expectedPartition
  const expectedProfitThisMonth = partitionTotalUzs(expectedProfitPartition)
  const expectedInterestPartition: MoneyPartition = monthlyAccountingAggregate
    ? {
        uzs: Number(monthlyAccountingAggregate.expectedInterestUzs),
        usd: Number(monthlyAccountingAggregate.expectedInterestUsd),
      }
    : { uzs: 0, usd: 0 }
  const nasiyaInterestExpectedThisMonth = partitionTotalUzs(expectedInterestPartition)
  const overdueSchedules = obligationAggregate
    ? []
    : nasiyaSchedulesForStats.filter((schedule) => {
        if (scheduleOutstandingNative(schedule) <= 0) return false
        return isBeforeTashkentToday(effectiveDue(schedule), now)
      })
  const overdueSales = obligationAggregate
    ? []
    : unpaidSales.filter((sale) => sale.dueDate && isBeforeTashkentToday(sale.dueDate, now))
  const overduePartition: MoneyPartition = obligationAggregate
    ? { uzs: Number(obligationAggregate.overdueUzs), usd: Number(obligationAggregate.overdueUsd) }
    : { uzs: 0, usd: 0 }
  if (!obligationAggregate) {
    for (const schedule of overdueSchedules) {
      addNative(overduePartition, scheduleOutstandingNative(schedule), schedule.nasiya.contractCurrency)
    }
    for (const sale of overdueSales) {
      addNative(overduePartition, Number(sale.contractRemainingAmount), sale.contractCurrency)
    }
  }
  const overdueMoney = partitionTotalUzs(overduePartition)
  const inventoryPurchaseCost = Number(inventoryPurchaseCostSum ?? 0)
  const returnRefundsThisMonth = Number(returnRefundSum ?? 0)
  const returnRevenueReversalsThisMonth = Number(returnRevenueReversalSum ?? 0)
  const returnInterestReversalsThisMonth = Number(returnInterestReversalSum ?? 0)
  const returnInventoryCostRecoveriesThisMonth = Number(returnInventoryCostRecoverySum ?? 0)
  const returnRetainedValueThisMonth = Number(returnRetainedValueSum ?? 0)
  const netAccrualRevenueThisMonth =
    accrualRevenueThisMonth - returnRevenueReversalsThisMonth + returnRetainedValueThisMonth
  const accrualGrossProfitThisMonth =
    accrualGrossProfitBeforeReturnsThisMonth -
    returnRevenueReversalsThisMonth +
    returnInventoryCostRecoveriesThisMonth +
    returnRetainedValueThisMonth
  const netNasiyaInterestThisMonth = nasiyaInterestThisMonth - returnInterestReversalsThisMonth
  const actualProfitThisMonth = monthlyAccountingAggregate
    ? Number(monthlyAccountingAggregate.actualProfitUzs)
    : cashBasisProfitThisMonth
  const interestReceivedThisMonth = monthlyAccountingAggregate
    ? Number(monthlyAccountingAggregate.nasiyaInterestReceivedUzs)
    : netNasiyaInterestThisMonth
  const reportedRevenueThisMonth = monthlyAccountingAggregate ? cashReceivedThisMonth : netAccrualRevenueThisMonth
  const reportedRevenueBeforeReturnsThisMonth = monthlyAccountingAggregate ? cashReceivedThisMonth : accrualRevenueThisMonth
  const reportedGrossProfitThisMonth = monthlyAccountingAggregate ? actualProfitThisMonth : accrualGrossProfitThisMonth
  const reportedGrossProfitBeforeReturnsThisMonth = monthlyAccountingAggregate
    ? actualProfitThisMonth - Number(monthlyAccountingAggregate.returnProfitAdjustmentUzs)
    : accrualGrossProfitBeforeReturnsThisMonth
  const overdueCount = obligationAggregate?.overdueCount ?? overdueSchedules.length + overdueSales.length

  return {
    totalDevices,
    cashReceivedThisMonth,
    soldThisMonth: accrualAggregate?.saleCount ?? cashSalesThisMonth.length,
    activeNasiyalar,
    // Historical field names now point at expected PROFIT, not the full
    // receivable. Gross due amounts remain available under explicit names.
    expectedThisMonth: expectedProfitThisMonth,
    expectedThisMonthUzs: expectedProfitPartition.uzs,
    expectedThisMonthUsd: expectedProfitPartition.usd,
    expectedThisMonthComplete: expectedProfitPartition.usd === 0 || Boolean(usdUzsRate),
    expectedProfitThisMonth,
    expectedProfitThisMonthUzs: expectedProfitPartition.uzs,
    expectedProfitThisMonthUsd: expectedProfitPartition.usd,
    expectedProfitThisMonthComplete: expectedProfitPartition.usd === 0 || Boolean(usdUzsRate),
    expectedReceivablesThisMonth: expectedThisMonth,
    expectedReceivablesThisMonthUzs: expectedPartition.uzs,
    expectedReceivablesThisMonthUsd: expectedPartition.usd,
    expectedReceivablesThisMonthComplete: expectedPartition.usd === 0 || Boolean(usdUzsRate),
    overdueMoney,
    overdueMoneyUzs: overduePartition.uzs,
    overdueMoneyUsd: overduePartition.usd,
    overdueMoneyComplete: overduePartition.usd === 0 || Boolean(usdUzsRate),
    inventoryPurchaseCost,
    actualProfitThisMonth,
    realProfitThisMonth: actualProfitThisMonth,
    accrualRevenueThisMonth: reportedRevenueThisMonth,
    accrualRevenueBeforeReturnsThisMonth: reportedRevenueBeforeReturnsThisMonth,
    accrualGrossProfitThisMonth: reportedGrossProfitThisMonth,
    accrualGrossProfitBeforeReturnsThisMonth: reportedGrossProfitBeforeReturnsThisMonth,
    interestReceivedThisMonth,
    nasiyaInterestThisMonth: interestReceivedThisMonth,
    nasiyaInterestBeforeReturnsThisMonth: interestReceivedThisMonth,
    nasiyaInterestExpectedThisMonth,
    nasiyaInterestExpectedThisMonthUzs: expectedInterestPartition.uzs,
    nasiyaInterestExpectedThisMonthUsd: expectedInterestPartition.usd,
    nasiyaInterestExpectedThisMonthComplete: expectedInterestPartition.usd === 0 || Boolean(usdUzsRate),
    expectedProfitWithInterestThisMonth: expectedProfitThisMonth,
    accountingReconstructionGapCount: monthlyAccountingAggregate?.reconstructionGapCount ?? 0,
    grossCashInThisMonth: cashReceivedThisMonth,
    cashCollectedThisMonth: cashReceivedThisMonth,
    returnRefundsThisMonth,
    returnRevenueReversalsThisMonth,
    returnInterestReversalsThisMonth,
    returnInventoryCostRecoveriesThisMonth,
    returnRetainedValueThisMonth,
    returnsThisMonth,
    netCashFlowThisMonth: cashReceivedThisMonth - returnRefundsThisMonth,
    netCashAfterReturnsThisMonth: cashReceivedThisMonth - returnRefundsThisMonth,
    overdueCount,
    recentActivity,
    upcomingPayments: upcomingPayments
      .slice()
      .sort((left, right) => effectiveDue(left).getTime() - effectiveDue(right).getTime())
      .slice(0, 5)
      .map((payment) => {
        // Both sides convert from the nasiya's own contract currency via
        // today's rate, so the client's expectedAmount - paidAmount still
        // gives the correct current outstanding balance — see
        // contractScheduleOutstanding above.
        const toUzs = (amount: unknown) =>
          payment.nasiya.contractCurrency === 'USD'
            ? convertContractAmountToUzs(Number(amount), 'USD', usdUzsRate) ?? 0
            : Number(amount)
        return {
          ...payment,
          // Prisma Decimal instances cannot cross a Server Component →
          // Client Component boundary. Keep the native contract amounts as
          // plain numbers and expose the converted UZS helpers separately.
          contractExpectedAmount: Number(payment.contractExpectedAmount),
          contractPaidAmount: Number(payment.contractPaidAmount),
          expectedAmount: toUzs(payment.contractExpectedAmount),
          paidAmount: toUzs(payment.contractPaidAmount),
        }
      }),
  }
}
