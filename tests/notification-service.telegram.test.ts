import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  count: vi.fn(),
  shopAdminFindMany: vi.fn(),
  shopAdminFindFirst: vi.fn(),
  nasiyaScheduleFindFirst: vi.fn(),
  nasiyaDeferralFindFirst: vi.fn(),
  saleFindFirst: vi.fn(),
  supplierPayableFindFirst: vi.fn(),
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
  sendMediaGroup: vi.fn(),
  resolveImageKeys: vi.fn(),
  resolveImageUrls: vi.fn(),
  recordOpsEvent: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      update: mocks.update,
      create: mocks.create,
      count: mocks.count,
    },
    shopAdmin: { findMany: mocks.shopAdminFindMany, findFirst: mocks.shopAdminFindFirst },
    nasiyaSchedule: { findFirst: mocks.nasiyaScheduleFindFirst },
    nasiyaDeferral: { findFirst: mocks.nasiyaDeferralFindFirst },
    sale: { findFirst: mocks.saleFindFirst },
    supplierPayable: { findFirst: mocks.supplierPayableFindFirst },
  },
}))

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: mocks.sendMessage,
  sendTelegramPhoto: mocks.sendPhoto,
  sendTelegramMediaGroup: mocks.sendMediaGroup,
}))

vi.mock('@/lib/server/notification-image', () => ({
  resolveNotificationImageKeys: mocks.resolveImageKeys,
  resolveNotificationImageUrls: mocks.resolveImageUrls,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/server/ops-events', () => ({ recordOpsEvent: mocks.recordOpsEvent }))

import { processPendingNotifications } from '@/lib/notification-service'
import { TELEGRAM_CAPTION_LIMIT } from '@/lib/telegram-delivery'

type TestNotification = {
  id: string
  shopId: string
  dedupeKey: string | null
  type: string
  message: string
  telegramId: string
  recipientShopAdminId: string | null
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED'
  scheduledAt: Date
  sentAt: Date | null
  attemptCount: number
  lastAttemptAt: Date | null
  nextAttemptAt: Date | null
  lastError: string | null
  relatedId: string | null
  relatedType: string | null
  mediaKeys: string[]
  mediaSentPositions: number[]
  mediaSnapshotAt: Date | null
  textSentAt: Date | null
  createdAt: Date
}

let notification: TestNotification

function makeNotification(imageCount: number, message = 'Qurilma sotildi'): TestNotification {
  const now = new Date('2026-07-12T08:00:00.000Z')
  return {
    id: 'notification-1',
    shopId: 'shop-1',
    dedupeKey: null,
    type: 'SALE',
    message,
    telegramId: '123456789',
    recipientShopAdminId: 'admin-1',
    status: 'PENDING',
    scheduledAt: now,
    sentAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
    relatedId: 'device-1',
    relatedType: 'Device',
    mediaKeys: Array.from({ length: imageCount }, (_, index) => `shop-1/device-${index}.jpg`),
    mediaSentPositions: [],
    mediaSnapshotAt: now,
    textSentAt: null,
    createdAt: now,
  }
}

function applyUpdate(data: Record<string, unknown>) {
  const mediaProgress = data.mediaSentPositions as { push?: number[] } | undefined
  if (mediaProgress?.push) notification.mediaSentPositions.push(...mediaProgress.push)
  for (const [key, value] of Object.entries(data)) {
    if (key === 'mediaSentPositions') continue
    ;(notification as unknown as Record<string, unknown>)[key] = value
  }
  return notification
}

beforeEach(() => {
  vi.clearAllMocks()
  notification = makeNotification(0)
  mocks.findMany.mockImplementation(async () => [notification])
  mocks.count.mockResolvedValue(0)
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => applyUpdate(data))
  mocks.resolveImageKeys.mockImplementation(async () => notification.mediaKeys)
  mocks.resolveImageUrls.mockImplementation(async (_shopId: string, keys: string[], positions: number[]) => (
    positions.map((position) => ({ position, key: keys[position], imageUrl: `https://signed.example/${position}` }))
  ))
  mocks.sendMessage.mockResolvedValue({ ok: true })
  mocks.sendPhoto.mockResolvedValue({ ok: true })
  mocks.sendMediaGroup.mockResolvedValue({ ok: true })
  mocks.shopAdminFindFirst.mockResolvedValue({
    id: 'admin-1',
    telegramId: '123456789',
    shop: {
      ownerAdminId: 'admin-1',
      telegramNotificationsEnabled: true,
      packageVersions: [{ features: [
        { featureCode: 'TELEGRAM', enabled: true },
        { featureCode: 'REMINDERS', enabled: true },
        { featureCode: 'STAFF_ACCESS', enabled: true },
      ] }],
    },
  })
  mocks.nasiyaDeferralFindFirst.mockResolvedValue(null)
  mocks.recordOpsEvent.mockResolvedValue(undefined)
})

describe('Telegram notification delivery', () => {
  it('drains another batch when the first 100 due notifications fill the batch', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({ ...makeNotification(0), id: `notification-${index}` }))
    const finalNotification = { ...makeNotification(0), id: 'notification-100' }
    mocks.findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce([finalNotification])

    const result = await processPendingNotifications()

    expect(result.attempted).toBe(101)
    expect(result.sent).toBe(101)
    expect(mocks.findMany).toHaveBeenCalledTimes(2)
  })

  it('keeps scheduledAt and retry eligibility in the atomic claim predicate', async () => {
    await processPendingNotifications()

    const claimWhere = mocks.updateMany.mock.calls[0]?.[0]?.where
    expect(claimWhere).toMatchObject({ id: notification.id })
    expect(claimWhere.OR[0]).toMatchObject({
      status: { in: ['PENDING', 'FAILED'] },
      scheduledAt: { lte: expect.any(Date) },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }],
    })
    expect(claimWhere.OR[1]).toMatchObject({
      status: 'PROCESSING',
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: expect.any(Date) } }],
    })
  })

  it.each([0, 1, 2, 10, 11])('delivers all %i images through the real processor plan', async (imageCount) => {
    notification = makeNotification(imageCount)

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ attempted: 1, sent: 1, imagesRequested: imageCount, imagesSent: imageCount, imagesFailed: 0 })
    expect(notification.status).toBe('SENT')
    expect(notification.textSentAt).toBeInstanceOf(Date)
    expect(notification.mediaSentPositions).toEqual(Array.from({ length: imageCount }, (_, index) => index))

    if (imageCount === 0) {
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
      expect(mocks.sendPhoto).not.toHaveBeenCalled()
      expect(mocks.sendMediaGroup).not.toHaveBeenCalled()
    } else if (imageCount === 1) {
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(mocks.sendPhoto).toHaveBeenCalledWith('123456789', 'https://signed.example/0', 'Qurilma sotildi')
      expect(mocks.sendMediaGroup).not.toHaveBeenCalled()
    } else if (imageCount <= 10) {
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(mocks.sendPhoto).not.toHaveBeenCalled()
      expect(mocks.sendMediaGroup).toHaveBeenCalledTimes(1)
      expect(mocks.sendMediaGroup.mock.calls[0]?.[1]).toHaveLength(imageCount)
      expect(mocks.sendMediaGroup.mock.calls[0]?.[2]).toBe('Qurilma sotildi')
    } else {
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(mocks.sendMediaGroup).toHaveBeenCalledTimes(1)
      expect(mocks.sendMediaGroup.mock.calls[0]?.[1]).toHaveLength(10)
      expect(mocks.sendMediaGroup.mock.calls[0]?.[2]).toBe('Qurilma sotildi')
      expect(mocks.sendPhoto).toHaveBeenCalledWith('123456789', 'https://signed.example/10', undefined)
    }
  })

  it('does not duplicate a short business message when a later media chunk fails', async () => {
    notification = makeNotification(11)
    mocks.sendPhoto.mockResolvedValueOnce({ ok: false, description: 'temporary photo failure' })

    const firstRun = await processPendingNotifications()

    expect(firstRun).toMatchObject({ failed: 1, imagesSent: 10, imagesFailed: 1 })
    expect(notification.status).toBe('FAILED')
    expect(notification.textSentAt).toBeInstanceOf(Date)
    expect(notification.mediaSentPositions).toEqual(Array.from({ length: 10 }, (_, index) => index))
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now())

    mocks.sendPhoto.mockResolvedValueOnce({ ok: true })
    const secondRun = await processPendingNotifications()

    expect(secondRun).toMatchObject({ sent: 1, imagesRequested: 1, imagesSent: 1 })
    expect(mocks.sendMediaGroup).toHaveBeenCalledTimes(1)
    expect(mocks.sendPhoto).toHaveBeenCalledTimes(2)
    expect(mocks.sendPhoto.mock.calls[1]?.[2]).toBeUndefined()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.mediaSentPositions).toEqual(Array.from({ length: 11 }, (_, index) => index))
    expect(notification.status).toBe('SENT')
  })

  it('does not resend a long standalone message after media delivery partially fails', async () => {
    const longMessage = 'x'.repeat(TELEGRAM_CAPTION_LIMIT + 1)
    notification = makeNotification(2, longMessage)
    mocks.sendMediaGroup.mockResolvedValueOnce({ ok: false, description: 'temporary album failure' })

    await processPendingNotifications()

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendMessage).toHaveBeenCalledWith('123456789', longMessage)
    expect(notification.textSentAt).toBeInstanceOf(Date)
    expect(notification.status).toBe('FAILED')

    mocks.sendMediaGroup.mockResolvedValueOnce({ ok: true })
    await processPendingNotifications()

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendMediaGroup).toHaveBeenCalledTimes(2)
    expect(mocks.sendMediaGroup.mock.calls[1]?.[2]).toBeUndefined()
    expect(notification.status).toBe('SENT')
  })

  it('falls back to text once when the first captioned album fails, then retries media without a caption', async () => {
    notification = makeNotification(2)
    mocks.sendMediaGroup.mockResolvedValueOnce({ ok: false, description: 'temporary album failure' })

    await processPendingNotifications()

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendMessage).toHaveBeenCalledWith('123456789', 'Qurilma sotildi')
    expect(notification.textSentAt).toBeInstanceOf(Date)
    expect(notification.status).toBe('FAILED')

    mocks.sendMediaGroup.mockResolvedValueOnce({ ok: true })
    await processPendingNotifications()

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendMediaGroup).toHaveBeenCalledTimes(2)
    expect(mocks.sendMediaGroup.mock.calls[1]?.[2]).toBeUndefined()
    expect(notification.status).toBe('SENT')
  })

  it('does not immediately send a text-only notification twice after Telegram 429', async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: 429,
      description: 'Too Many Requests',
      retryAfterSeconds: 7,
    })

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, attempted: 1, sent: 0, failed: 1, cancelled: 0 })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(notification.status).toBe('FAILED')
    expect(notification.nextAttemptAt).toBeInstanceOf(Date)
  })

  it.each([400, 401, 403])('cancels permanent Telegram %i failures without retrying', async (errorCode) => {
    mocks.sendMessage.mockResolvedValueOnce({ ok: false, errorCode, description: `Telegram ${errorCode}` })

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, failed: 0, cancelled: 1 })
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(notification.status).toBe('CANCELLED')
    expect(notification.nextAttemptAt).toBeNull()
  })

  it('cancels before external delivery when the queued recipient is no longer authorized', async () => {
    mocks.shopAdminFindFirst.mockResolvedValueOnce(null)

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, attempted: 1, sent: 0, cancelled: 1 })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.status).toBe('CANCELLED')
    expect(notification.lastError).toContain('recipient_revoked_or_unverified')
  })

  it('cancels queued staff delivery when STAFF_ACCESS is no longer entitled', async () => {
    mocks.shopAdminFindFirst.mockResolvedValueOnce({
      id: 'staff-1',
      telegramId: '123456789',
      shop: {
        ownerAdminId: 'owner-1',
        telegramNotificationsEnabled: true,
        packageVersions: [{ features: [
          { featureCode: 'TELEGRAM', enabled: true },
          { featureCode: 'STAFF_ACCESS', enabled: false },
        ] }],
      },
    })

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ sent: 0, cancelled: 1 })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.lastError).toContain('recipient_not_entitled_or_notifications_disabled')
    expect(mocks.shopAdminFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { telegramNotificationsEnabled: true },
      select: { shop: { select: { telegramNotificationsEnabled: true } } },
    })
  })

  it('cancels a queued sale reminder after its debt has been resolved', async () => {
    notification = {
      ...makeNotification(0),
      type: 'SALE_REMINDER',
      relatedType: 'Sale',
      relatedId: 'sale-1',
    }
    mocks.saleFindFirst.mockResolvedValueOnce({
      paidFully: true,
      remainingAmount: 0,
      contractRemainingAmount: 0,
      reminderEnabled: true,
      returnedAt: null,
      deletedAt: null,
      payments: [],
    })

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, sent: 0, cancelled: 1 })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.lastError).toContain('debt_resolved_or_changed')
  })

  it('cancels an otherwise-active reminder when a newer partial payment made its message stale', async () => {
    notification = {
      ...makeNotification(0),
      type: 'SALE_REMINDER',
      relatedType: 'Sale',
      relatedId: 'sale-1',
    }
    mocks.saleFindFirst.mockResolvedValueOnce({
      paidFully: false,
      remainingAmount: 500_000,
      contractRemainingAmount: 500_000,
      reminderEnabled: true,
      returnedAt: null,
      deletedAt: null,
      payments: [{ id: 'newer-payment' }],
    })

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, sent: 0, cancelled: 1 })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.lastError).toContain('debt_resolved_or_changed')
  })

  it.each(['ARCHIVED', 'WRITTEN_OFF'] as const)(
    'cancels a queued Nasiya reminder after the contract becomes %s',
    async (resolutionState) => {
      notification = {
        ...makeNotification(0),
        type: 'OVERDUE',
        relatedType: 'NasiyaSchedule',
        relatedId: 'schedule-1',
      }
      mocks.nasiyaScheduleFindFirst.mockResolvedValueOnce({
        status: 'OVERDUE',
        expectedAmount: 1_000,
        paidAmount: 0,
        contractRemainingAmount: 1_000,
        payments: [],
        nasiya: {
          status: 'OVERDUE',
          resolutionState,
          reminderEnabled: true,
          remainingAmount: 1_000,
          contractRemainingAmount: 1_000,
          returnedAt: null,
          deletedAt: null,
        },
      })

      const result = await processPendingNotifications()

      expect(result).toMatchObject({ sent: 0, cancelled: 1 })
      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(notification.lastError).toContain('debt_resolved_or_changed')
    },
  )

  it('cancels a queued Nasiya reminder after a newer deferral changes the effective due date', async () => {
    notification = {
      ...makeNotification(0),
      type: 'OVERDUE',
      relatedType: 'NasiyaSchedule',
      relatedId: 'schedule-1',
    }
    mocks.nasiyaScheduleFindFirst.mockResolvedValueOnce({
      status: 'DEFERRED',
      expectedAmount: 1_000,
      paidAmount: 0,
      contractRemainingAmount: 1_000,
      payments: [],
      nasiya: {
        status: 'ACTIVE',
        resolutionState: 'ACTIVE',
        reminderEnabled: true,
        remainingAmount: 1_000,
        contractRemainingAmount: 1_000,
        returnedAt: null,
        deletedAt: null,
      },
    })
    mocks.nasiyaDeferralFindFirst.mockResolvedValueOnce({ id: 'newer-deferral' })

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ sent: 0, cancelled: 1 })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(notification.lastError).toContain('debt_resolved_or_changed')
  })

  it('reports a queue-level crash as non-green even if failure telemetry also fails', async () => {
    mocks.findMany.mockRejectedValueOnce(new Error('database unavailable'))
    mocks.recordOpsEvent.mockRejectedValueOnce(new Error('ops database unavailable'))

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, crashed: true, sent: 0, failed: 0 })
  })

  it('does not report green while a previously claimed row is still PROCESSING', async () => {
    mocks.findMany.mockResolvedValueOnce([])
    mocks.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)

    const result = await processPendingNotifications()

    expect(result).toMatchObject({ ok: false, crashed: false, processing: 1 })
  })
})
