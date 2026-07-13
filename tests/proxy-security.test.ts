import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getToken = vi.hoisted(() => vi.fn())
vi.mock('next-auth/jwt', () => ({ getToken }))

import { buildProtectedPageCsp, config, hasTrustedMutationOrigin, proxy, requestCorrelationId } from '@/proxy'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('proxy mutation-origin boundary', () => {
  it('matches API routes as well as protected pages', () => {
    expect(config.matcher).toContain('/api/:path*')
    expect(config.matcher).toContain('/shop/:path*')
  })

  it('rejects an explicit foreign Origin on a browser mutation', async () => {
    const response = await proxy(new NextRequest('https://erp.example/api/devices', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ success: false })
    expect(getToken).not.toHaveBeenCalled()
  })

  it('accepts a same-origin browser mutation', async () => {
    const request = new NextRequest('https://erp.example/api/devices', {
      method: 'POST',
      headers: { origin: 'https://erp.example', 'sec-fetch-site': 'same-origin' },
    })

    expect(hasTrustedMutationOrigin(request)).toBe(true)
    expect((await proxy(request)).status).toBe(200)
  })

  it('allows origin-less server callbacks to reach their own secret checks', async () => {
    const request = new NextRequest('https://erp.example/api/telegram/webhook', { method: 'POST' })

    expect(hasTrustedMutationOrigin(request)).toBe(true)
    expect((await proxy(request)).status).toBe(200)
  })

  it('does not apply mutation-origin rejection to reads', async () => {
    const request = new NextRequest('https://erp.example/api/health', {
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    })

    expect(hasTrustedMutationOrigin(request)).toBe(true)
    expect((await proxy(request)).status).toBe(200)
  })

  it('overwrites client correlation input with a platform ID and returns it to the caller', async () => {
    const request = new NextRequest('https://erp.example/api/health', {
      headers: {
        'x-request-id': 'client-controlled-value',
        'x-vercel-id': 'iad1::platform-request-123',
      },
    })
    const response = await proxy(request)

    expect(requestCorrelationId(request)).toBe('iad1::platform-request-123')
    expect(response.headers.get('x-request-id')).toBe('iad1::platform-request-123')
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe('iad1::platform-request-123')
  })

  it('uses a unique strict script nonce on protected pages', async () => {
    getToken.mockResolvedValue({ role: 'SHOP_ADMIN' })
    const first = await proxy(new NextRequest('https://erp.example/shop/dashboard'))
    const second = await proxy(new NextRequest('https://erp.example/shop/dashboard'))
    const firstCsp = first.headers.get('content-security-policy') ?? ''
    const secondCsp = second.headers.get('content-security-policy') ?? ''

    expect(firstCsp).toContain("script-src 'self' 'nonce-")
    expect(firstCsp).toContain("'strict-dynamic'")
    expect(firstCsp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(firstCsp).not.toBe(secondCsp)
    expect(first.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/)
  })

  it('retains only the current UI-required inline style exception', () => {
    const csp = buildProtectedPageCsp('fixed-nonce')
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("script-src 'self' 'nonce-fixed-nonce' 'strict-dynamic'")
  })
})
