import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transitionFindMany: vi.fn(),
  transitionUpdateMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    telegramDisableTransition: {
      findMany: mocks.transitionFindMany,
      updateMany: mocks.transitionUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}))

import {
  createTelegramDisableTransitionInTransaction,
  processDueTelegramDisableTransitions,
  purgeTelegramIdentityInTransaction,
  TELEGRAM_PURGE_REASON,
} from '@/lib/server/telegram-lifecycle'

function transactionClient() {
  return {
    shopAdmin: {
      findFirst: vi.fn().mockResolvedValue({ telegramId: '700000001' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notification: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    opsEvent: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    telegramDisableTransition: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transitionUpdateMany.mockResolvedValue({ count: 1 })
})

describe('transactional Telegram identity purge', () => {
  it('clears a whole shop and cancels actionable delivery without changing personal flags', async () => {
    const tx = transactionClient()
    await expect(purgeTelegramIdentityInTransaction(
      tx as never,
      { type: 'SHOP', shopId: 'shop-1' },
      { reason: TELEGRAM_PURGE_REASON.PACKAGE_DISABLED, now: new Date('2026-07-18T19:00:00.000Z') },
    )).resolves.toEqual({ identitiesCleared: 1, notificationsCancelled: 2 })

    expect(tx.shopAdmin.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { telegramId: null, telegramVerifiedAt: null },
    }))
    expect(tx.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        lastError: 'Telegram delivery cancelled: telegram_package_disabled',
        recipientUnavailableReason: 'package_not_entitled',
        cancelledAt: new Date('2026-07-18T19:00:00.000Z'),
      }),
    }))
    expect(tx.opsEvent.upsert).not.toHaveBeenCalled()
  })

  it('personal staff disable also turns off the personal allow flag', async () => {
    const tx = transactionClient()
    await purgeTelegramIdentityInTransaction(
      tx as never,
      { type: 'SHOP_ADMIN', shopId: 'shop-1', shopAdminId: 'staff-1' },
      {
        reason: TELEGRAM_PURGE_REASON.STAFF_DISABLED,
        disablePersonalNotifications: true,
      },
    )

    expect(tx.shopAdmin.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        telegramId: null,
        telegramVerifiedAt: null,
        telegramNotificationsEnabled: false,
      },
    }))
  })

  it('stores the safe Tizim source on cancelled rows without an OpsEvent dependency', async () => {
    const tx = transactionClient()

    await purgeTelegramIdentityInTransaction(
      tx as never,
      { type: 'SHOP', shopId: 'shop-1' },
      { reason: TELEGRAM_PURGE_REASON.SHOP_DISABLED },
    )

    expect(tx.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        recipientUnavailableReason: 'shop_disabled',
        cancelledAt: expect.any(Date),
      }),
    }))
    expect(tx.opsEvent.upsert).not.toHaveBeenCalled()
  })

  it('cancels legacy staff rows set-wise without broadening the bound-row filter to the owner', async () => {
    const tx = transactionClient()
    const result = await purgeTelegramIdentityInTransaction(
      tx as never,
      { type: 'SHOP_STAFF', shopId: 'shop-1', ownerAdminId: 'owner-1' },
      { reason: TELEGRAM_PURGE_REASON.ACCOUNT_INACTIVE },
    )

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { recipientShopAdminId: { not: 'owner-1' } },
        ]),
      }),
    }))
    expect(result.notificationsCancelled).toBe(3)
  })
})

describe('durable package-disable transitions', () => {
  it('purges and marks an effective transition in the same transaction', async () => {
    const tx = transactionClient()
    tx.telegramDisableTransition.create.mockResolvedValue({
      id: 'transition-1',
      effectiveOn: new Date('2026-07-18T00:00:00.000Z'),
    })

    const result = await createTelegramDisableTransitionInTransaction(tx as never, {
      packageVersionId: 'package-1',
      shopId: 'shop-1',
      effectiveOn: new Date('2026-07-18T00:00:00.000Z'),
      now: new Date('2026-07-18T19:00:00.000Z'),
    })

    expect(result.processed).toBe(true)
    expect(tx.shopAdmin.updateMany).toHaveBeenCalled()
    expect(tx.telegramDisableTransition.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processedAt: new Date('2026-07-18T19:00:00.000Z') }),
    }))
  })

  it('keeps a future transition pending and does not clear identities early', async () => {
    const tx = transactionClient()
    tx.telegramDisableTransition.create.mockResolvedValue({
      id: 'transition-future',
      effectiveOn: new Date('2026-07-20T00:00:00.000Z'),
    })

    const result = await createTelegramDisableTransitionInTransaction(tx as never, {
      packageVersionId: 'package-future',
      shopId: 'shop-1',
      effectiveOn: new Date('2026-07-20T00:00:00.000Z'),
      now: new Date('2026-07-18T12:00:00.000Z'),
    })

    expect(result).toMatchObject({ processed: false, purge: null })
    expect(tx.shopAdmin.updateMany).not.toHaveBeenCalled()
    expect(tx.telegramDisableTransition.update).not.toHaveBeenCalled()
  })

  it('processes a due transition unconditionally and becomes idempotent after it is locked once', async () => {
    const tx = transactionClient()
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'transition-due' }])
    mocks.transitionFindMany.mockResolvedValue([
      { id: 'transition-due', shopId: 'shop-1' },
      { id: 'transition-already-claimed', shopId: 'shop-1' },
    ])
    mocks.transaction.mockImplementation(async (operation) => operation(tx))

    const result = await processDueTelegramDisableTransitions({
      now: new Date('2026-07-22T19:00:00.000Z'),
      limit: 10,
    })

    expect(result).toMatchObject({ selected: 2, processed: 1, failed: 0, identitiesCleared: 1 })
    expect(tx.shopAdmin.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.telegramDisableTransition.updateMany).toHaveBeenCalledTimes(1)
  })
})
