import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({ requireApiSession: mocks.requireApiSession }))

beforeEach(() => {
  vi.resetModules()
  mocks.requireApiSession.mockReset()
})

describe('GET /api/auth/validate-session', () => {
  it('returns the role only after the durable session guard succeeds', async () => {
    mocks.requireApiSession.mockResolvedValue({
      ok: true,
      session: { user: { role: 'SHOP_ADMIN' } },
    })
    const { GET } = await import('@/app/api/auth/validate-session/route')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ role: 'SHOP_ADMIN' })
  })

  it('passes through the durable guard rejection for expired or revoked sessions', async () => {
    const rejected = Response.json({ error: 'Sessiya bekor qilingan' }, { status: 401 })
    mocks.requireApiSession.mockResolvedValue({ ok: false, response: rejected })
    const { GET } = await import('@/app/api/auth/validate-session/route')

    expect(await GET()).toBe(rejected)
  })
})
