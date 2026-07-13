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
      AND (
        (n."contractCurrency" = 'USD' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01)
        OR (n."contractCurrency" = 'UZS' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1)
      )
    ORDER BY coalesce(s."delayedUntil", s."dueDate") ASC, s."id" ASC
    LIMIT ${Math.max(1, Math.min(Math.trunc(take), 50))}
  `)
  return rows.map((row) => row.id)
}

interface OverdueSummaryRow {
  overdue_native_uzs: unknown
  overdue_native_usd: unknown
  deal_count: number
  single_type: string | null
  single_id: string | null
}

export async function getCurrentOverdueSummary(input: {
  shopId: string
  todayStart: Date
}) {
  const [row] = await prisma.$queryRaw<OverdueSummaryRow[]>(Prisma.sql`
    WITH nasiya_deals AS (
      SELECT
        'nasiya'::text AS deal_type,
        n."id" AS deal_id,
        n."contractCurrency" AS currency,
        sum(CASE
          WHEN n."contractCurrency" = 'USD'
            AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
            THEN s."contractExpectedAmount" - s."contractPaidAmount"
          WHEN n."contractCurrency" = 'UZS'
            AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
            THEN s."contractExpectedAmount" - s."contractPaidAmount"
          ELSE 0
        END)::numeric AS outstanding
      FROM "NasiyaSchedule" s
      JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
      WHERE s."shopId" = ${input.shopId}
        AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
        AND coalesce(s."delayedUntil", s."dueDate") < ${input.todayStart}
        AND n."deletedAt" IS NULL
        AND n."returnedAt" IS NULL
        AND n."status" <> 'CANCELLED'
      GROUP BY n."id", n."contractCurrency"
      HAVING sum(CASE
        WHEN n."contractCurrency" = 'USD'
          AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
          THEN s."contractExpectedAmount" - s."contractPaidAmount"
        WHEN n."contractCurrency" = 'UZS'
          AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
          THEN s."contractExpectedAmount" - s."contractPaidAmount"
        ELSE 0
      END) > 0
    ), sale_deals AS (
      SELECT
        'sale'::text AS deal_type,
        s."id" AS deal_id,
        s."contractCurrency" AS currency,
        s."contractRemainingAmount"::numeric AS outstanding
      FROM "Sale" s
      WHERE s."shopId" = ${input.shopId}
        AND s."deletedAt" IS NULL
        AND s."returnedAt" IS NULL
        AND s."paidFully" = false
        AND s."contractRemainingAmount" > 0
        AND s."dueDate" < ${input.todayStart}
    ), overdue_deals AS (
      SELECT * FROM nasiya_deals
      UNION ALL
      SELECT * FROM sale_deals
    )
    SELECT
      coalesce(sum(outstanding) FILTER (WHERE currency = 'UZS'), 0)::numeric AS overdue_native_uzs,
      coalesce(sum(outstanding) FILTER (WHERE currency = 'USD'), 0)::numeric AS overdue_native_usd,
      count(*)::integer AS deal_count,
      CASE WHEN count(*) = 1 THEN min(deal_type) END AS single_type,
      CASE WHEN count(*) = 1 THEN min(deal_id) END AS single_id
    FROM overdue_deals
  `)

  return {
    overdueNativeUzs: Number(row?.overdue_native_uzs ?? 0),
    overdueNativeUsd: Number(row?.overdue_native_usd ?? 0),
    overdueDealCount: Number(row?.deal_count ?? 0),
    singleDeal:
      row?.single_id && (row.single_type === 'nasiya' || row.single_type === 'sale')
        ? { type: row.single_type, id: row.single_id }
        : null,
  }
}
