import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  currentBusinessLogContext,
  currentRequestAuditContext,
  requestAuditContextFromHeaders,
  withRequestAuditContext,
} from '@/lib/server/request-context'

function headers(values: Record<string, string>): Pick<Headers, 'get'> {
  return { get: (name) => values[name.toLowerCase()] ?? null }
}

describe('privacy-safe request audit context', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'request-context-test-secret-with-32-bytes'
    delete process.env.AUDIT_NETWORK_HASH_SECRET
    delete process.env.VERCEL
  })

  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUDIT_NETWORK_HASH_SECRET
    delete process.env.VERCEL
  })

  it('uses the server-forwarded request ID and never returns the raw network address', () => {
    const context = requestAuditContextFromHeaders(headers({
      'x-request-id': 'iad1::trusted-request-123',
      'x-vercel-forwarded-for': '203.0.113.42',
    }))

    expect(context.requestId).toBe('iad1::trusted-request-123')
    expect(context.networkId).toMatch(/^h1:[a-f0-9]{32}$/)
    expect(context.networkId).not.toContain('203.0.113.42')
  })

  it('ignores an invalid request ID and rejects untrusted/invalid address shapes', () => {
    process.env.VERCEL = '1'
    const context = requestAuditContextFromHeaders(headers({
      'x-request-id': 'bad id with spaces',
      'x-forwarded-for': '198.51.100.10',
    }))

    expect(context.requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(context.networkId).toBeNull()
  })

  it('propagates one context through async business work', async () => {
    await withRequestAuditContext(
      { requestId: 'request-async-123', networkId: 'h1:abc123' },
      async () => {
        await Promise.resolve()
        expect(currentRequestAuditContext()).toEqual({
          requestId: 'request-async-123',
          networkId: 'h1:abc123',
        })
        expect(currentBusinessLogContext()).toEqual({
          requestId: 'request-async-123',
          ipAddress: 'h1:abc123',
        })
      },
    )
  })
})
