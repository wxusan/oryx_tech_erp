import { describe, expect, it } from 'vitest'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'

describe('Serializable transaction retry classification', () => {
  it.each(['P2034', '40001', '40P01'])('accepts retryable code %s', (code) => {
    expect(isRetryableTransactionError({ code })).toBe(true)
  })

  it('finds a native deadlock SQLSTATE inside a DriverAdapterError cause', () => {
    expect(isRetryableTransactionError({
      name: 'DriverAdapterError',
      cause: { kind: 'postgres', originalCode: '40P01' },
    })).toBe(true)
  })

  it('recognizes Prisma pg-adapter serialization failures exposed only in text', () => {
    expect(isRetryableTransactionError({
      code: 'P2010',
      meta: { driverAdapterError: { message: 'could not serialize access due to concurrent update (SQLSTATE 40001)' } },
    })).toBe(true)
  })

  it('does not retry validation, uniqueness, or unknown failures', () => {
    expect(isRetryableTransactionError({ code: 'P2002' })).toBe(false)
    expect(isRetryableTransactionError({ cause: { code: '23505' } })).toBe(false)
    expect(isRetryableTransactionError(new Error('network unavailable'))).toBe(false)
  })

  it('is cycle-safe for unusual adapter error objects', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.cause = cyclic
    expect(isRetryableTransactionError(cyclic)).toBe(false)
  })
})
