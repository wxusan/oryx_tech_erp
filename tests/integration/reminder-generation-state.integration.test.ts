import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import {
  acquireReminderGenerationLease,
  checkpointReminderGeneration,
  completeReminderGeneration,
  releaseReminderGenerationLease,
} from '@/lib/server/reminder-generation-state'
import { tashkentDayRange } from '@/lib/timezone'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }) })

beforeEach(async () => {
  await prisma.reminderGenerationState.deleteMany()
})

afterAll(async () => {
  await prisma.reminderGenerationState.deleteMany()
  await prisma.$disconnect()
})

describe('durable reminder-generation watermark', () => {
  it('serializes workers, resumes phase/cursor, and advances only on completion', async () => {
    const { start: today, end: tomorrow } = tashkentDayRange(new Date('2026-07-13T08:00:00.000Z'))
    const first = await acquireReminderGenerationLease(today, tomorrow)
    expect(first.acquired).toBe(true)
    if (!first.acquired) throw new Error('expected first lease')
    expect(first.state).toMatchObject({
      completedThrough: today,
      windowStart: today,
      windowEnd: tomorrow,
      phase: 'NASIYA_DUE',
      cursor: null,
    })

    await expect(acquireReminderGenerationLease(today, tomorrow)).resolves.toEqual({ acquired: false })

    await checkpointReminderGeneration(first.state.leaseToken, 'SALE_DUE', 'sale-100')
    await releaseReminderGenerationLease(first.state.leaseToken)

    const resumed = await acquireReminderGenerationLease(today, tomorrow)
    expect(resumed.acquired).toBe(true)
    if (!resumed.acquired) throw new Error('expected resumed lease')
    expect(resumed.state).toMatchObject({
      completedThrough: today,
      windowStart: today,
      windowEnd: tomorrow,
      phase: 'SALE_DUE',
      cursor: 'sale-100',
    })

    await completeReminderGeneration(resumed.state)
    const completed = await prisma.reminderGenerationState.findUniqueOrThrow({
      where: { id: 'daily-reminders-v1' },
    })
    expect(completed).toMatchObject({
      completedThrough: tomorrow,
      windowStart: null,
      windowEnd: null,
      phase: null,
      cursor: null,
      leaseToken: null,
    })

    // A later invocation on the same Tashkent day deliberately rescans that
    // day. Unique notification dedupe keys make the rescan safe and it catches
    // debts created after an earlier cron run.
    const sameDay = await acquireReminderGenerationLease(today, tomorrow)
    expect(sameDay.acquired).toBe(true)
    if (!sameDay.acquired) throw new Error('expected same-day lease')
    expect(sameDay.state.windowStart).toEqual(today)
    expect(sameDay.state.windowEnd).toEqual(tomorrow)
    await releaseReminderGenerationLease(sameDay.state.leaseToken)
  })
})
