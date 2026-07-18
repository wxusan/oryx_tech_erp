import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  recordOpsEvent: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  internalSecret: () => 'configured',
  hasValidInternalSecret: () => true,
}))
vi.mock('@/lib/server/telegram-lifecycle', () => ({
  processDueTelegramDisableTransitions: mocks.process,
}))
vi.mock('@/lib/server/ops-events', () => ({ recordOpsEvent: mocks.recordOpsEvent }))
vi.mock('@/lib/server/request-context', () => ({ initializeRequestAuditContext: vi.fn() }))

import { GET } from '@/app/api/cron/telegram-disable-transitions/route'

const fullPage = {
  selected: 100,
  processed: 100,
  failed: 0,
  identitiesCleared: 1,
  notificationsCancelled: 2,
  mayHaveMore: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.recordOpsEvent.mockResolvedValue(undefined)
})

describe('Telegram disable transition cron backlog', () => {
  it('drains more than 100 due transitions across bounded batches', async () => {
    mocks.process
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce({
        selected: 1,
        processed: 1,
        failed: 0,
        identitiesCleared: 0,
        notificationsCancelled: 0,
        mayHaveMore: false,
      })

    const response = await GET(new NextRequest('http://localhost/api/cron/telegram-disable-transitions'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      selected: 101,
      processed: 101,
      batches: 2,
      incomplete: false,
    })
    expect(mocks.process).toHaveBeenCalledTimes(2)
  })

  it('returns non-green when the bounded run still has residual backlog', async () => {
    mocks.process.mockResolvedValue(fullPage)
    const response = await GET(new NextRequest('http://localhost/api/cron/telegram-disable-transitions'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      selected: 1_000,
      processed: 1_000,
      batches: 10,
      incomplete: true,
    })
    expect(mocks.recordOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'cron.telegram_disable.partial',
    }))
  })
})
