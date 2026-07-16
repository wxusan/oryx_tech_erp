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
  /** Signals can overlap; this is intentionally not a count of contracts. */
  totalMismatchSignals: number
}

interface CountRow {
  parentScheduleMismatches: number
  scheduleIntegrityMismatches: number
  terminalStatusMismatches: number
  completeAllocationMismatches: number
}

const unavailable: NasiyaLedgerMonitorSummary = {
  status: 'unavailable',
  parentScheduleMismatches: 0,
  scheduleIntegrityMismatches: 0,
  terminalStatusMismatches: 0,
  completeAllocationMismatches: 0,
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
        GROUP BY n.id, n."contractFinalAmount", n."contractPaidAmount", n."contractRemainingAmount", n."contractCurrency"
        HAVING COUNT(s.id) = 0
           OR COALESCE(SUM(s."contractExpectedAmount"), 0) <> n."contractFinalAmount"
           OR COALESCE(SUM(s."contractPaidAmount"), 0) <> n."contractPaidAmount"
           OR COALESCE(SUM(s."contractRemainingAmount"), 0) <> n."contractRemainingAmount"
           OR COALESCE(SUM(s."contractExpectedAmount"), 0)
                <> COALESCE(SUM(s."contractPaidAmount"), 0) + COALESCE(SUM(s."contractRemainingAmount"), 0)
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
            OR s."contractPaidAmount" > s."contractExpectedAmount"
            OR s."contractRemainingAmount" <> s."contractExpectedAmount" - s."contractPaidAmount"
            OR (s.status = 'PAID'::"NasiyaScheduleStatus") <> (s."contractRemainingAmount" = 0)
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
      )
      SELECT
        (SELECT COUNT(*)::integer FROM parent_schedule_mismatches) AS "parentScheduleMismatches",
        (SELECT COUNT(*)::integer FROM schedule_integrity_mismatches) AS "scheduleIntegrityMismatches",
        (SELECT COUNT(*)::integer FROM terminal_status_mismatches) AS "terminalStatusMismatches",
        (SELECT COUNT(*)::integer FROM complete_allocation_mismatches) AS "completeAllocationMismatches"
    `

    if (!row) throw new Error('missing count-only ledger monitor result')
    const parentScheduleMismatches = count(row.parentScheduleMismatches)
    const scheduleIntegrityMismatches = count(row.scheduleIntegrityMismatches)
    const terminalStatusMismatches = count(row.terminalStatusMismatches)
    const completeAllocationMismatches = count(row.completeAllocationMismatches)
    const totalMismatchSignals = parentScheduleMismatches
      + scheduleIntegrityMismatches
      + terminalStatusMismatches
      + completeAllocationMismatches
    const summary: NasiyaLedgerMonitorSummary = {
      status: totalMismatchSignals === 0 ? 'healthy' : 'mismatch',
      parentScheduleMismatches,
      scheduleIntegrityMismatches,
      terminalStatusMismatches,
      completeAllocationMismatches,
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
