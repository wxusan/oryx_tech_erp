import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  shopAdminFindMany: vi.fn(),
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
    },
    shopAdmin: { findMany: mocks.shopAdminFindMany },
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
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => applyUpdate(data))
  mocks.resolveImageKeys.mockImplementation(async () => notification.mediaKeys)
  mocks.resolveImageUrls.mockImplementation(async (_shopId: string, keys: string[], positions: number[]) => (
    positions.map((position) => ({ position, key: keys[position], imageUrl: `https://signed.example/${position}` }))
  ))
  mocks.sendMessage.mockResolvedValue({ ok: true })
  mocks.sendPhoto.mockResolvedValue({ ok: true })
  mocks.sendMediaGroup.mockResolvedValue({ ok: true })
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
})
