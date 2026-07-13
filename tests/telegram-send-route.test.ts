import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processPendingNotifications: vi.fn(),
  hasValidInternalSecret: vi.fn(),
  internalSecret: vi.fn(),
  loggerInfo: vi.fn(),
  recordOpsEvent: vi.fn(),
}))

vi.mock('@/lib/notification-service', () => ({
  processPendingNotifications: mocks.processPendingNotifications,
}))

vi.mock('@/lib/api-auth', () => ({
  hasValidInternalSecret: mocks.hasValidInternalSecret,
  internalSecret: mocks.internalSecret,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: mocks.loggerInfo },
}))

vi.mock('@/lib/server/ops-events', () => ({ recordOpsEvent: mocks.recordOpsEvent }))

import { POST } from '@/app/api/telegram/send/route'

const healthySummary = {
  ok: true,
  crashed: false,
  attempted: 1,
  sent: 1,
  sentWithImage: 0,
  imagesRequested: 0,
  imagesSent: 0,
  imagesFailed: 0,
  groupsSent: 0,
  failed: 0,
  cancelled: 0,
  remainingDue: 0,
  retryScheduled: 0,
  processing: 0,
  durationMs: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.internalSecret.mockReturnValue('configured')
  mocks.hasValidInternalSecret.mockReturnValue(true)
  mocks.processPendingNotifications.mockResolvedValue(healthySummary)
})

describe('Telegram queue drain health response', () => {
  it('returns green only when the queue reports complete delivery', async () => {
    const response = await POST(new Request('http://localhost/api/telegram/send', { method: 'POST' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, sent: 1 })
  })

  it('returns 503 when delivery failed or due work remains', async () => {
    mocks.processPendingNotifications.mockResolvedValue({
      ...healthySummary,
      ok: false,
      sent: 0,
      failed: 1,
      remainingDue: 1,
    })

    const response = await POST(new Request('http://localhost/api/telegram/send', { method: 'POST' }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ ok: false, failed: 1, remainingDue: 1 })
  })

  it('returns 500 when the queue processor itself crashed', async () => {
    mocks.processPendingNotifications.mockResolvedValue({
      ...healthySummary,
      ok: false,
      crashed: true,
      sent: 0,
    })

    const response = await POST(new Request('http://localhost/api/telegram/send', { method: 'POST' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ ok: false, crashed: true })
  })
})
