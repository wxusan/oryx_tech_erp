import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import {
  type CustomerProfileActivityMonth,
  type CustomerProfileAnalytics,
  type CustomerProfileAnalyticsMonths,
  type CustomerProfileDueBuckets,
  type CustomerProfileNativeMoney,
} from '@/lib/customer-profile-analytics'
import { redactShopStaffCustomerProfileAnalytics } from '@/lib/customer-profile-visibility'
import { prisma } from '@/lib/prisma'
import { timeRequestPhase, timeRequestPhaseSync } from '@/lib/server/request-context'
import { tashkentDayRange } from '@/lib/timezone'

interface CustomerProfileAnalyticsRow {
  activity: unknown
  overdue_uzs: unknown
  overdue_usd: unknown
  today_uzs: unknown
  today_usd: unknown
  next_7_uzs: unknown
  next_7_usd: unknown
  days_8_30_uzs: unknown
  days_8_30_usd: unknown
  later_uzs: unknown
  later_usd: unknown
  paid_installments: number
  on_time_installments: number
  late_installments: number
  max_days_late: unknown
  current_overdue_schedules: number
  device_count: number
  sale_count: number
  nasiya_count: number
  active_nasiya_count: number
  completed_nasiya_count: number
  return_count: number
  legacy_usd_payment_count: number
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function nativeMoney(value: unknown): CustomerProfileNativeMoney {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { UZS: numeric(item.UZS), USD: numeric(item.USD) }
}

function activityMonths(value: unknown): CustomerProfileActivityMonth[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.month !== 'string' || !/^\d{4}-\d{2}$/.test(row.month)) return []
    return [{
      month: row.month,
      contracts: nativeMoney(row.contracts),
      payments: nativeMoney(row.payments),
      refunds: nativeMoney(row.refunds),
      writeOffs: nativeMoney(row.writeOffs),
    }]
  })
}

function dueBuckets(row: CustomerProfileAnalyticsRow, currency: 'UZS' | 'USD'): CustomerProfileDueBuckets {
  const suffix = currency.toLowerCase() as 'uzs' | 'usd'
  return {
    overdue: numeric(row[`overdue_${suffix}`]),
    today: numeric(row[`today_${suffix}`]),
    next7Days: numeric(row[`next_7_${suffix}`]),
    days8To30: numeric(row[`days_8_30_${suffix}`]),
    later: numeric(row[`later_${suffix}`]),
  }
}

/**
 * One tenant-scoped statement returns one aggregate record plus at most 24
 * zero-filled Tashkent calendar months. It never hydrates payment/schedule
 * histories and never converts UZS and USD into a mixed total.
 */
export async function getCustomerProfileAnalytics(input: {
  shopId: string
  customerId: string
  months: CustomerProfileAnalyticsMonths
  visibility: { includeOwnerFinancials: boolean }
  now?: Date
}): Promise<CustomerProfileAnalytics | null> {
  const asOf = input.now ?? new Date()
  const day = tashkentDayRange(asOf)
  const next7End = new Date(day.end)
  next7End.setUTCDate(next7End.getUTCDate() + 7)
  const next30End = new Date(day.end)
  next30End.setUTCDate(next30End.getUTCDate() + 30)

  const rows = await timeRequestPhase('database', () => prisma.$queryRaw<CustomerProfileAnalyticsRow[]>(Prisma.sql`
    WITH customer_scope AS (
      SELECT c."id"
      FROM "Customer" c
      WHERE c."id" = ${input.customerId}
        AND c."shopId" = ${input.shopId}
        AND c."deletedAt" IS NULL
    ), sale_base AS (
      SELECT s."id", s."deviceId", s."contractCurrency", s."contractSalePrice",
             s."contractRemainingAmount", s."paidFully", s."dueDate", s."returnedAt", s."createdAt"
      FROM "Sale" s
      JOIN customer_scope c ON c."id" = s."customerId"
      WHERE s."shopId" = ${input.shopId} AND s."deletedAt" IS NULL
    ), nasiya_base AS (
      SELECT n."id", n."deviceId", n."contractCurrency", n."contractDownPayment",
             n."contractFinalAmount", n."contractPaidAmount", n."status", n."resolutionState",
             n."returnedAt", n."isImported", n."createdAt"
      FROM "Nasiya" n
      JOIN customer_scope c ON c."id" = n."customerId"
      WHERE n."shopId" = ${input.shopId} AND n."deletedAt" IS NULL
    ), payments AS (
      SELECT p."paidAt" AS occurred_at, s."contractCurrency" AS currency,
             coalesce(p."appliedAmountInContractCurrency", CASE
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

      SELECT p."paidAt", n."contractCurrency",
             coalesce(p."appliedAmountInContractCurrency", CASE
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
      SELECT s."contractCurrency" AS currency, s."contractRemainingAmount" AS amount, s."dueDate" AS due_at
      FROM sale_base s
      WHERE s."returnedAt" IS NULL
        AND s."paidFully" = FALSE
        AND s."contractRemainingAmount" > 0
        AND s."dueDate" IS NOT NULL

      UNION ALL

      SELECT n."contractCurrency",
             greatest(sc."contractRemainingAmount", 0),
             coalesce(sc."delayedUntil", sc."dueDate")
      FROM "NasiyaSchedule" sc
      JOIN nasiya_base n ON n."id" = sc."nasiyaId" AND n."contractCurrency" = sc."contractCurrency"
      WHERE sc."shopId" = ${input.shopId}
        AND sc."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
        AND n."returnedAt" IS NULL
        AND n."status" <> 'CANCELLED'
        AND n."resolutionState" = 'ACTIVE'
    ), refunds AS (
      SELECT r."createdAt" AS occurred_at,
             CASE
               WHEN r."contractCurrency" = 'USD' AND r."contractRefundAmount" > 0 THEN 'USD'::"CurrencyCode"
               ELSE 'UZS'::"CurrencyCode"
             END AS currency,
             CASE
               WHEN r."contractCurrency" = 'USD' THEN r."contractRefundAmount"
               WHEN r."contractRefundAmount" > 0 THEN r."contractRefundAmount"
               ELSE r."refundAmount"
             END AS amount
      FROM "DeviceReturn" r
      LEFT JOIN sale_base s ON s."id" = r."saleId"
      LEFT JOIN nasiya_base n ON n."id" = r."nasiyaId"
      WHERE r."shopId" = ${input.shopId} AND (s."id" IS NOT NULL OR n."id" IS NOT NULL)
    ), resolution_movement AS (
      SELECT e."createdAt" AS occurred_at, e."contractCurrency" AS currency,
             CASE
               WHEN e."eventType" = 'WRITE_OFF' THEN e."nativeRemainingAmount"
               WHEN e."eventType" = 'REOPEN' AND e."previousState" = 'WRITTEN_OFF' THEN -e."nativeRemainingAmount"
               ELSE 0
             END AS amount
      FROM "NasiyaResolutionEvent" e
      JOIN nasiya_base n ON n."id" = e."nasiyaId"
      WHERE e."shopId" = ${input.shopId}
    ), activity_events AS (
      SELECT s."createdAt" AS occurred_at, 'contracts'::text AS category, s."contractCurrency" AS currency,
             s."contractSalePrice" AS amount
      FROM sale_base s

      UNION ALL

      SELECT n."createdAt", 'contracts', n."contractCurrency",
             CASE
               WHEN n."resolutionState" = 'ARCHIVED' THEN n."contractDownPayment" + n."contractPaidAmount"
               ELSE n."contractDownPayment" + n."contractFinalAmount"
             END
      FROM nasiya_base n
      WHERE n."isImported" = FALSE

      UNION ALL

      SELECT p.occurred_at, 'payments', p.currency, p.amount FROM payments p

      UNION ALL

      SELECT r.occurred_at, 'refunds', r.currency, r.amount FROM refunds r

      UNION ALL

      SELECT e.occurred_at, 'writeOffs', e.currency, e.amount FROM resolution_movement e
    ), months AS (
      SELECT generate_series(
        (date_trunc('month', ${day.dayKey}::date) - ${(input.months - 1)} * interval '1 month')::date,
        date_trunc('month', ${day.dayKey}::date)::date,
        interval '1 month'
      )::date AS month_start
    ), month_values AS (
      SELECT m.month_start,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'contracts' AND e.currency = 'UZS'), 0)::numeric AS contracts_uzs,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'contracts' AND e.currency = 'USD'), 0)::numeric AS contracts_usd,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'payments' AND e.currency = 'UZS'), 0)::numeric AS payments_uzs,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'payments' AND e.currency = 'USD'), 0)::numeric AS payments_usd,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'refunds' AND e.currency = 'UZS'), 0)::numeric AS refunds_uzs,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'refunds' AND e.currency = 'USD'), 0)::numeric AS refunds_usd,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'writeOffs' AND e.currency = 'UZS'), 0)::numeric AS writeoffs_uzs,
        coalesce(sum(e.amount) FILTER (WHERE e.category = 'writeOffs' AND e.currency = 'USD'), 0)::numeric AS writeoffs_usd
      FROM months m
      LEFT JOIN activity_events e
        ON date_trunc('month', e.occurred_at AT TIME ZONE 'Asia/Tashkent')::date
          = m.month_start
      GROUP BY m.month_start
    ), activity_payload AS (
      SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(month_start, 'YYYY-MM'),
        'contracts', jsonb_build_object('UZS', contracts_uzs, 'USD', contracts_usd),
        'payments', jsonb_build_object('UZS', payments_uzs, 'USD', payments_usd),
        'refunds', jsonb_build_object('UZS', refunds_uzs, 'USD', refunds_usd),
        'writeOffs', jsonb_build_object('UZS', writeoffs_uzs, 'USD', writeoffs_usd)
      ) ORDER BY month_start) AS activity
      FROM month_values
    ), discipline AS (
      SELECT
        count(sc."id") FILTER (
          WHERE n."status" <> 'CANCELLED' AND sc."status" = 'PAID' AND sc."paidAt" IS NOT NULL
        )::integer AS paid_installments,
        count(sc."id") FILTER (
          WHERE n."status" <> 'CANCELLED' AND sc."status" = 'PAID' AND sc."paidAt" IS NOT NULL
            AND sc."paidAt" <= coalesce(sc."delayedUntil", sc."dueDate") + interval '1 day'
        )::integer AS on_time_installments,
        count(sc."id") FILTER (
          WHERE n."status" <> 'CANCELLED' AND sc."status" = 'PAID' AND sc."paidAt" IS NOT NULL
            AND sc."paidAt" > coalesce(sc."delayedUntil", sc."dueDate") + interval '1 day'
        )::integer AS late_installments,
        coalesce(max(CASE
          WHEN n."status" <> 'CANCELLED' AND sc."status" = 'PAID' AND sc."paidAt" IS NOT NULL
            AND sc."paidAt" > coalesce(sc."delayedUntil", sc."dueDate") + interval '1 day'
          THEN extract(epoch FROM (sc."paidAt" - coalesce(sc."delayedUntil", sc."dueDate"))) / 86400
          ELSE 0
        END), 0)::numeric AS max_days_late,
        count(sc."id") FILTER (
          WHERE n."status" <> 'CANCELLED' AND n."resolutionState" = 'ACTIVE'
            AND coalesce(sc."delayedUntil", sc."dueDate") < ${day.start}
            AND ((n."contractCurrency" = 'USD' AND sc."contractRemainingAmount" >= 0.01)
              OR (n."contractCurrency" = 'UZS' AND sc."contractRemainingAmount" >= 1))
        )::integer AS current_overdue_schedules
      FROM nasiya_base n
      LEFT JOIN "NasiyaSchedule" sc ON sc."nasiyaId" = n."id" AND sc."shopId" = ${input.shopId}
    )
    SELECT
      activity_payload.activity,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'UZS' AND o.due_at < ${day.start}), 0)::numeric AS overdue_uzs,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'USD' AND o.due_at < ${day.start}), 0)::numeric AS overdue_usd,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'UZS' AND o.due_at >= ${day.start} AND o.due_at < ${day.end}), 0)::numeric AS today_uzs,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'USD' AND o.due_at >= ${day.start} AND o.due_at < ${day.end}), 0)::numeric AS today_usd,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'UZS' AND o.due_at >= ${day.end} AND o.due_at < ${next7End}), 0)::numeric AS next_7_uzs,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'USD' AND o.due_at >= ${day.end} AND o.due_at < ${next7End}), 0)::numeric AS next_7_usd,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'UZS' AND o.due_at >= ${next7End} AND o.due_at < ${next30End}), 0)::numeric AS days_8_30_uzs,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'USD' AND o.due_at >= ${next7End} AND o.due_at < ${next30End}), 0)::numeric AS days_8_30_usd,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'UZS' AND o.due_at >= ${next30End}), 0)::numeric AS later_uzs,
      coalesce(sum(o.amount) FILTER (WHERE o.currency = 'USD' AND o.due_at >= ${next30End}), 0)::numeric AS later_usd,
      discipline.paid_installments,
      discipline.on_time_installments,
      discipline.late_installments,
      discipline.max_days_late,
      discipline.current_overdue_schedules,
      (SELECT count(DISTINCT device_id) FROM (
        SELECT "deviceId" AS device_id FROM sale_base UNION SELECT "deviceId" FROM nasiya_base
      ) devices)::integer AS device_count,
      (SELECT count(*) FROM sale_base)::integer AS sale_count,
      (SELECT count(*) FROM nasiya_base)::integer AS nasiya_count,
      (SELECT count(*) FROM nasiya_base WHERE "status" IN ('ACTIVE', 'OVERDUE') AND "resolutionState" = 'ACTIVE')::integer AS active_nasiya_count,
      (SELECT count(*) FROM nasiya_base WHERE "status" = 'COMPLETED')::integer AS completed_nasiya_count,
      (SELECT count(*) FROM refunds)::integer AS return_count,
      (SELECT count(*) FROM payments WHERE legacy_usd)::integer AS legacy_usd_payment_count
    FROM customer_scope
    CROSS JOIN activity_payload
    CROSS JOIN discipline
    LEFT JOIN obligations o ON TRUE
    GROUP BY activity_payload.activity, discipline.paid_installments, discipline.on_time_installments,
      discipline.late_installments, discipline.max_days_late, discipline.current_overdue_schedules
  `))

  const row = rows[0]
  if (!row) return null

  return timeRequestPhaseSync('dto', () => {
    const paidInstallments = Number(row.paid_installments ?? 0)
    const onTimeInstallments = Number(row.on_time_installments ?? 0)
    const full: CustomerProfileAnalytics = {
      asOf: asOf.toISOString(),
      timezone: 'Asia/Tashkent',
      months: input.months,
      visibility: 'OWNER_FINANCIAL',
      obligations: {
        UZS: dueBuckets(row, 'UZS'),
        USD: dueBuckets(row, 'USD'),
      },
      activity: activityMonths(row.activity),
      discipline: {
        paidInstallments,
        onTimeInstallments,
        lateInstallments: Number(row.late_installments ?? 0),
        onTimeRatio: paidInstallments > 0
          ? Math.round((onTimeInstallments / paidInstallments) * 1000) / 1000
          : null,
        maxDaysLate: Math.round(numeric(row.max_days_late) * 10) / 10,
        currentOverdueSchedules: Number(row.current_overdue_schedules ?? 0),
      },
      counts: {
        devices: Number(row.device_count ?? 0),
        sales: Number(row.sale_count ?? 0),
        nasiyas: Number(row.nasiya_count ?? 0),
        activeNasiyas: Number(row.active_nasiya_count ?? 0),
        completedNasiyas: Number(row.completed_nasiya_count ?? 0),
        returns: Number(row.return_count ?? 0),
      },
      caveats: { legacyUsdPaymentCount: Number(row.legacy_usd_payment_count ?? 0) },
    }

    return input.visibility.includeOwnerFinancials
      ? full
      : redactShopStaffCustomerProfileAnalytics(full)
  })
}
