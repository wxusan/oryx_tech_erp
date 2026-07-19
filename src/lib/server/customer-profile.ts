import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { computeCustomerTrustRatingFromFactors, isValidTrustTier, type CustomerTrustFactors } from '@/lib/nasiya-customer-trust'
import { getCustomerTrustFactorsForList } from '@/lib/server/customer-trust-queries'
import { isPrivateUploadStoredKey } from '@/lib/server/private-upload-reference'
import { timeRequestPhase } from '@/lib/server/request-context'
import { tashkentDayRange, tashkentMonthRange } from '@/lib/timezone'
import {
  redactShopStaffCustomerProfileMetrics,
  type CustomerProfileMetrics,
  type CustomerProfileVisibleMetrics,
} from '@/lib/customer-profile-visibility'

export const CUSTOMER_PROFILE_SECTIONS = ['devices', 'sales', 'nasiya', 'payments', 'returns', 'resolutions'] as const
export type CustomerProfileSection = (typeof CUSTOMER_PROFILE_SECTIONS)[number]

interface MetricRow {
  contract_uzs: unknown
  contract_usd: unknown
  collected_uzs: unknown
  collected_usd: unknown
  due_this_month_uzs: unknown
  due_this_month_usd: unknown
  overdue_uzs: unknown
  overdue_usd: unknown
  refunds_uzs: unknown
  refunds_usd: unknown
  writeoffs_uzs: unknown
  writeoffs_usd: unknown
  accrual_profit_uzs: unknown
  nasiya_interest_uzs: unknown
  legacy_usd_payment_count: number
  device_count: number
  sale_count: number
  active_nasiya_count: number
  completed_nasiya_count: number
  archived_nasiya_count: number
  written_off_nasiya_count: number
  return_count: number
}

function money(uzs: unknown, usd: unknown) {
  return { UZS: Number(uzs ?? 0), USD: Number(usd ?? 0) }
}

export interface CustomerProfileVisibility {
  /**
   * Shop-wide/customer-lifetime cash flow, write-off, interest and margin
   * aggregates are owner data. Staff still receive the operational contract
   * and due queues needed to serve this individual customer.
   */
  includeOwnerFinancials: boolean
}

/** Set-based, one-row customer lifetime/current-state aggregate. */
export async function getCustomerProfileOverview(input: {
  shopId: string
  customerId: string
  now?: Date
  visibility: CustomerProfileVisibility
}) {
  const customer = await timeRequestPhase('database', () => prisma.customer.findFirst({
    where: { id: input.customerId, shopId: input.shopId, deletedAt: null },
    select: {
      id: true,
      name: true,
      phone: true,
      additionalPhones: true,
      note: true,
      trustOverride: true,
      passportIdentifierLast4: true,
      passportPhotoUrl: true,
      createdAt: true,
    },
  }))
  if (!customer) return null

  const asOf = input.now ?? new Date()
  const day = tashkentDayRange(asOf)
  const month = tashkentMonthRange(asOf)
  const [metricRows, trustMap] = await timeRequestPhase('database', () => Promise.all([
    prisma.$queryRaw<MetricRow[]>(Prisma.sql`
      WITH sale_base AS (
        SELECT s.*, d."purchasePrice" AS purchase_price
        FROM "Sale" s
        JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
        WHERE s."shopId" = ${input.shopId}
          AND s."customerId" = ${input.customerId}
          AND s."deletedAt" IS NULL
      ), nasiya_base AS (
        SELECT n.*, d."purchasePrice" AS purchase_price
        FROM "Nasiya" n
        JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
        WHERE n."shopId" = ${input.shopId}
          AND n."customerId" = ${input.customerId}
          AND n."deletedAt" IS NULL
      ), payments AS (
        SELECT s."contractCurrency" AS currency,
               coalesce(p."appliedAmountInContractCurrency",
                 CASE
                   WHEN s."contractCurrency" = 'UZS' THEN p."amount"
                   WHEN p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL THEN p."paymentInputAmount"
                   WHEN p."paymentExchangeRate" > 0 THEN p."amount" / p."paymentExchangeRate"
                   ELSE 0
                 END) AS amount,
               (s."contractCurrency" = 'USD' AND p."appliedAmountInContractCurrency" IS NULL
                 AND NOT coalesce(p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL, FALSE)
                 AND NOT coalesce(p."paymentExchangeRate" > 0, FALSE)) AS legacy_usd
        FROM "SalePayment" p
        JOIN sale_base s ON s."id" = p."saleId"
        WHERE p."shopId" = ${input.shopId} AND p."deletedAt" IS NULL
        UNION ALL
        SELECT n."contractCurrency",
               coalesce(p."appliedAmountInContractCurrency",
                 CASE
                   WHEN n."contractCurrency" = 'UZS' THEN p."amount"
                   WHEN p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL THEN p."paymentInputAmount"
                   WHEN p."paymentExchangeRate" > 0 THEN p."amount" / p."paymentExchangeRate"
                   ELSE 0
                 END),
               (n."contractCurrency" = 'USD' AND p."appliedAmountInContractCurrency" IS NULL
                 AND NOT coalesce(p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL, FALSE)
                 AND NOT coalesce(p."paymentExchangeRate" > 0, FALSE))
        FROM "NasiyaPayment" p
        JOIN nasiya_base n ON n."id" = p."nasiyaId"
        WHERE p."shopId" = ${input.shopId} AND p."deletedAt" IS NULL
      ), obligations AS (
        SELECT s."contractCurrency" AS currency, s."contractRemainingAmount" AS amount,
               s."dueDate" AS due_at
        FROM sale_base s
        WHERE s."returnedAt" IS NULL AND s."paidFully" = FALSE
          AND s."contractRemainingAmount" > 0 AND s."dueDate" IS NOT NULL
        UNION ALL
        SELECT n."contractCurrency",
               CASE
                 WHEN n."contractCurrency" = 'USD' THEN greatest(sc."contractExpectedAmount" - sc."contractPaidAmount", 0)
                 ELSE greatest(sc."contractExpectedAmount" - sc."contractPaidAmount", 0)
               END,
               coalesce(sc."delayedUntil", sc."dueDate")
        FROM "NasiyaSchedule" sc
        JOIN nasiya_base n ON n."id" = sc."nasiyaId" AND n."shopId" = sc."shopId"
        WHERE sc."shopId" = ${input.shopId}
          AND sc."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
          AND n."returnedAt" IS NULL
          AND n."status" <> 'CANCELLED'
          AND n."resolutionState" = 'ACTIVE'
      ), refunds AS (
        SELECT CASE
                 WHEN r."contractCurrency" = 'USD' AND r."contractRefundAmount" > 0 THEN 'USD'::"CurrencyCode"
                 ELSE 'UZS'::"CurrencyCode"
               END AS currency,
               CASE
                 WHEN r."contractCurrency" = 'USD' THEN r."contractRefundAmount"
                 WHEN r."contractRefundAmount" > 0 THEN r."contractRefundAmount"
                 ELSE r."refundAmount"
               END AS amount
        FROM "DeviceReturn" r
        LEFT JOIN sale_base s ON s."id" = r."saleId" AND s."shopId" = r."shopId"
        LEFT JOIN nasiya_base n ON n."id" = r."nasiyaId" AND n."shopId" = r."shopId"
        WHERE r."shopId" = ${input.shopId} AND (s."id" IS NOT NULL OR n."id" IS NOT NULL)
      ), resolution_movement AS (
        SELECT e."contractCurrency" AS currency,
          CASE
            WHEN e."eventType" = 'WRITE_OFF' THEN e."nativeRemainingAmount"
            WHEN e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."nativeRemainingAmount"
            ELSE 0
          END AS amount
        FROM "NasiyaResolutionEvent" e
        JOIN nasiya_base n ON n."id" = e."nasiyaId" AND n."shopId" = e."shopId"
        WHERE e."shopId" = ${input.shopId}
      ), return_accounting AS (
        SELECT coalesce(sum(r."revenueReversalAmountUzs"), 0) AS revenue_reversal,
               coalesce(sum(r."inventoryCostRecoveryUzs"), 0) AS cost_recovery,
               coalesce(sum(r."retainedValueAmountUzs"), 0) AS retained_value
        FROM "DeviceReturn" r
        LEFT JOIN sale_base s ON s."id" = r."saleId" AND s."shopId" = r."shopId"
        LEFT JOIN nasiya_base n ON n."id" = r."nasiyaId" AND n."shopId" = r."shopId"
        WHERE r."shopId" = ${input.shopId} AND (s."id" IS NOT NULL OR n."id" IS NOT NULL)
      )
      SELECT
        (coalesce((SELECT sum("contractSalePrice") FROM sale_base WHERE "contractCurrency" = 'UZS'), 0)
          + coalesce((SELECT sum(CASE
              WHEN "resolutionState" = 'ARCHIVED' THEN "contractDownPayment" + "contractPaidAmount"
              ELSE "contractDownPayment" + "contractFinalAmount"
            END) FROM nasiya_base WHERE "contractCurrency" = 'UZS'), 0))::numeric AS contract_uzs,
        (coalesce((SELECT sum("contractSalePrice") FROM sale_base WHERE "contractCurrency" = 'USD'), 0)
          + coalesce((SELECT sum(CASE
              WHEN "resolutionState" = 'ARCHIVED' THEN "contractDownPayment" + "contractPaidAmount"
              ELSE "contractDownPayment" + "contractFinalAmount"
            END) FROM nasiya_base WHERE "contractCurrency" = 'USD'), 0))::numeric AS contract_usd,
        coalesce((SELECT sum(amount) FROM payments WHERE currency = 'UZS'), 0)::numeric AS collected_uzs,
        coalesce((SELECT sum(amount) FROM payments WHERE currency = 'USD'), 0)::numeric AS collected_usd,
        coalesce((SELECT sum(amount) FROM obligations WHERE currency = 'UZS' AND due_at >= ${month.start} AND due_at < ${month.end}), 0)::numeric AS due_this_month_uzs,
        coalesce((SELECT sum(amount) FROM obligations WHERE currency = 'USD' AND due_at >= ${month.start} AND due_at < ${month.end}), 0)::numeric AS due_this_month_usd,
        coalesce((SELECT sum(amount) FROM obligations WHERE currency = 'UZS' AND due_at < ${day.start}), 0)::numeric AS overdue_uzs,
        coalesce((SELECT sum(amount) FROM obligations WHERE currency = 'USD' AND due_at < ${day.start}), 0)::numeric AS overdue_usd,
        coalesce((SELECT sum(amount) FROM refunds WHERE currency = 'UZS'), 0)::numeric AS refunds_uzs,
        coalesce((SELECT sum(amount) FROM refunds WHERE currency = 'USD'), 0)::numeric AS refunds_usd,
        coalesce((SELECT sum(amount) FROM resolution_movement WHERE currency = 'UZS'), 0)::numeric AS writeoffs_uzs,
        coalesce((SELECT sum(amount) FROM resolution_movement WHERE currency = 'USD'), 0)::numeric AS writeoffs_usd,
        ((coalesce((SELECT sum("salePrice" - purchase_price) FROM sale_base), 0)
          + coalesce((SELECT sum("totalAmount" - purchase_price) FROM nasiya_base
              WHERE "isImported" = FALSE AND "resolutionState" <> 'ARCHIVED'), 0))
          - (SELECT revenue_reversal FROM return_accounting)
          + (SELECT cost_recovery FROM return_accounting)
          + (SELECT retained_value FROM return_accounting))::numeric AS accrual_profit_uzs,
        coalesce((SELECT sum("interestAmount") FROM nasiya_base
            WHERE "isImported" = FALSE AND "resolutionState" <> 'ARCHIVED'), 0)::numeric AS nasiya_interest_uzs,
        coalesce((SELECT count(*) FROM payments WHERE legacy_usd), 0)::integer AS legacy_usd_payment_count,
        (SELECT count(DISTINCT device_id) FROM (
          SELECT "deviceId" AS device_id FROM sale_base UNION SELECT "deviceId" FROM nasiya_base
        ) devices)::integer AS device_count,
        (SELECT count(*) FROM sale_base)::integer AS sale_count,
        (SELECT count(*) FROM nasiya_base WHERE "status" IN ('ACTIVE', 'OVERDUE') AND "resolutionState" = 'ACTIVE')::integer AS active_nasiya_count,
        (SELECT count(*) FROM nasiya_base WHERE "status" = 'COMPLETED')::integer AS completed_nasiya_count,
        (SELECT count(*) FROM nasiya_base WHERE "resolutionState" = 'ARCHIVED')::integer AS archived_nasiya_count,
        (SELECT count(*) FROM nasiya_base WHERE "resolutionState" = 'WRITTEN_OFF')::integer AS written_off_nasiya_count,
        (SELECT count(*) FROM refunds)::integer AS return_count
    `),
    getCustomerTrustFactorsForList({ shopId: input.shopId, customerIds: [input.customerId], now: input.now }),
  ]))

  const row = metricRows[0]
  const fallbackFactors: CustomerTrustFactors = {
    totalNasiyaCount: 0, completedNasiyaCount: 0, activeNasiyaCount: 0, cancelledNasiyaCount: 0,
    paidInstallmentCount: 0, onTimeRatio: null, lateInstallmentCount: 0, maxDaysLate: 0,
    currentOverdueScheduleCount: 0, hasCurrentOverdue: false,
  }
  const trust = computeCustomerTrustRatingFromFactors(
    trustMap.get(customer.id) ?? fallbackFactors,
    isValidTrustTier(customer.trustOverride) ? customer.trustOverride : null,
  )

  const metrics: CustomerProfileMetrics = {
    contractValue: money(row?.contract_uzs, row?.contract_usd),
    cashCollected: money(row?.collected_uzs, row?.collected_usd),
    dueThisMonth: money(row?.due_this_month_uzs, row?.due_this_month_usd),
    overdue: money(row?.overdue_uzs, row?.overdue_usd),
    refunds: money(row?.refunds_uzs, row?.refunds_usd),
    writeOffs: money(row?.writeoffs_uzs, row?.writeoffs_usd),
    accountingAccrualGrossProfitUzs: Number(row?.accrual_profit_uzs ?? 0),
    nasiyaInterestUzs: Number(row?.nasiya_interest_uzs ?? 0),
    legacyUsdPaymentCount: Number(row?.legacy_usd_payment_count ?? 0),
  }

  const visibleMetrics: CustomerProfileVisibleMetrics = input.visibility.includeOwnerFinancials
    ? metrics
    : redactShopStaffCustomerProfileMetrics(metrics)

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      additionalPhones: customer.additionalPhones,
      note: customer.note,
      createdAt: customer.createdAt.toISOString(),
      passportMasked: customer.passportIdentifierLast4 ? `••••${customer.passportIdentifierLast4}` : null,
      hasPassportPhoto: isPrivateUploadStoredKey({ key: customer.passportPhotoUrl, shopId: input.shopId, kind: 'passport' }),
    },
    trust,
    metrics: visibleMetrics,
    counts: {
      devices: Number(row?.device_count ?? 0),
      sales: Number(row?.sale_count ?? 0),
      activeNasiya: Number(row?.active_nasiya_count ?? 0),
      completedNasiya: Number(row?.completed_nasiya_count ?? 0),
      archivedNasiya: Number(row?.archived_nasiya_count ?? 0),
      writtenOffNasiya: Number(row?.written_off_nasiya_count ?? 0),
      returns: Number(row?.return_count ?? 0),
    },
  }
}

interface HistoryRow {
  customer_marker: string
  id: string | null
  occurred_at: Date | null
  kind: string | null
  reference_id: string | null
  title: string | null
  subtitle: string | null
  currency: 'UZS' | 'USD' | null
  amount: unknown
  status: string | null
}

function historySql(section: CustomerProfileSection, input: { shopId: string; customerId: string }) {
  switch (section) {
    case 'devices':
      return Prisma.sql`
        SELECT concat(source, ':', deal_id) AS id, occurred_at, 'device'::text AS kind,
               device_id AS reference_id, model AS title,
               concat_ws(' · ', NULLIF(storage, ''), NULLIF(color, ''), NULLIF(imei, '')) AS subtitle,
               currency, amount, status
        FROM (
          SELECT 'sale'::text AS source, s."id" AS deal_id, s."createdAt" AS occurred_at,
                 d."id" AS device_id, d."model" AS model, d."storage", d."color", d."imei",
                 s."contractCurrency" AS currency, s."contractSalePrice" AS amount, d."status"::text AS status
          FROM "Sale" s JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
          WHERE s."shopId" = ${input.shopId} AND s."customerId" = ${input.customerId} AND s."deletedAt" IS NULL
          UNION ALL
          SELECT 'nasiya', n."id", n."createdAt", d."id", d."model", d."storage", d."color", d."imei",
                 n."contractCurrency", n."contractTotalAmount", d."status"::text
          FROM "Nasiya" n JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
          WHERE n."shopId" = ${input.shopId} AND n."customerId" = ${input.customerId} AND n."deletedAt" IS NULL
        ) rows`
    case 'sales':
      return Prisma.sql`
        SELECT s."id", s."createdAt" AS occurred_at, 'sale'::text AS kind, d."id" AS reference_id,
               d."model" AS title, c."name" AS subtitle, s."contractCurrency" AS currency,
               s."contractSalePrice" AS amount,
               CASE WHEN s."returnedAt" IS NOT NULL THEN 'RETURNED' WHEN s."paidFully" THEN 'PAID' ELSE 'DEBT' END AS status
        FROM "Sale" s
        JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
        JOIN "Customer" c ON c."id" = s."customerId" AND c."shopId" = s."shopId"
        WHERE s."shopId" = ${input.shopId} AND s."customerId" = ${input.customerId} AND s."deletedAt" IS NULL`
    case 'nasiya':
      return Prisma.sql`
        SELECT n."id", n."createdAt" AS occurred_at, 'nasiya'::text AS kind, n."id" AS reference_id,
               d."model" AS title, concat(n."months", ' oy') AS subtitle, n."contractCurrency" AS currency,
               (n."contractDownPayment" + n."contractFinalAmount") AS amount,
               concat(n."status"::text, ':', n."resolutionState"::text) AS status
        FROM "Nasiya" n JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
        WHERE n."shopId" = ${input.shopId} AND n."customerId" = ${input.customerId} AND n."deletedAt" IS NULL`
    case 'payments':
      return Prisma.sql`
        SELECT concat('sale:', p."id") AS id, p."paidAt" AS occurred_at, 'sale-payment'::text AS kind,
               d."id" AS reference_id, d."model" AS title, p."paymentMethod"::text AS subtitle,
               s."contractCurrency" AS currency,
               coalesce(p."appliedAmountInContractCurrency", CASE
                 WHEN s."contractCurrency" = 'UZS' THEN p."amount"
                 WHEN p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL THEN p."paymentInputAmount"
                 WHEN p."paymentExchangeRate" > 0 THEN p."amount" / p."paymentExchangeRate"
                 ELSE NULL END) AS amount,
               CASE WHEN p."appliedAmountInContractCurrency" IS NULL AND s."contractCurrency" = 'USD'
                 AND NOT coalesce(p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL, FALSE)
                 AND NOT coalesce(p."paymentExchangeRate" > 0, FALSE) THEN 'LEGACY_AMOUNT_UNAVAILABLE' ELSE 'RECORDED' END AS status
        FROM "SalePayment" p
        JOIN "Sale" s ON s."id" = p."saleId" AND s."shopId" = p."shopId"
        JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
        WHERE p."shopId" = ${input.shopId} AND s."customerId" = ${input.customerId} AND p."deletedAt" IS NULL
        UNION ALL
        SELECT concat('nasiya:', p."id"), p."paidAt", 'nasiya-payment', n."id", d."model", p."paymentMethod"::text,
               n."contractCurrency",
               coalesce(p."appliedAmountInContractCurrency", CASE
                 WHEN n."contractCurrency" = 'UZS' THEN p."amount"
                 WHEN p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL THEN p."paymentInputAmount"
                 WHEN p."paymentExchangeRate" > 0 THEN p."amount" / p."paymentExchangeRate"
                 ELSE NULL END),
               CASE WHEN p."appliedAmountInContractCurrency" IS NULL AND n."contractCurrency" = 'USD'
                 AND NOT coalesce(p."paymentInputCurrency" = 'USD' AND p."paymentInputAmount" IS NOT NULL, FALSE)
                 AND NOT coalesce(p."paymentExchangeRate" > 0, FALSE) THEN 'LEGACY_AMOUNT_UNAVAILABLE' ELSE 'RECORDED' END
        FROM "NasiyaPayment" p
        JOIN "Nasiya" n ON n."id" = p."nasiyaId" AND n."shopId" = p."shopId"
        JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
        WHERE p."shopId" = ${input.shopId} AND n."customerId" = ${input.customerId} AND p."deletedAt" IS NULL`
    case 'returns':
      return Prisma.sql`
        SELECT r."id", r."createdAt" AS occurred_at, 'return'::text AS kind, d."id" AS reference_id,
               d."model" AS title, r."note" AS subtitle,
               CASE WHEN r."contractCurrency" = 'USD' AND r."contractRefundAmount" > 0 THEN 'USD'::"CurrencyCode" ELSE 'UZS'::"CurrencyCode" END AS currency,
               CASE WHEN r."contractCurrency" = 'USD' THEN r."contractRefundAmount"
                    WHEN r."contractRefundAmount" > 0 THEN r."contractRefundAmount" ELSE r."refundAmount" END AS amount,
               'RETURNED'::text AS status
        FROM "DeviceReturn" r
        JOIN "Device" d ON d."id" = r."deviceId" AND d."shopId" = r."shopId"
        LEFT JOIN "Sale" s ON s."id" = r."saleId" AND s."shopId" = r."shopId"
        LEFT JOIN "Nasiya" n ON n."id" = r."nasiyaId" AND n."shopId" = r."shopId"
        WHERE r."shopId" = ${input.shopId} AND (s."customerId" = ${input.customerId} OR n."customerId" = ${input.customerId})`
    case 'resolutions':
      return Prisma.sql`
        SELECT e."id", e."createdAt" AS occurred_at, 'resolution'::text AS kind, e."nasiyaId" AS reference_id,
               e."eventType"::text AS title, e."reason" AS subtitle, e."contractCurrency" AS currency,
               e."nativeRemainingAmount" AS amount, concat(e."previousState"::text, ':', e."newState"::text) AS status
        FROM "NasiyaResolutionEvent" e
        JOIN "Nasiya" n ON n."id" = e."nasiyaId" AND n."shopId" = e."shopId"
        WHERE e."shopId" = ${input.shopId} AND n."customerId" = ${input.customerId}`
  }
}

export async function getCustomerProfileHistory(input: {
  shopId: string
  customerId: string
  section: CustomerProfileSection
  page: number
  take?: number
}) {
  const take = Math.min(Math.max(Math.trunc(input.take ?? 20), 1), 50)
  const page = Math.max(Math.trunc(input.page), 1)
  const offset = (page - 1) * take
  const base = historySql(input.section, input)
  const rows = await timeRequestPhase('database', () => prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT customer_scope.customer_marker, bounded_history.*
    FROM (
      SELECT c."id" AS customer_marker
      FROM "Customer" c
      WHERE c."id" = ${input.customerId}
        AND c."shopId" = ${input.shopId}
        AND c."deletedAt" IS NULL
    ) customer_scope
    LEFT JOIN LATERAL (
      SELECT * FROM (${base}) history_rows
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${take + 1} OFFSET ${offset}
    ) bounded_history ON TRUE
  `))
  const boundedRows = rows.filter((row): row is HistoryRow & {
    id: string
    occurred_at: Date
    kind: string
    title: string
  } => row.id !== null && row.occurred_at !== null && row.kind !== null && row.title !== null)
  const hasNext = boundedRows.length > take
  const pageRows = boundedRows.slice(0, take)
  return {
    found: rows.length > 0,
    items: pageRows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      kind: row.kind,
      referenceId: row.reference_id,
      title: row.title,
      subtitle: row.subtitle,
      currency: row.currency,
      amount: row.amount == null ? null : Number(row.amount),
      status: row.status,
    })),
    // Compatibility lower bound for older consumers. It is intentionally not
    // an exact count; take+1 is the only pagination work on the critical path.
    total: offset + pageRows.length + (hasNext ? 1 : 0),
    totalIsExact: false,
    hasNext,
    page,
    take,
  }
}

export type CustomerProfileOverview = NonNullable<Awaited<ReturnType<typeof getCustomerProfileOverview>>>
export type CustomerProfileHistory = Awaited<ReturnType<typeof getCustomerProfileHistory>>
export type CustomerProfileHistoryItem = CustomerProfileHistory['items'][number]
