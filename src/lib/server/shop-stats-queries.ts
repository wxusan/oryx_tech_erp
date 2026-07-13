import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

interface AccrualRow {
  sale_count: number
  sale_revenue_uzs: unknown
  sale_device_cost_uzs: unknown
  nasiya_revenue_uzs: unknown
  nasiya_interest_uzs: unknown
  nasiya_device_cost_uzs: unknown
}

export interface ShopAccrualAggregate {
  saleCount: number
  saleRevenueUzs: number
  saleDeviceCostUzs: number
  nasiyaRevenueUzs: number
  nasiyaInterestUzs: number
  nasiyaDeviceCostUzs: number
}

/** Set-based current-period Sale/Nasiya accrual totals. */
export async function getShopAccrualAggregate(input: {
  shopId: string
  monthStart: Date
  monthEnd: Date
  adminId: string | null
}): Promise<ShopAccrualAggregate> {
  const saleAdmin = input.adminId
    ? Prisma.sql`AND s."createdBy" = ${input.adminId}`
    : Prisma.empty
  const nasiyaAdmin = input.adminId
    ? Prisma.sql`AND n."createdBy" = ${input.adminId}`
    : Prisma.empty

  const [row] = await prisma.$queryRaw<AccrualRow[]>(Prisma.sql`
    WITH sale_agg AS (
      SELECT
        count(*)::integer AS sale_count,
        coalesce(sum(s."salePrice"), 0)::numeric AS sale_revenue_uzs,
        coalesce(sum(d."purchasePrice"), 0)::numeric AS sale_device_cost_uzs
      FROM "Sale" s
      JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND s."deletedAt" IS NULL
        AND s."createdAt" >= ${input.monthStart}
        AND s."createdAt" < ${input.monthEnd}
        ${saleAdmin}
    ), nasiya_agg AS (
      SELECT
        coalesce(sum(n."totalAmount"), 0)::numeric AS nasiya_revenue_uzs,
        coalesce(sum(n."interestAmount"), 0)::numeric AS nasiya_interest_uzs,
        coalesce(sum(d."purchasePrice"), 0)::numeric AS nasiya_device_cost_uzs
      FROM "Nasiya" n
      JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
      WHERE n."shopId" = ${input.shopId}
        AND n."deletedAt" IS NULL
        AND n."isImported" = false
        AND n."createdAt" >= ${input.monthStart}
        AND n."createdAt" < ${input.monthEnd}
        ${nasiyaAdmin}
    )
    SELECT * FROM sale_agg CROSS JOIN nasiya_agg
  `)

  return {
    saleCount: Number(row?.sale_count ?? 0),
    saleRevenueUzs: Number(row?.sale_revenue_uzs ?? 0),
    saleDeviceCostUzs: Number(row?.sale_device_cost_uzs ?? 0),
    nasiyaRevenueUzs: Number(row?.nasiya_revenue_uzs ?? 0),
    nasiyaInterestUzs: Number(row?.nasiya_interest_uzs ?? 0),
    nasiyaDeviceCostUzs: Number(row?.nasiya_device_cost_uzs ?? 0),
  }
}

interface ObligationRow {
  expected_uzs: unknown
  expected_usd: unknown
  overdue_uzs: unknown
  overdue_usd: unknown
  overdue_count: number
  false_completed_count: number
}

export interface ShopObligationAggregate {
  expectedUzs: number
  expectedUsd: number
  overdueUzs: number
  overdueUsd: number
  overdueCount: number
  falseCompletedCount: number
}

/**
 * Aggregate all open Sale and Nasiya obligations without hydrating every row.
 * Native currencies remain partitioned; conversion happens once in the pure
 * formula layer with the same governed rate used by the rest of the snapshot.
 */
export async function getShopObligationAggregate(input: {
  shopId: string
  monthStart: Date
  monthEnd: Date
  todayStart: Date
}): Promise<ShopObligationAggregate> {
  const [row] = await prisma.$queryRaw<ObligationRow[]>(Prisma.sql`
    WITH schedule_rows AS (
      SELECT
        n."id" AS nasiya_id,
        n."status" AS nasiya_status,
        n."contractCurrency" AS currency,
        coalesce(s."delayedUntil", s."dueDate") AS effective_due,
        CASE
          WHEN n."contractCurrency" = 'USD'
            AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
            THEN s."contractExpectedAmount" - s."contractPaidAmount"
          WHEN n."contractCurrency" = 'UZS'
            AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
            THEN s."contractExpectedAmount" - s."contractPaidAmount"
          ELSE 0
        END AS outstanding
      FROM "NasiyaSchedule" s
      JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
        AND n."deletedAt" IS NULL
        AND n."returnedAt" IS NULL
        AND n."status" <> 'CANCELLED'
        AND n."resolutionState" <> 'WRITTEN_OFF'
    ), schedule_agg AS (
      SELECT
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'UZS' AND effective_due >= ${input.monthStart} AND effective_due < ${input.monthEnd}
        ), 0)::numeric AS expected_uzs,
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'USD' AND effective_due >= ${input.monthStart} AND effective_due < ${input.monthEnd}
        ), 0)::numeric AS expected_usd,
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'UZS' AND effective_due < ${input.todayStart}
        ), 0)::numeric AS overdue_uzs,
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'USD' AND effective_due < ${input.todayStart}
        ), 0)::numeric AS overdue_usd,
        count(*) FILTER (WHERE outstanding > 0 AND effective_due < ${input.todayStart})::integer AS overdue_count,
        count(DISTINCT nasiya_id) FILTER (
          WHERE nasiya_status = 'COMPLETED' AND outstanding > 0
        )::integer AS false_completed_count
      FROM schedule_rows
    ), sale_rows AS (
      SELECT s."contractCurrency" AS currency,
             s."dueDate" AS effective_due,
             s."contractRemainingAmount" AS outstanding
      FROM "Sale" s
      WHERE s."shopId" = ${input.shopId}
        AND s."deletedAt" IS NULL
        AND s."returnedAt" IS NULL
        AND s."paidFully" = false
        AND s."contractRemainingAmount" > 0
    ), sale_agg AS (
      SELECT
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'UZS' AND effective_due >= ${input.monthStart} AND effective_due < ${input.monthEnd}
        ), 0)::numeric AS expected_uzs,
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'USD' AND effective_due >= ${input.monthStart} AND effective_due < ${input.monthEnd}
        ), 0)::numeric AS expected_usd,
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'UZS' AND effective_due < ${input.todayStart}
        ), 0)::numeric AS overdue_uzs,
        coalesce(sum(outstanding) FILTER (
          WHERE currency = 'USD' AND effective_due < ${input.todayStart}
        ), 0)::numeric AS overdue_usd,
        count(*) FILTER (WHERE effective_due < ${input.todayStart})::integer AS overdue_count
      FROM sale_rows
    )
    SELECT
      schedule_agg.expected_uzs + sale_agg.expected_uzs AS expected_uzs,
      schedule_agg.expected_usd + sale_agg.expected_usd AS expected_usd,
      schedule_agg.overdue_uzs + sale_agg.overdue_uzs AS overdue_uzs,
      schedule_agg.overdue_usd + sale_agg.overdue_usd AS overdue_usd,
      schedule_agg.overdue_count + sale_agg.overdue_count AS overdue_count,
      schedule_agg.false_completed_count AS false_completed_count
    FROM schedule_agg CROSS JOIN sale_agg
  `)

  return {
    expectedUzs: Number(row?.expected_uzs ?? 0),
    expectedUsd: Number(row?.expected_usd ?? 0),
    overdueUzs: Number(row?.overdue_uzs ?? 0),
    overdueUsd: Number(row?.overdue_usd ?? 0),
    overdueCount: Number(row?.overdue_count ?? 0),
    falseCompletedCount: Number(row?.false_completed_count ?? 0),
  }
}

interface IdRow { id: string }

export async function getUpcomingScheduleIds(shopId: string, take = 5): Promise<string[]> {
  const rows = await prisma.$queryRaw<IdRow[]>(Prisma.sql`
    SELECT s."id"
    FROM "NasiyaSchedule" s
    JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
    WHERE s."shopId" = ${shopId}
      AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
      AND n."deletedAt" IS NULL
      AND n."returnedAt" IS NULL
      AND n."status" <> 'CANCELLED'
      AND n."resolutionState" = 'ACTIVE'
      AND (
        (n."contractCurrency" = 'USD' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01)
        OR (n."contractCurrency" = 'UZS' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1)
      )
    ORDER BY coalesce(s."delayedUntil", s."dueDate") ASC, s."id" ASC
    LIMIT ${Math.max(1, Math.min(Math.trunc(take), 50))}
  `)
  return rows.map((row) => row.id)
}

export type ReceivableCohort = 'DUE_TODAY' | 'OVERDUE'

interface ReceivableCohortRow {
  cohort: ReceivableCohort
  native_uzs: unknown
  native_usd: unknown
  deal_count: number
  customer_count: number
  single_type: string | null
  single_id: string | null
}

export interface ReceivableCohortSummary {
  cohort: ReceivableCohort
  nativeUzs: number
  nativeUsd: number
  dealCount: number
  customerCount: number
  singleDeal: { type: 'nasiya' | 'sale'; id: string } | null
}

interface ReceivableDealRow {
  cohort: ReceivableCohort
  deal_type: 'nasiya' | 'sale'
  deal_id: string
  customer_id: string
  customer_name: string
  customer_phone: string
  device_id: string
  device_model: string
  currency: 'UZS' | 'USD'
  outstanding: unknown
  effective_due: Date
  total_count: number
}

/**
 * Authoritative operational receivable set used by both the global banners
 * and their destination list. The two cohorts are disjoint at Tashkent
 * midnight. ARCHIVED/WRITTEN_OFF Nasiya stays out of work queues while
 * immutable report history remains available elsewhere.
 */
function receivableDealsCte(input: {
  shopId: string
  todayStart: Date
  tomorrowStart: Date
  includeCashSales: boolean
  includeNasiya: boolean
}) {
  return Prisma.sql`
    WITH nasiya_installments AS (
      SELECT
        CASE
          WHEN coalesce(s."delayedUntil", s."dueDate") < ${input.todayStart} THEN 'OVERDUE'::text
          WHEN coalesce(s."delayedUntil", s."dueDate") >= ${input.todayStart}
            AND coalesce(s."delayedUntil", s."dueDate") < ${input.tomorrowStart} THEN 'DUE_TODAY'::text
        END AS cohort,
        n."id" AS deal_id,
        n."customerId" AS customer_id,
        c."name" AS customer_name,
        c."phone" AS customer_phone,
        d."id" AS device_id,
        d."model" AS device_model,
        n."contractCurrency" AS currency,
        coalesce(s."delayedUntil", s."dueDate") AS effective_due,
        CASE
          WHEN n."contractCurrency" = 'USD'
            AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
            THEN s."contractExpectedAmount" - s."contractPaidAmount"
          WHEN n."contractCurrency" = 'UZS'
            AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
            THEN s."contractExpectedAmount" - s."contractPaidAmount"
          ELSE 0
        END::numeric AS outstanding
      FROM "NasiyaSchedule" s
      JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
      JOIN "Customer" c ON c."id" = n."customerId" AND c."shopId" = n."shopId"
      JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND ${input.includeNasiya}
        AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
        AND coalesce(s."delayedUntil", s."dueDate") < ${input.tomorrowStart}
        AND n."deletedAt" IS NULL
        AND n."returnedAt" IS NULL
        AND n."status" <> 'CANCELLED'
        AND n."resolutionState" = 'ACTIVE'
    ), nasiya_deals AS (
      SELECT
        cohort,
        'nasiya'::text AS deal_type,
        deal_id,
        customer_id,
        customer_name,
        customer_phone,
        device_id,
        device_model,
        currency,
        sum(outstanding)::numeric AS outstanding,
        min(effective_due) AS effective_due
      FROM nasiya_installments
      WHERE cohort IS NOT NULL AND outstanding > 0
      GROUP BY cohort, deal_id, customer_id, customer_name, customer_phone, device_id, device_model, currency
    ), sale_deals AS (
      SELECT
        CASE
          WHEN s."dueDate" < ${input.todayStart} THEN 'OVERDUE'::text
          ELSE 'DUE_TODAY'::text
        END AS cohort,
        'sale'::text AS deal_type,
        s."id" AS deal_id,
        s."customerId" AS customer_id,
        c."name" AS customer_name,
        c."phone" AS customer_phone,
        d."id" AS device_id,
        d."model" AS device_model,
        s."contractCurrency" AS currency,
        s."contractRemainingAmount"::numeric AS outstanding,
        s."dueDate" AS effective_due
      FROM "Sale" s
      JOIN "Customer" c ON c."id" = s."customerId" AND c."shopId" = s."shopId"
      JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND ${input.includeCashSales}
        AND s."deletedAt" IS NULL
        AND s."returnedAt" IS NULL
        AND s."paidFully" = false
        AND s."contractRemainingAmount" > 0
        AND s."dueDate" IS NOT NULL
        AND s."dueDate" < ${input.tomorrowStart}
    ), receivable_deals AS (
      SELECT * FROM nasiya_deals
      UNION ALL
      SELECT * FROM sale_deals
    )
  `
}

export async function getReceivableCohortSummaries(input: {
  shopId: string
  todayStart: Date
  tomorrowStart: Date
  includeCashSales: boolean
  includeNasiya: boolean
}): Promise<Record<ReceivableCohort, ReceivableCohortSummary>> {
  const rows = await prisma.$queryRaw<ReceivableCohortRow[]>(Prisma.sql`
    ${receivableDealsCte(input)}
    SELECT
      cohort,
      coalesce(sum(outstanding) FILTER (WHERE currency = 'UZS'), 0)::numeric AS native_uzs,
      coalesce(sum(outstanding) FILTER (WHERE currency = 'USD'), 0)::numeric AS native_usd,
      count(*)::integer AS deal_count,
      count(DISTINCT customer_id)::integer AS customer_count,
      CASE WHEN count(*) = 1 THEN min(deal_type) END AS single_type,
      CASE WHEN count(*) = 1 THEN min(deal_id) END AS single_id
    FROM receivable_deals
    GROUP BY cohort
  `)
  const empty = (cohort: ReceivableCohort): ReceivableCohortSummary => ({
    cohort,
    nativeUzs: 0,
    nativeUsd: 0,
    dealCount: 0,
    customerCount: 0,
    singleDeal: null,
  })
  const result: Record<ReceivableCohort, ReceivableCohortSummary> = {
    DUE_TODAY: empty('DUE_TODAY'),
    OVERDUE: empty('OVERDUE'),
  }
  for (const row of rows) {
    result[row.cohort] = {
      cohort: row.cohort,
      nativeUzs: Number(row.native_uzs ?? 0),
      nativeUsd: Number(row.native_usd ?? 0),
      dealCount: Number(row.deal_count ?? 0),
      customerCount: Number(row.customer_count ?? 0),
      singleDeal: row.single_id && (row.single_type === 'nasiya' || row.single_type === 'sale')
        ? { type: row.single_type, id: row.single_id }
        : null,
    }
  }
  return result
}

export async function getReceivableCohortPage(input: {
  shopId: string
  todayStart: Date
  tomorrowStart: Date
  includeCashSales: boolean
  includeNasiya: boolean
  cohort: ReceivableCohort
  skip: number
  take: number
}) {
  const rows = await prisma.$queryRaw<ReceivableDealRow[]>(Prisma.sql`
    ${receivableDealsCte(input)}
    SELECT
      cohort,
      deal_type,
      deal_id,
      customer_id,
      customer_name,
      customer_phone,
      device_id,
      device_model,
      currency,
      outstanding,
      effective_due,
      count(*) OVER ()::integer AS total_count
    FROM receivable_deals
    WHERE cohort = ${input.cohort}
    ORDER BY effective_due ASC, customer_name ASC, deal_id ASC
    OFFSET ${Math.max(0, Math.trunc(input.skip))}
    LIMIT ${Math.max(1, Math.min(100, Math.trunc(input.take)))}
  `)
  return {
    items: rows.map((row) => ({
      cohort: row.cohort,
      dealType: row.deal_type,
      dealId: row.deal_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      deviceId: row.device_id,
      deviceModel: row.device_model,
      currency: row.currency,
      outstanding: Number(row.outstanding ?? 0),
      effectiveDue: row.effective_due,
    })),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

export async function getCurrentOverdueSummary(input: {
  shopId: string
  todayStart: Date
  includeCashSales?: boolean
  includeNasiya?: boolean
}) {
  const tomorrowStart = new Date(input.todayStart)
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1)
  const row = (await getReceivableCohortSummaries({
    shopId: input.shopId,
    todayStart: input.todayStart,
    tomorrowStart,
    includeCashSales: input.includeCashSales !== false,
    includeNasiya: input.includeNasiya !== false,
  })).OVERDUE
  return {
    overdueNativeUzs: row.nativeUzs,
    overdueNativeUsd: row.nativeUsd,
    overdueDealCount: row.dealCount,
    singleDeal: row.singleDeal,
  }
}

interface WriteOffAggregateRow {
  native_uzs: unknown
  native_usd: unknown
  frozen_uzs: unknown
  write_off_count: number
  reopen_count: number
}

export interface NasiyaWriteOffAggregate {
  nativeUzs: number
  nativeUsd: number
  frozenUzs: number
  writeOffCount: number
  reopenCount: number
}

/** Period movement from append-only resolution evidence, not mutable balances. */
export async function getNasiyaWriteOffAggregate(input: {
  shopId: string
  monthStart: Date
  monthEnd: Date
  adminId?: string | null
}): Promise<NasiyaWriteOffAggregate> {
  const actorPredicate = input.adminId
    ? Prisma.sql`AND e."actorId" = ${input.adminId}`
    : Prisma.empty
  const [row] = await prisma.$queryRaw<WriteOffAggregateRow[]>(Prisma.sql`
    SELECT
      coalesce(sum(CASE
        WHEN e."contractCurrency" = 'UZS' AND e."eventType" = 'WRITE_OFF' THEN e."nativeRemainingAmount"
        WHEN e."contractCurrency" = 'UZS' AND e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."nativeRemainingAmount"
        ELSE 0
      END), 0)::numeric AS native_uzs,
      coalesce(sum(CASE
        WHEN e."contractCurrency" = 'USD' AND e."eventType" = 'WRITE_OFF' THEN e."nativeRemainingAmount"
        WHEN e."contractCurrency" = 'USD' AND e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."nativeRemainingAmount"
        ELSE 0
      END), 0)::numeric AS native_usd,
      coalesce(sum(CASE
        WHEN e."eventType" = 'WRITE_OFF' THEN e."frozenUzsAmount"
        WHEN e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."frozenUzsAmount"
        ELSE 0
      END), 0)::numeric AS frozen_uzs,
      count(*) FILTER (WHERE e."eventType" = 'WRITE_OFF')::integer AS write_off_count,
      count(*) FILTER (
        WHERE e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF'
      )::integer AS reopen_count
    FROM "NasiyaResolutionEvent" e
    WHERE e."shopId" = ${input.shopId}
      AND e."createdAt" >= ${input.monthStart}
      AND e."createdAt" < ${input.monthEnd}
      ${actorPredicate}
  `)
  return {
    nativeUzs: Number(row?.native_uzs ?? 0),
    nativeUsd: Number(row?.native_usd ?? 0),
    frozenUzs: Number(row?.frozen_uzs ?? 0),
    writeOffCount: Number(row?.write_off_count ?? 0),
    reopenCount: Number(row?.reopen_count ?? 0),
  }
}
