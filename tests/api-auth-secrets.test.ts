import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { hasValidInternalSecret, internalFetchHeaders, internalSecret } from '@/lib/api-auth'

const originalInternalSecret = process.env.INTERNAL_API_SECRET
const originalCronSecret = process.env.CRON_SECRET

function restoreEnv(name: 'INTERNAL_API_SECRET' | 'CRON_SECRET', value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function requestWith(secret?: string) {
  return new Request('http://localhost/api/internal', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

afterEach(() => {
  restoreEnv('INTERNAL_API_SECRET', originalInternalSecret)
  restoreEnv('CRON_SECRET', originalCronSecret)
})

describe('internal API and Vercel Cron credentials', () => {
  it('rejects requests when neither credential is configured', () => {
    delete process.env.INTERNAL_API_SECRET
    delete process.env.CRON_SECRET

    expect(internalSecret()).toBeUndefined()
    expect(internalFetchHeaders()).toEqual({})
    expect(hasValidInternalSecret(requestWith('anything'))).toBe(false)
  })

  it('accepts CRON_SECRET when it is the only configured credential', () => {
    delete process.env.INTERNAL_API_SECRET
    process.env.CRON_SECRET = 'cron-only'

    expect(hasValidInternalSecret(requestWith('cron-only'))).toBe(true)
    expect(hasValidInternalSecret(requestWith('wrong'))).toBe(false)
  })

  it('accepts INTERNAL_API_SECRET when it is the only configured credential', () => {
    process.env.INTERNAL_API_SECRET = 'internal-only'
    delete process.env.CRON_SECRET

    expect(hasValidInternalSecret(requestWith('internal-only'))).toBe(true)
    expect(hasValidInternalSecret(requestWith('wrong'))).toBe(false)
  })

  it('accepts both independently when both credentials are configured', () => {
    process.env.INTERNAL_API_SECRET = 'internal-caller'
    process.env.CRON_SECRET = 'vercel-cron'

    expect(hasValidInternalSecret(requestWith('internal-caller'))).toBe(true)
    expect(hasValidInternalSecret(requestWith('vercel-cron'))).toBe(true)
    expect(hasValidInternalSecret(requestWith('wrong'))).toBe(false)
    expect(hasValidInternalSecret(requestWith())).toBe(false)
  })

  it('uses the dedicated internal credential for outbound app-owned calls', () => {
    process.env.INTERNAL_API_SECRET = 'internal-caller'
    process.env.CRON_SECRET = 'vercel-cron'

    expect(internalSecret()).toBe('internal-caller')
    expect(internalFetchHeaders()).toEqual({ authorization: 'Bearer internal-caller' })
  })
})
