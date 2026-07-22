import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordOpsEvent } from '@/lib/server/ops-events'

/**
 * Privacy-safe, count-only production signal for the Nasiya ledger.
 *
 * This deliberately returns neither IDs nor money values. The full, reviewed
 * reconciliation command is the place for an operator to inspect a specific
 * contract; the daily cron only needs to say whether a release-time invariant
 * has drifted after deployment.
 */
export interface NasiyaLedgerMonitorSummary {
  status: 'healthy' | 'mismatch' | 'unavailable'
  parentScheduleMismatches: number
  scheduleIntegrityMismatches: number
  terminalStatusMismatches: number
  completeAllocationMismatches: number
  settlementIntegrityMismatches: number
  /** Signals can overlap; this is intentionally not a count of contracts. */
  totalMismatchSignals: number
}

interface CountRow {
  parentScheduleMismatches: number
  scheduleIntegrityMismatches: number
  terminalStatusMismatches: number
  completeAllocationMismatches: number
  settlementIntegrityMismatches: number
}

const unavailable: NasiyaLedgerMonitorSummary = {
  status: 'unavailable',
  parentScheduleMismatches: 0,
  scheduleIntegrityMismatches: 0,
  terminalStatusMismatches: 0,
  completeAllocationMismatches: 0,
  settlementIntegrityMismatches: 0,
  totalMismatchSignals: 0,
}

function count(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid count-only ledger monitor result')
  return parsed
}

/**
 * Best-effort health monitoring. It must never alter a financial row or fail
 * the reminders cron. A mismatch is persisted as a private OpsEvent and can
 * be investigated with the read-only reconciliation command.
 */
export async function monitorNasiyaLedgerIntegrity(): Promise<NasiyaLedgerMonitorSummary> {
  try {
    const [row] = await prisma.$queryRaw<CountRow[]>`
      WITH parent_schedule_mismatches AS (
        SELECT n.id
        FROM "Nasiya" n
        LEFT JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
        WHERE n."deletedAt" IS NULL
        GROUP BY n.id, n."contractFinalAmount", n."contractPaidAmount", n."contractInterestWaivedAmount", n."contractRemainingAmount", n."contractCurrency"
        HAVING COUNT(s.id) = 0
           OR COALESCE(SUM(s."contractExpectedAmount"), 0) <> n."contractFinalAmount"
           OR COALESCE(SUM(s."contractPaidAmount"), 0) <> n."contractPaidAmount"
           OR COALESCE(SUM(s."contractInterestWaivedAmount"), 0) <> n."contractInterestWaivedAmount"
           OR COALESCE(SUM(s."contractRemainingAmount"), 0) <> n."contractRemainingAmount"
           OR COALESCE(SUM(s."contractExpectedAmount"), 0)
                <> COALESCE(SUM(s."contractPaidAmount"), 0)
                  + COALESCE(SUM(s."contractInterestWaivedAmount"), 0)
                  + COALESCE(SUM(s."contractRemainingAmount"), 0)
           OR COALESCE(BOOL_OR(s."contractCurrency" <> n."contractCurrency"), FALSE)
      ),
      schedule_integrity_mismatches AS (
        SELECT s.id
        FROM "NasiyaSchedule" s
        JOIN "Nasiya" n ON n.id = s."nasiyaId"
        WHERE n."deletedAt" IS NULL
          AND (
            s."contractExpectedAmount" <= 0
            OR s."contractPaidAmount" < 0
            OR s."contractInterestWaivedAmount" < 0
            OR s."contractPaidAmount" + s."contractInterestWaivedAmount" > s."contractExpectedAmount"
            OR s."contractRemainingAmount" <> s."contractExpectedAmount" - s."contractPaidAmount" - s."contractInterestWaivedAmount"
            OR (s.status IN ('PAID'::"NasiyaScheduleStatus", 'SETTLED'::"NasiyaScheduleStatus")) <> (s."contractRemainingAmount" = 0)
            OR (s.status = 'SETTLED'::"NasiyaScheduleStatus") <> (s."contractInterestWaivedAmount" > 0)
          )
      ),
      terminal_status_mismatches AS (
        SELECT n.id
        FROM "Nasiya" n
        WHERE n."deletedAt" IS NULL
          AND n.status <> 'CANCELLED'::"NasiyaStatus"
          AND (n.status = 'COMPLETED'::"NasiyaStatus") <> (n."contractRemainingAmount" = 0)
      ),
      complete_allocation_mismatches AS (
        SELECT s.id
        FROM "Nasiya" n
        JOIN "NasiyaSchedule" s ON s."nasiyaId" = n.id
        LEFT JOIN "NasiyaPaymentAllocation" a
          ON a."nasiyaScheduleId" = s.id AND a."nasiyaId" = n.id
        WHERE n."deletedAt" IS NULL
          AND n."accountingReconstructionStatus" = 'COMPLETE'
        GROUP BY s.id, s."contractPaidAmount"
        HAVING COALESCE(SUM(a."contractAmount"), 0) <> s."contractPaidAmount"
      ),
      settlement_integrity_mismatches AS (
        SELECT st.id
        FROM "NasiyaSettlement" st
        JOIN "Nasiya" n ON n.id = st."nasiyaId" AND n."shopId" = st."shopId"
        LEFT JOIN "NasiyaSettlementAllocation" a
          ON a."nasiyaSettlementId" = st.id AND a."shopId" = st."shopId"
        GROUP BY st.id, st.mode, st."contractRemainingBefore", st."contractCashReceivedAmount",
          st."contractInterestWaivedAmount", st."contractRemainingAfter",
          st."cashReceivedAmountUzs", st."interestWaivedAmountUzs",
          n."contractRemainingAmount", n."contractInterestWaivedAmount", n.status
        HAVING st."contractRemainingBefore" <> st."contractCashReceivedAmount" + st."contractInterestWaivedAmount" + st."contractRemainingAfter"
          OR st."contractRemainingAfter" <> 0
          OR (st.mode = 'FULL_WITH_PROFIT'::"NasiyaSettlementMode" AND (st."contractInterestWaivedAmount" <> 0 OR st."contractCashReceivedAmount" <> st."contractRemainingBefore"))
          OR (st.mode = 'WAIVE_REMAINING_PROFIT'::"NasiyaSettlementMode" AND st."contractInterestWaivedAmount" <= 0)
          OR n."contractRemainingAmount" <> 0
          OR n."contractInterestWaivedAmount" <> st."contractInterestWaivedAmount"
          OR n.status <> 'COMPLETED'::"NasiyaStatus"
          OR COALESCE(SUM(a."contractRemainingBefore"), 0) <> st."contractRemainingBefore"
          OR COALESCE(SUM(a."contractCashAmount"), 0) <> st."contractCashReceivedAmount"
          OR COALESCE(SUM(a."contractInterestWaivedAmount"), 0) <> st."contractInterestWaivedAmount"
          OR COALESCE(SUM(a."contractRemainingAfter"), 0) <> st."contractRemainingAfter"
          OR COALESCE(SUM(a."cashAmountUzs"), 0) <> st."cashReceivedAmountUzs"
          OR COALESCE(SUM(a."interestWaivedAmountUzs"), 0) <> st."interestWaivedAmountUzs"
      )
      SELECT
        (SELECT COUNT(*)::integer FROM parent_schedule_mismatches) AS "parentScheduleMismatches",
        (SELECT COUNT(*)::integer FROM schedule_integrity_mismatches) AS "scheduleIntegrityMismatches",
        (SELECT COUNT(*)::integer FROM terminal_status_mismatches) AS "terminalStatusMismatches",
        (SELECT COUNT(*)::integer FROM complete_allocation_mismatches) AS "completeAllocationMismatches",
        (SELECT COUNT(*)::integer FROM settlement_integrity_mismatches) AS "settlementIntegrityMismatches"
    `

    if (!row) throw new Error('missing count-only ledger monitor result')
    const parentScheduleMismatches = count(row.parentScheduleMismatches)
    const scheduleIntegrityMismatches = count(row.scheduleIntegrityMismatches)
    const terminalStatusMismatches = count(row.terminalStatusMismatches)
    const completeAllocationMismatches = count(row.completeAllocationMismatches)
    const settlementIntegrityMismatches = count(row.settlementIntegrityMismatches)
    const totalMismatchSignals = parentScheduleMismatches
      + scheduleIntegrityMismatches
      + terminalStatusMismatches
      + completeAllocationMismatches
      + settlementIntegrityMismatches
    const summary: NasiyaLedgerMonitorSummary = {
      status: totalMismatchSignals === 0 ? 'healthy' : 'mismatch',
      parentScheduleMismatches,
      scheduleIntegrityMismatches,
      terminalStatusMismatches,
      completeAllocationMismatches,
      settlementIntegrityMismatches,
      totalMismatchSignals,
    }

    if (summary.status === 'mismatch') {
      await recordOpsEvent({
        level: 'WARN',
        event: 'currency.nasiya_ledger_mismatch_detected',
        message: 'Nasiya ledger integrity monitor detected mismatch signals',
        status: 'detected',
        metadata: { ...summary },
      })
    }

    return summary
  } catch {
    // Do not leak database errors or financial details into an operational
    // event. The failed check is still visible in the platform logs/OpsEvent.
    await recordOpsEvent({
      level: 'ERROR',
      event: 'currency.nasiya_ledger_monitor_failed',
      message: 'Nasiya ledger integrity monitor failed',
      status: 'unavailable',
      errorCode: 'NASIYA_LEDGER_MONITOR_FAILED',
      metadata: { mode: 'count-only' },
    }).catch(() => undefined)
    return unavailable
  }
}
