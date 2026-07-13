import 'server-only'

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'

const STATE_ID = 'daily-reminders-v1'
const LEASE_MS = 55_000

export const REMINDER_GENERATION_PHASES = [
  'NASIYA_DUE',
  'NASIYA_OVERDUE',
  'NASIYA_EARLY',
  'SALE_DUE',
  'SALE_OVERDUE',
  'SALE_EARLY',
  'SUPPLIER_DUE',
  'SUPPLIER_OVERDUE',
  'SUPPLIER_EARLY',
] as const

export type ReminderGenerationPhase = typeof REMINDER_GENERATION_PHASES[number]

export type ReminderGenerationLease = {
  leaseToken: string
  completedThrough: Date
  windowStart: Date
  windowEnd: Date
  phase: ReminderGenerationPhase
  cursor: string | null
}

export async function acquireReminderGenerationLease(
  today: Date,
  tomorrow: Date,
): Promise<{ acquired: true; state: ReminderGenerationLease } | { acquired: false }> {
  await prisma.reminderGenerationState.upsert({
    where: { id: STATE_ID },
    update: {},
    create: { id: STATE_ID, completedThrough: today },
  })

  const now = new Date()
  const leaseToken = randomUUID()
  const claimed = await prisma.reminderGenerationState.updateMany({
    where: {
      id: STATE_ID,
      OR: [{ leaseToken: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: {
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    },
  })
  if (claimed.count !== 1) return { acquired: false }

  let state = await prisma.reminderGenerationState.findUniqueOrThrow({ where: { id: STATE_ID } })
  if (!state.windowStart || !state.windowEnd || !state.phase) {
    // Always rescan the current Tashkent day. Dedupe keys make this cheap and
    // idempotent, while it catches records created after an earlier same-day
    // cron run. An older completedThrough expands this into an outage window.
    const windowStart = state.completedThrough < today ? state.completedThrough : today
    const initialized = await prisma.reminderGenerationState.updateMany({
      where: { id: STATE_ID, leaseToken },
      data: {
        windowStart,
        windowEnd: tomorrow,
        phase: REMINDER_GENERATION_PHASES[0],
        cursor: null,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      },
    })
    if (initialized.count !== 1) return { acquired: false }
    state = await prisma.reminderGenerationState.findUniqueOrThrow({ where: { id: STATE_ID } })
  }

  return {
    acquired: true,
    state: {
      leaseToken,
      completedThrough: state.completedThrough,
      windowStart: state.windowStart!,
      windowEnd: state.windowEnd!,
      phase: state.phase as ReminderGenerationPhase,
      cursor: state.cursor,
    },
  }
}

export async function checkpointReminderGeneration(
  leaseToken: string,
  phase: ReminderGenerationPhase,
  cursor: string | null,
): Promise<void> {
  const updated = await prisma.reminderGenerationState.updateMany({
    where: { id: STATE_ID, leaseToken },
    data: {
      phase,
      cursor,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    },
  })
  if (updated.count !== 1) throw new Error('REMINDER_GENERATION_LEASE_LOST')
}

export async function completeReminderGeneration(lease: ReminderGenerationLease): Promise<void> {
  const updated = await prisma.reminderGenerationState.updateMany({
    where: { id: STATE_ID, leaseToken: lease.leaseToken },
    data: {
      completedThrough: lease.windowEnd,
      windowStart: null,
      windowEnd: null,
      phase: null,
      cursor: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  if (updated.count !== 1) throw new Error('REMINDER_GENERATION_LEASE_LOST')
}

export async function releaseReminderGenerationLease(leaseToken: string): Promise<void> {
  await prisma.reminderGenerationState.updateMany({
    where: { id: STATE_ID, leaseToken },
    data: { leaseToken: null, leaseExpiresAt: null },
  })
}
