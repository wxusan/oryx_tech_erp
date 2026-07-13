import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { opsEvent: { create: mocks.create } } }))

import { recordOpsEvent } from '@/lib/server/ops-events'

describe('persistent operations-event redaction', () => {
  beforeEach(() => {
    mocks.create.mockReset()
    mocks.create.mockResolvedValue({ id: 'event-1' })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  it('redacts signed URLs from the database message and metadata', async () => {
    await recordOpsEvent({
      event: 'upload.failed',
      message: 'failed https://example.test/private/a.jpg?token=message-secret',
      metadata: { detail: 'url https://example.test/private/b.jpg?X-Amz-Signature=metadata-secret' },
    })

    const data = mocks.create.mock.calls[0]?.[0]?.data as {
      message: string
      metadata: { detail: string }
    }
    expect(data.message).toBe('failed https://example.test/private/a.jpg?[redacted]')
    expect(data.metadata.detail).toBe('url https://example.test/private/b.jpg?[redacted]')
  })
})
