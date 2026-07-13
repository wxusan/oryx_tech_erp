import 'server-only'

import { prisma } from '@/lib/prisma'

const CLEANUP_BATCH_SIZE = 10_000
const DAY_MS = 24 * 60 * 60 * 1000

export const DATA_RETENTION_DAYS = {
  notifications: 90,
  opsEvents: 90,
  closedAuthSessions: 30,
  businessAuditLogs: 7 * 365,
} as const

export interface DataRetentionSummary {
  notifications: number
  opsEvents: number
  authSessions: number
  businessAuditLogs: number
}

function cutoff(now: Date, days: number) {
  return new Date(now.getTime() - days * DAY_MS)
}

/**
 * Delete at most one bounded batch per table during the daily operations run.
 * Open/retryable notifications and live sessions are never retention targets.
 * Financial ledgers, return events, payments, and contracts are never deleted.
 */
export async function cleanupRetainedOperationalData(now = new Date()): Promise<DataRetentionSummary> {
  const notificationCutoff = cutoff(now, DATA_RETENTION_DAYS.notifications)
  const opsCutoff = cutoff(now, DATA_RETENTION_DAYS.opsEvents)
  const sessionCutoff = cutoff(now, DATA_RETENTION_DAYS.closedAuthSessions)
  const auditCutoff = cutoff(now, DATA_RETENTION_DAYS.businessAuditLogs)

  const [notifications, opsEvents, authSessions, businessAuditLogs] = await Promise.all([
    prisma.$executeRaw`
      WITH doomed AS (
        SELECT id FROM "Notification"
        WHERE status IN ('SENT', 'CANCELLED')
          AND "createdAt" < ${notificationCutoff}
        ORDER BY "createdAt", id
        LIMIT ${CLEANUP_BATCH_SIZE}
      )
      DELETE FROM "Notification" target
      USING doomed
      WHERE target.id = doomed.id
    `,
    prisma.$executeRaw`
      WITH doomed AS (
        SELECT id FROM "OpsEvent"
        WHERE "createdAt" < ${opsCutoff}
        ORDER BY "createdAt", id
        LIMIT ${CLEANUP_BATCH_SIZE}
      )
      DELETE FROM "OpsEvent" target
      USING doomed
      WHERE target.id = doomed.id
    `,
    prisma.$executeRaw`
      WITH doomed AS (
        SELECT id FROM "AuthSession"
        WHERE (
          "expiresAt" < ${sessionCutoff}
          OR ("revokedAt" IS NOT NULL AND "revokedAt" < ${sessionCutoff})
        )
        ORDER BY "expiresAt", id
        LIMIT ${CLEANUP_BATCH_SIZE}
      )
      DELETE FROM "AuthSession" target
      USING doomed
      WHERE target.id = doomed.id
    `,
    prisma.$executeRaw`
      WITH doomed AS (
        SELECT id FROM "Log"
        WHERE "createdAt" < ${auditCutoff}
        ORDER BY "createdAt", id
        LIMIT ${CLEANUP_BATCH_SIZE}
      )
      DELETE FROM "Log" target
      USING doomed
      WHERE target.id = doomed.id
    `,
  ])

  return { notifications, opsEvents, authSessions, businessAuditLogs }
}
