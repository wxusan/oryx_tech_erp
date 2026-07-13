import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ReportRange } from '@/lib/report-range'

interface DataMonthRow {
  month_key: string
}

interface MonthlyReportRow {
  month_key: string
  cash_uzs: unknown
  cash_usd: unknown
  cash_incomplete_count: number
  accrual_uzs: unknown
  accrual_usd: unknown
  interest_uzs: unknown
  interest_usd: unknown
  expected_uzs: unknown
  expected_usd: unknown
  refunds_uzs: unknown
  refunds_usd: unknown
  write_off_uzs: unknown
  write_off_usd: unknown
  write_off_frozen_uzs: unknown
  gross_profit_uzs: unknown
  interest_profit_uzs: unknown
  return_count: number
  write_off_count: number
  reopen_count: number
}

export interface ShopMonthlyReportPoint {
  monthKey: string
  cashCollected: { uzs: number; usd: number; complete: boolean }
  accrualRevenue: { uzs: number; usd: number }
  nasiyaInterest: { uzs: number; usd: number }
  expectedReceivables: { uzs: number; usd: number }
  refunds: { uzs: number; usd: number }
  writeOffs: { uzs: number; usd: number; frozenUzs: number }
  grossProfitUzs: number
  interestProfitUzs: number
  returnCount: number
  writeOffCount: number
  reopenCount: number
}

export interface ShopRangeReport {
  range: Pick<ReportRange, 'preset' | 'startMonth' | 'endMonth' | 'monthKeys'>
  filteredByAdmin: string | null
  nonAttributableFields: readonly ['expectedReceivables']
  months: ShopMonthlyReportPoint[]
  totals: Omit<ShopMonthlyReportPoint, 'monthKey'>
}

const number = (value: unknown) => Number(value ?? 0)

/**
 * Months offered by single-month mode come from real reporting facts only.
 * A month is not invented merely because it is close to the current month.
 */
export async function getShopReportDataMonths(shopId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<DataMonthRow[]>(Prisma.sql`
    WITH facts AS (
      SELECT s."createdAt" AS occurred_at
      FROM "Sale" s
      WHERE s."shopId" = ${shopId} AND s."deletedAt" IS NULL
      UNION ALL
      SELECT s."dueDate"
      FROM "Sale" s
      WHERE s."shopId" = ${shopId}
        AND s."deletedAt" IS NULL
        AND s."returnedAt" IS NULL
        AND s."paidFully" = false
        AND s."contractRemainingAmount" > 0
        AND s."dueDate" IS NOT NULL
      UNION ALL
      SELECT n."createdAt"
      FROM "Nasiya" n
      WHERE n."shopId" = ${shopId} AND n."deletedAt" IS NULL AND n."isImported" = false
      UNION ALL
      SELECT coalesce(s."delayedUntil", s."dueDate")
      FROM "NasiyaSchedule" s
      JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
      WHERE s."shopId" = ${shopId}
        AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
        AND n."deletedAt" IS NULL
        AND n."returnedAt" IS NULL
        AND n."status" <> 'CANCELLED'
        AND n."resolutionState" <> 'WRITTEN_OFF'
        AND (
          (n."contractCurrency" = 'USD' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01)
          OR (n."contractCurrency" = 'UZS' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1)
        )
      UNION ALL
      SELECT p."paidAt"
      FROM "SalePayment" p
      WHERE p."shopId" = ${shopId} AND p."deletedAt" IS NULL
      UNION ALL
      SELECT p."paidAt"
      FROM "NasiyaPayment" p
      WHERE p."shopId" = ${shopId} AND p."deletedAt" IS NULL
      UNION ALL
      SELECT r."createdAt"
      FROM "DeviceReturn" r
      WHERE r."shopId" = ${shopId}
      UNION ALL
      SELECT e."createdAt"
      FROM "NasiyaResolutionEvent" e
      WHERE e."shopId" = ${shopId}
    )
    SELECT DISTINCT to_char(occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key
    FROM facts
    ORDER BY month_key DESC
  `)
  return rows.map((row) => row.month_key)
}

/**
 * One bounded PostgreSQL statement produces the complete monthly trend. It
 * never hydrates contracts/payments into JavaScript and it never adds USD to
 * UZS. `amount`/legacy fields are used only as explicit UZS compatibility
 * fallbacks; an unconvertible historic USD receipt is surfaced via
 * `cashCollected.complete=false` instead of being guessed.
 */
export async function getShopRangeReport(input: {
  shopId: string
  range: ReportRange
  adminId: string | null
}): Promise<ShopRangeReport> {
  const saleActor = input.adminId
    ? Prisma.sql`AND s."createdBy" = ${input.adminId}`
    : Prisma.empty
  const nasiyaActor = input.adminId
    ? Prisma.sql`AND n."createdBy" = ${input.adminId}`
    : Prisma.empty
  const salePaymentActor = input.adminId
    ? Prisma.sql`AND p."createdBy" = ${input.adminId}`
    : Prisma.empty
  const nasiyaPaymentActor = input.adminId
    ? Prisma.sql`AND p."createdBy" = ${input.adminId}`
    : Prisma.empty
  const returnActor = input.adminId
    ? Prisma.sql`AND r."createdBy" = ${input.adminId}`
    : Prisma.empty
  const resolutionActor = input.adminId
    ? Prisma.sql`AND e."actorId" = ${input.adminId}`
    : Prisma.empty

  const rows = await prisma.$queryRaw<MonthlyReportRow[]>(Prisma.sql`
    WITH months AS (
      SELECT
        month_key,
        ordinal::integer AS ordinal
      FROM unnest(ARRAY[${Prisma.join(input.range.monthKeys.map((monthKey) => Prisma.sql`${monthKey}`))}]::text[])
        WITH ORDINALITY AS selected_months(month_key, ordinal)
    ), sale_payment_facts AS (
      SELECT
        to_char(p."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        s."contractCurrency" AS currency,
        CASE
          WHEN p."appliedAmountInContractCurrency" IS NOT NULL THEN p."appliedAmountInContractCurrency"
          WHEN s."contractCurrency" = 'UZS' THEN p."amount"
          WHEN p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL THEN p."paymentInputAmount"
          WHEN p."paymentExchangeRate" > 0 THEN p."amount" / p."paymentExchangeRate"
          ELSE 0
        END::numeric AS native_amount,
        CASE
          WHEN s."contractCurrency" = 'USD'
            AND p."appliedAmountInContractCurrency" IS NULL
            AND (p."paymentInputCurrency" IS DISTINCT FROM 'USD' OR p."paymentInputAmount" IS NULL)
            AND coalesce(p."paymentExchangeRate", 0) <= 0
          THEN 1 ELSE 0
        END AS incomplete
      FROM "SalePayment" p
      JOIN "Sale" s ON s."id" = p."saleId" AND s."shopId" = p."shopId"
      WHERE p."shopId" = ${input.shopId}
        AND p."deletedAt" IS NULL
        AND p."paidAt" >= ${input.range.start}
        AND p."paidAt" < ${input.range.end}
        ${salePaymentActor}
    ), nasiya_payment_facts AS (
      SELECT
        to_char(p."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        n."contractCurrency" AS currency,
        CASE
          WHEN p."appliedAmountInContractCurrency" IS NOT NULL THEN p."appliedAmountInContractCurrency"
          WHEN n."contractCurrency" = 'UZS' THEN p."amount"
          WHEN p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL THEN p."paymentInputAmount"
          WHEN p."paymentExchangeRate" > 0 THEN p."amount" / p."paymentExchangeRate"
          ELSE 0
        END::numeric AS native_amount,
        CASE
          WHEN n."contractCurrency" = 'USD'
            AND p."appliedAmountInContractCurrency" IS NULL
            AND (p."paymentInputCurrency" IS DISTINCT FROM 'USD' OR p."paymentInputAmount" IS NULL)
            AND coalesce(p."paymentExchangeRate", 0) <= 0
          THEN 1 ELSE 0
        END AS incomplete
      FROM "NasiyaPayment" p
      JOIN "Nasiya" n ON n."id" = p."nasiyaId" AND n."shopId" = p."shopId"
      WHERE p."shopId" = ${input.shopId}
        AND p."deletedAt" IS NULL
        AND p."paidAt" >= ${input.range.start}
        AND p."paidAt" < ${input.range.end}
        ${nasiyaPaymentActor}
    ), payment_facts AS (
      SELECT * FROM sale_payment_facts
      UNION ALL
      SELECT * FROM nasiya_payment_facts
    ), payment_months AS (
      SELECT
        month_key,
        coalesce(sum(native_amount) FILTER (WHERE currency = 'UZS'), 0)::numeric AS cash_uzs,
        coalesce(sum(native_amount) FILTER (WHERE currency = 'USD'), 0)::numeric AS cash_usd,
        coalesce(sum(incomplete), 0)::integer AS cash_incomplete_count
      FROM payment_facts
      GROUP BY month_key
    ), sale_accrual AS (
      SELECT
        to_char(s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        s."contractCurrency" AS currency,
        CASE
          WHEN s."contractSalePrice" > 0 THEN s."contractSalePrice"
          WHEN s."contractCurrency" = 'UZS' THEN s."salePrice"
          WHEN s."contractExchangeRateAtCreation" > 0 THEN s."salePrice" / s."contractExchangeRateAtCreation"
          ELSE 0
        END::numeric AS revenue_native,
        0::numeric AS interest_native,
        0::numeric AS interest_profit_uzs,
        (s."salePrice" - d."purchasePrice")::numeric AS gross_profit_uzs
      FROM "Sale" s
      JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND s."deletedAt" IS NULL
        AND s."createdAt" >= ${input.range.start}
        AND s."createdAt" < ${input.range.end}
        ${saleActor}
    ), nasiya_accrual AS (
      SELECT
        to_char(n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        n."contractCurrency" AS currency,
        CASE
          WHEN n."contractTotalAmount" > 0 THEN n."contractTotalAmount"
          WHEN n."contractCurrency" = 'UZS' THEN n."totalAmount"
          WHEN n."contractExchangeRateAtCreation" > 0 THEN n."totalAmount" / n."contractExchangeRateAtCreation"
          ELSE 0
        END::numeric AS revenue_native,
        CASE
          WHEN n."contractInterestAmount" > 0 THEN n."contractInterestAmount"
          WHEN n."contractCurrency" = 'UZS' THEN n."interestAmount"
          WHEN n."contractExchangeRateAtCreation" > 0 THEN n."interestAmount" / n."contractExchangeRateAtCreation"
          ELSE 0
        END::numeric AS interest_native,
        n."interestAmount"::numeric AS interest_profit_uzs,
        (n."totalAmount" - d."purchasePrice")::numeric AS gross_profit_uzs
      FROM "Nasiya" n
      JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
      WHERE n."shopId" = ${input.shopId}
        AND n."deletedAt" IS NULL
        AND n."isImported" = false
        AND n."createdAt" >= ${input.range.start}
        AND n."createdAt" < ${input.range.end}
        ${nasiyaActor}
    ), accrual_facts AS (
      SELECT * FROM sale_accrual
      UNION ALL
      SELECT * FROM nasiya_accrual
    ), accrual_months AS (
      SELECT
        month_key,
        coalesce(sum(revenue_native) FILTER (WHERE currency = 'UZS'), 0)::numeric AS accrual_uzs,
        coalesce(sum(revenue_native) FILTER (WHERE currency = 'USD'), 0)::numeric AS accrual_usd,
        coalesce(sum(interest_native) FILTER (WHERE currency = 'UZS'), 0)::numeric AS interest_uzs,
        coalesce(sum(interest_native) FILTER (WHERE currency = 'USD'), 0)::numeric AS interest_usd,
        coalesce(sum(interest_profit_uzs), 0)::numeric AS interest_profit_uzs,
        coalesce(sum(gross_profit_uzs), 0)::numeric AS gross_profit_uzs
      FROM accrual_facts
      GROUP BY month_key
    ), obligation_facts AS (
      SELECT
        to_char(coalesce(s."delayedUntil", s."dueDate") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        n."contractCurrency" AS currency,
        greatest(s."contractExpectedAmount" - s."contractPaidAmount", 0)::numeric AS outstanding
      FROM "NasiyaSchedule" s
      JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND coalesce(s."delayedUntil", s."dueDate") >= ${input.range.start}
        AND coalesce(s."delayedUntil", s."dueDate") < ${input.range.end}
        AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
        AND n."deletedAt" IS NULL
        AND n."returnedAt" IS NULL
        AND n."status" <> 'CANCELLED'
        AND n."resolutionState" <> 'WRITTEN_OFF'
        AND (
          (n."contractCurrency" = 'USD' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01)
          OR (n."contractCurrency" = 'UZS' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1)
        )
      UNION ALL
      SELECT
        to_char(s."dueDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'),
        s."contractCurrency",
        s."contractRemainingAmount"::numeric
      FROM "Sale" s
      WHERE s."shopId" = ${input.shopId}
        AND s."deletedAt" IS NULL
        AND s."returnedAt" IS NULL
        AND s."paidFully" = false
        AND s."contractRemainingAmount" > 0
        AND s."dueDate" >= ${input.range.start}
        AND s."dueDate" < ${input.range.end}
    ), obligation_months AS (
      SELECT
        month_key,
        coalesce(sum(outstanding) FILTER (WHERE currency = 'UZS'), 0)::numeric AS expected_uzs,
        coalesce(sum(outstanding) FILTER (WHERE currency = 'USD'), 0)::numeric AS expected_usd
      FROM obligation_facts
      GROUP BY month_key
    ), return_months AS (
      SELECT
        to_char(r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        coalesce(sum(CASE
          WHEN r."contractCurrency" = 'UZS' THEN
            CASE WHEN r."contractRefundAmount" > 0 THEN r."contractRefundAmount" ELSE r."refundAmount" END
          ELSE 0
        END), 0)::numeric AS refunds_uzs,
        coalesce(sum(CASE
          WHEN r."contractCurrency" = 'USD' THEN r."contractRefundAmount"
          ELSE 0
        END), 0)::numeric AS refunds_usd,
        coalesce(sum(-r."revenueReversalAmountUzs" + r."inventoryCostRecoveryUzs" + r."retainedValueAmountUzs"), 0)::numeric AS profit_adjustment_uzs,
        coalesce(sum(r."interestReversalAmountUzs"), 0)::numeric AS interest_reversal_uzs,
        count(*)::integer AS return_count
      FROM "DeviceReturn" r
      WHERE r."shopId" = ${input.shopId}
        AND r."createdAt" >= ${input.range.start}
        AND r."createdAt" < ${input.range.end}
        ${returnActor}
      GROUP BY month_key
    ), resolution_months AS (
      SELECT
        to_char(e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS month_key,
        coalesce(sum(CASE
          WHEN e."contractCurrency" = 'UZS' AND e."eventType" = 'WRITE_OFF' THEN e."nativeRemainingAmount"
          WHEN e."contractCurrency" = 'UZS' AND e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."nativeRemainingAmount"
          ELSE 0
        END), 0)::numeric AS write_off_uzs,
        coalesce(sum(CASE
          WHEN e."contractCurrency" = 'USD' AND e."eventType" = 'WRITE_OFF' THEN e."nativeRemainingAmount"
          WHEN e."contractCurrency" = 'USD' AND e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."nativeRemainingAmount"
          ELSE 0
        END), 0)::numeric AS write_off_usd,
        coalesce(sum(CASE
          WHEN e."eventType" = 'WRITE_OFF' THEN e."frozenUzsAmount"
          WHEN e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."frozenUzsAmount"
          ELSE 0
        END), 0)::numeric AS write_off_frozen_uzs,
        count(*) FILTER (WHERE e."eventType" = 'WRITE_OFF')::integer AS write_off_count,
        count(*) FILTER (WHERE e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF')::integer AS reopen_count
      FROM "NasiyaResolutionEvent" e
      WHERE e."shopId" = ${input.shopId}
        AND e."createdAt" >= ${input.range.start}
        AND e."createdAt" < ${input.range.end}
        ${resolutionActor}
      GROUP BY month_key
    )
    SELECT
      m.month_key,
      coalesce(p.cash_uzs, 0)::numeric AS cash_uzs,
      coalesce(p.cash_usd, 0)::numeric AS cash_usd,
      coalesce(p.cash_incomplete_count, 0)::integer AS cash_incomplete_count,
      coalesce(a.accrual_uzs, 0)::numeric AS accrual_uzs,
      coalesce(a.accrual_usd, 0)::numeric AS accrual_usd,
      coalesce(a.interest_uzs, 0)::numeric AS interest_uzs,
      coalesce(a.interest_usd, 0)::numeric AS interest_usd,
      coalesce(o.expected_uzs, 0)::numeric AS expected_uzs,
      coalesce(o.expected_usd, 0)::numeric AS expected_usd,
      coalesce(r.refunds_uzs, 0)::numeric AS refunds_uzs,
      coalesce(r.refunds_usd, 0)::numeric AS refunds_usd,
      coalesce(w.write_off_uzs, 0)::numeric AS write_off_uzs,
      coalesce(w.write_off_usd, 0)::numeric AS write_off_usd,
      coalesce(w.write_off_frozen_uzs, 0)::numeric AS write_off_frozen_uzs,
      (coalesce(a.gross_profit_uzs, 0) + coalesce(r.profit_adjustment_uzs, 0))::numeric AS gross_profit_uzs,
      (coalesce(a.interest_profit_uzs, 0) - coalesce(r.interest_reversal_uzs, 0))::numeric AS interest_profit_uzs,
      coalesce(r.return_count, 0)::integer AS return_count,
      coalesce(w.write_off_count, 0)::integer AS write_off_count,
      coalesce(w.reopen_count, 0)::integer AS reopen_count
    FROM months m
    LEFT JOIN payment_months p ON p.month_key = m.month_key
    LEFT JOIN accrual_months a ON a.month_key = m.month_key
    LEFT JOIN obligation_months o ON o.month_key = m.month_key
    LEFT JOIN return_months r ON r.month_key = m.month_key
    LEFT JOIN resolution_months w ON w.month_key = m.month_key
    ORDER BY m.ordinal ASC
  `)

  const months = rows.map((row): ShopMonthlyReportPoint => ({
    monthKey: row.month_key,
    cashCollected: {
      uzs: number(row.cash_uzs),
      usd: number(row.cash_usd),
      complete: Number(row.cash_incomplete_count ?? 0) === 0,
    },
    accrualRevenue: { uzs: number(row.accrual_uzs), usd: number(row.accrual_usd) },
    nasiyaInterest: { uzs: number(row.interest_uzs), usd: number(row.interest_usd) },
    expectedReceivables: { uzs: number(row.expected_uzs), usd: number(row.expected_usd) },
    refunds: { uzs: number(row.refunds_uzs), usd: number(row.refunds_usd) },
    writeOffs: {
      uzs: number(row.write_off_uzs),
      usd: number(row.write_off_usd),
      frozenUzs: number(row.write_off_frozen_uzs),
    },
    grossProfitUzs: number(row.gross_profit_uzs),
    interestProfitUzs: number(row.interest_profit_uzs),
    returnCount: Number(row.return_count ?? 0),
    writeOffCount: Number(row.write_off_count ?? 0),
    reopenCount: Number(row.reopen_count ?? 0),
  }))

  const totals = months.reduce<Omit<ShopMonthlyReportPoint, 'monthKey'>>((sum, month) => ({
    cashCollected: {
      uzs: sum.cashCollected.uzs + month.cashCollected.uzs,
      usd: sum.cashCollected.usd + month.cashCollected.usd,
      complete: sum.cashCollected.complete && month.cashCollected.complete,
    },
    accrualRevenue: {
      uzs: sum.accrualRevenue.uzs + month.accrualRevenue.uzs,
      usd: sum.accrualRevenue.usd + month.accrualRevenue.usd,
    },
    nasiyaInterest: {
      uzs: sum.nasiyaInterest.uzs + month.nasiyaInterest.uzs,
      usd: sum.nasiyaInterest.usd + month.nasiyaInterest.usd,
    },
    expectedReceivables: {
      uzs: sum.expectedReceivables.uzs + month.expectedReceivables.uzs,
      usd: sum.expectedReceivables.usd + month.expectedReceivables.usd,
    },
    refunds: {
      uzs: sum.refunds.uzs + month.refunds.uzs,
      usd: sum.refunds.usd + month.refunds.usd,
    },
    writeOffs: {
      uzs: sum.writeOffs.uzs + month.writeOffs.uzs,
      usd: sum.writeOffs.usd + month.writeOffs.usd,
      frozenUzs: sum.writeOffs.frozenUzs + month.writeOffs.frozenUzs,
    },
    grossProfitUzs: sum.grossProfitUzs + month.grossProfitUzs,
    interestProfitUzs: sum.interestProfitUzs + month.interestProfitUzs,
    returnCount: sum.returnCount + month.returnCount,
    writeOffCount: sum.writeOffCount + month.writeOffCount,
    reopenCount: sum.reopenCount + month.reopenCount,
  }), {
    cashCollected: { uzs: 0, usd: 0, complete: true },
    accrualRevenue: { uzs: 0, usd: 0 },
    nasiyaInterest: { uzs: 0, usd: 0 },
    expectedReceivables: { uzs: 0, usd: 0 },
    refunds: { uzs: 0, usd: 0 },
    writeOffs: { uzs: 0, usd: 0, frozenUzs: 0 },
    grossProfitUzs: 0,
    interestProfitUzs: 0,
    returnCount: 0,
    writeOffCount: 0,
    reopenCount: 0,
  })

  return {
    range: {
      preset: input.range.preset,
      startMonth: input.range.startMonth,
      endMonth: input.range.endMonth,
      monthKeys: input.range.monthKeys,
    },
    filteredByAdmin: input.adminId,
    nonAttributableFields: ['expectedReceivables'],
    months,
    totals,
  }
}
