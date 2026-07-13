import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderGenerationState: {
      upsert: mocks.upsert,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
  },
}))

import {
  acquireReminderGenerationLease,
  checkpointReminderGeneration,
  completeReminderGeneration,
  releaseReminderGenerationLease,
} from '@/lib/server/reminder-generation-state'

const today = new Date('2026-07-13T19:00:00.000Z')
const tomorrow = new Date('2026-07-14T19:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsert.mockResolvedValue(undefined)
  mocks.updateMany.mockResolvedValue({ count: 1 })
})

describe('reminder generation state', () => {
  it('opens an outage catch-up window from completedThrough and initializes the first phase', async () => {
    const completedThrough = new Date('2026-07-10T19:00:00.000Z')
    mocks.findUniqueOrThrow
      .mockResolvedValueOnce({
        completedThrough,
        windowStart: null,
        windowEnd: null,
        phase: null,
        cursor: null,
      })
      .mockResolvedValueOnce({
        completedThrough,
        windowStart: completedThrough,
        windowEnd: tomorrow,
        phase: 'NASIYA_DUE',
        cursor: null,
      })

    const result = await acquireReminderGenerationLease(today, tomorrow)

    expect(result.acquired).toBe(true)
    if (!result.acquired) throw new Error('expected lease')
    expect(result.state).toMatchObject({
      completedThrough,
      windowStart: completedThrough,
      windowEnd: tomorrow,
      phase: 'NASIYA_DUE',
      cursor: null,
    })
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        windowStart: completedThrough,
        windowEnd: tomorrow,
        phase: 'NASIYA_DUE',
        cursor: null,
      }),
    }))
  })

  it('keeps an in-progress phase and cursor when a later invocation resumes', async () => {
    mocks.findUniqueOrThrow.mockResolvedValueOnce({
      completedThrough: today,
      windowStart: today,
      windowEnd: tomorrow,
      phase: 'SALE_OVERDUE',
      cursor: 'sale-100',
    })

    const result = await acquireReminderGenerationLease(today, tomorrow)

    expect(result.acquired).toBe(true)
    if (!result.acquired) throw new Error('expected lease')
    expect(result.state).toMatchObject({ phase: 'SALE_OVERDUE', cursor: 'sale-100' })
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a checkpoint no longer owns the lease', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(checkpointReminderGeneration('lost-token', 'SALE_DUE', 'sale-1'))
      .rejects.toThrow('REMINDER_GENERATION_LEASE_LOST')
  })

  it('advances the watermark only on completion and release preserves progress', async () => {
    await completeReminderGeneration({
      leaseToken: 'lease-1',
      completedThrough: today,
      windowStart: today,
      windowEnd: tomorrow,
      phase: 'SUPPLIER_EARLY',
      cursor: 'payable-9',
    })
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'daily-reminders-v1', leaseToken: 'lease-1' },
      data: {
        completedThrough: tomorrow,
        windowStart: null,
        windowEnd: null,
        phase: null,
        cursor: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })

    await releaseReminderGenerationLease('lease-2')
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'daily-reminders-v1', leaseToken: 'lease-2' },
      data: { leaseToken: null, leaseExpiresAt: null },
    })
  })
})
