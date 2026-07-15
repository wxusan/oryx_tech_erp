import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  opsAlertStateUpsert: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    opsAlertState: {
      upsert: mocks.opsAlertStateUpsert,
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}))

import { POST } from '@/app/api/admin/ops/acknowledge/route'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-15T19:00:00.000Z'))
  vi.clearAllMocks()
  mocks.requireSuperAdmin.mockResolvedValue({
    ok: true,
    session: { user: { id: 'super-admin', role: 'SUPER_ADMIN' } },
  })
  mocks.opsAlertStateUpsert.mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/admin/ops/acknowledge', () => {
  it('starts a new alert window without deleting operational history', async () => {
    const response = await POST()
    const json = await response.json()
    const acknowledgedAt = new Date('2026-07-15T19:00:00.000Z')

    expect(response.status).toBe(200)
    expect(json).toMatchObject({ success: true, data: { acknowledgedAt: acknowledgedAt.toISOString() } })
    expect(mocks.opsAlertStateUpsert).toHaveBeenCalledWith({
      where: { id: 'platform' },
      create: {
        id: 'platform',
        alertWindowStartsAt: acknowledgedAt,
        acknowledgedAt,
        acknowledgedById: 'super-admin',
      },
      update: {
        alertWindowStartsAt: acknowledgedAt,
        acknowledgedAt,
        acknowledgedById: 'super-admin',
      },
    })
  })

  it('does not write a new alert boundary when the Super Admin guard denies access', async () => {
    mocks.requireSuperAdmin.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ success: false, error: "Ruxsat yo'q" }, { status: 403 }),
    })

    const response = await POST()

    expect(response.status).toBe(403)
    expect(mocks.opsAlertStateUpsert).not.toHaveBeenCalled()
  })
})
