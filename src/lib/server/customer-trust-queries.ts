import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { CustomerTrustFactors } from '@/lib/nasiya-customer-trust'
import { tashkentDayRange } from '@/lib/timezone'

interface CustomerTrustAggregateRow {
  customer_id: string
  total_nasiya_count: number
  completed_nasiya_count: number
  settled_with_waiver_count: number
  active_nasiya_count: number
  cancelled_nasiya_count: number
  paid_installment_count: number
  on_time_count: number
  late_installment_count: number
  max_days_late: unknown
  current_overdue_schedule_count: number
}

/**
 * One bounded row per already-paginated customer. This preserves the exact
 * trust policy while avoiding transfer/hydration of every historical Nasiya
 * and schedule merely to display a list badge.
 */
export async function getCustomerTrustFactorsForList(input: {
  shopId: string
  customerIds: string[]
  now?: Date
}): Promise<Map<string, CustomerTrustFactors>> {
  if (input.customerIds.length === 0) return new Map()

  const todayStart = tashkentDayRange(input.now ?? new Date()).start
  const rows = await prisma.$queryRaw<CustomerTrustAggregateRow[]>(Prisma.sql`
    SELECT
      c."id" AS customer_id,
      count(DISTINCT n."id")::integer AS total_nasiya_count,
      count(DISTINCT n."id") FILTER (
        WHERE n."status" = 'COMPLETED' AND n."contractInterestWaivedAmount" = 0
      )::integer AS completed_nasiya_count,
      count(DISTINCT n."id") FILTER (
        WHERE n."contractInterestWaivedAmount" > 0
      )::integer AS settled_with_waiver_count,
      count(DISTINCT n."id") FILTER (
        WHERE n."status" IN ('ACTIVE', 'OVERDUE') AND n."resolutionState" = 'ACTIVE'
      )::integer AS active_nasiya_count,
      count(DISTINCT n."id") FILTER (WHERE n."status" = 'CANCELLED')::integer AS cancelled_nasiya_count,
      count(s."id") FILTER (
        WHERE n."status" <> 'CANCELLED' AND s."status" = 'PAID' AND s."paidAt" IS NOT NULL
      )::integer AS paid_installment_count,
      count(s."id") FILTER (
        WHERE n."status" <> 'CANCELLED'
          AND s."status" = 'PAID'
          AND s."paidAt" IS NOT NULL
          AND s."paidAt" <= coalesce(s."delayedUntil", s."dueDate") + interval '1 day'
      )::integer AS on_time_count,
      count(s."id") FILTER (
        WHERE n."status" <> 'CANCELLED'
          AND s."status" = 'PAID'
          AND s."paidAt" IS NOT NULL
          AND s."paidAt" > coalesce(s."delayedUntil", s."dueDate") + interval '1 day'
      )::integer AS late_installment_count,
      coalesce(max(
        CASE
          WHEN n."status" <> 'CANCELLED'
            AND s."status" = 'PAID'
            AND s."paidAt" IS NOT NULL
            AND s."paidAt" > coalesce(s."delayedUntil", s."dueDate") + interval '1 day'
          THEN extract(epoch FROM (s."paidAt" - coalesce(s."delayedUntil", s."dueDate"))) / 86400
          ELSE 0
        END
      ), 0)::numeric AS max_days_late,
      count(s."id") FILTER (
        WHERE n."status" <> 'CANCELLED'
          AND n."resolutionState" = 'ACTIVE'
          AND coalesce(s."delayedUntil", s."dueDate") < ${todayStart}
          AND (
            (n."contractCurrency" = 'USD'
              AND s."contractRemainingAmount" >= 0.01)
            OR
            (n."contractCurrency" = 'UZS'
              AND s."contractRemainingAmount" >= 1)
          )
      )::integer AS current_overdue_schedule_count
    FROM "Customer" c
    LEFT JOIN "Nasiya" n
      ON n."customerId" = c."id"
      AND n."shopId" = c."shopId"
      AND n."deletedAt" IS NULL
    LEFT JOIN "NasiyaSchedule" s
      ON s."nasiyaId" = n."id"
      AND s."shopId" = n."shopId"
    WHERE c."shopId" = ${input.shopId}
      AND c."deletedAt" IS NULL
      AND c."id" IN (${Prisma.join(input.customerIds)})
    GROUP BY c."id"
  `)

  return new Map(rows.map((row) => {
    const paidInstallmentCount = Number(row.paid_installment_count ?? 0)
    const onTimeCount = Number(row.on_time_count ?? 0)
    const currentOverdueScheduleCount = Number(row.current_overdue_schedule_count ?? 0)
    const factors: CustomerTrustFactors = {
      totalNasiyaCount: Number(row.total_nasiya_count ?? 0),
      completedNasiyaCount: Number(row.completed_nasiya_count ?? 0),
      settledWithWaiverCount: Number(row.settled_with_waiver_count ?? 0),
      activeNasiyaCount: Number(row.active_nasiya_count ?? 0),
      cancelledNasiyaCount: Number(row.cancelled_nasiya_count ?? 0),
      paidInstallmentCount,
      onTimeRatio:
        paidInstallmentCount > 0
          ? Math.round((onTimeCount / paidInstallmentCount) * 1000) / 1000
          : null,
      lateInstallmentCount: Number(row.late_installment_count ?? 0),
      maxDaysLate: Math.round(Number(row.max_days_late ?? 0) * 10) / 10,
      currentOverdueScheduleCount,
      hasCurrentOverdue: currentOverdueScheduleCount > 0,
    }
    return [row.customer_id, factors]
  }))
}
