import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = vi.hoisted(() => ({
  nasiyaSchedule: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  nasiya: { updateMany: vi.fn() },
  notification: { upsert: vi.fn() },
  changeEvent: { create: vi.fn() },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}))

import { transitionNasiyaToOverdue } from '@/lib/server/overdue-transition'

const cutoff = new Date('2026-07-13T00:00:00.000Z')

describe('transitionNasiyaToOverdue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.nasiyaSchedule.updateMany.mockResolvedValue({ count: 1 })
    tx.nasiya.updateMany.mockResolvedValue({ count: 1 })
    tx.notification.upsert.mockResolvedValue({})
    tx.changeEvent.create.mockResolvedValue({})
  })

  it('does nothing when the effective due date is not before the supplied day boundary', async () => {
    tx.nasiyaSchedule.updateMany.mockResolvedValue({ count: 0 })
    tx.nasiyaSchedule.findFirst.mockResolvedValue(null)

    const changed = await transitionNasiyaToOverdue({
      scheduleId: 'schedule-1',
      nasiyaId: 'nasiya-1',
      shopId: 'shop-1',
      overdueBefore: cutoff,
      notifications: [{
        dedupeKey: 'OVERDUE:future',
        message: 'future',
        telegramId: '123',
        recipientShopAdminId: 'admin-1',
        scheduledAt: cutoff,
      }],
    })

    expect(changed).toBe(false)
    expect(tx.nasiyaSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'schedule-1',
        nasiyaId: 'nasiya-1',
        shopId: 'shop-1',
        OR: [
          { delayedUntil: null, dueDate: { lt: cutoff } },
          { delayedUntil: { lt: cutoff } },
        ],
      }),
    }))
    expect(tx.notification.upsert).not.toHaveBeenCalled()
    expect(tx.nasiya.updateMany).not.toHaveBeenCalled()
    expect(tx.changeEvent.create).not.toHaveBeenCalled()
  })

  it('atomically queues notifications and changes only an active, genuinely overdue contract', async () => {
    const changed = await transitionNasiyaToOverdue({
      scheduleId: 'schedule-1',
      nasiyaId: 'nasiya-1',
      shopId: 'shop-1',
      overdueBefore: cutoff,
      notifications: [{
        dedupeKey: 'OVERDUE:past',
        message: 'past',
        telegramId: '123',
        recipientShopAdminId: 'admin-1',
        scheduledAt: cutoff,
      }],
    })

    expect(changed).toBe(true)
    expect(tx.notification.upsert).toHaveBeenCalledTimes(1)
    expect(tx.nasiyaSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'schedule-1',
        nasiyaId: 'nasiya-1',
        shopId: 'shop-1',
        status: { not: 'CANCELLED' },
        contractRemainingAmount: { gt: 0 },
      }),
      data: { status: 'OVERDUE' },
    }))
    expect(tx.nasiya.updateMany).toHaveBeenCalledWith({
      where: { id: 'nasiya-1', shopId: 'shop-1', status: { not: 'CANCELLED' }, resolutionState: 'ACTIVE', deletedAt: null },
      data: { status: 'OVERDUE' },
    })
    expect(tx.changeEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mutationKind: 'nasiya.overdue' }),
    }))
  })

  it('still changes overdue status when Telegram reminders are disabled', async () => {
    expect(await transitionNasiyaToOverdue({
      scheduleId: 'schedule-1',
      nasiyaId: 'nasiya-1',
      shopId: 'shop-1',
      overdueBefore: cutoff,
      notifications: [],
    })).toBe(true)

    expect(tx.notification.upsert).not.toHaveBeenCalled()
    expect(tx.nasiyaSchedule.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.nasiya.updateMany).toHaveBeenCalledTimes(1)
  })

  it('preserves chronic overdue alerts without rewriting already-overdue state', async () => {
    tx.nasiyaSchedule.updateMany.mockResolvedValue({ count: 0 })
    tx.nasiyaSchedule.findFirst.mockResolvedValue({ id: 'schedule-1' })
    tx.nasiya.updateMany.mockResolvedValue({ count: 0 })

    expect(await transitionNasiyaToOverdue({
      scheduleId: 'schedule-1',
      nasiyaId: 'nasiya-1',
      shopId: 'shop-1',
      overdueBefore: cutoff,
      notifications: [{ dedupeKey: 'OVERDUE:again', message: 'again', telegramId: '123', recipientShopAdminId: 'admin-1', scheduledAt: cutoff }],
    })).toBe(false)

    expect(tx.notification.upsert).toHaveBeenCalledTimes(1)
    expect(tx.changeEvent.create).not.toHaveBeenCalled()
  })
})
