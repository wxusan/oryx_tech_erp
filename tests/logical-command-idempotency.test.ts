import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LogicalCommandIdempotency,
  isDefinitiveCommandRejection,
  logicalCommandFingerprint,
} from '@/lib/use-logical-command-idempotency'

describe('logical command idempotency', () => {
  it('keeps one key for the same JSON command across ambiguous retries', () => {
    let sequence = 0
    const command = new LogicalCommandIdempotency(() => `key-${++sequence}`)
    const first = command.keyFor({ amount: 100, method: 'CASH', nested: { note: 'same' } })

    command.rejected(500)
    expect(command.keyFor({ nested: { note: 'same' }, method: 'CASH', amount: 100 })).toBe(first)
    command.rejected(408)
    expect(command.keyFor({ amount: 100, method: 'CASH', nested: { note: 'same' } })).toBe(first)
  })

  it('rotates after a payload change, confirmed commit, or definitive rejection', () => {
    let sequence = 0
    const command = new LogicalCommandIdempotency(() => `key-${++sequence}`)
    const first = command.keyFor({ amount: 100 })
    expect(command.keyFor({ amount: 101 })).not.toBe(first)

    const changed = command.keyFor({ amount: 101 })
    command.committed()
    expect(command.keyFor({ amount: 101 })).not.toBe(changed)

    const retried = command.keyFor({ amount: 101 })
    command.rejected(409)
    expect(command.keyFor({ amount: 101 })).not.toBe(retried)
  })

  it('fingerprints JSON independent of object key order and classifies ambiguous statuses', () => {
    expect(logicalCommandFingerprint({ b: 2, a: [{ d: 4, c: 3 }] })).toBe(
      logicalCommandFingerprint({ a: [{ c: 3, d: 4 }], b: 2 }),
    )
    expect(isDefinitiveCommandRejection(400)).toBe(true)
    expect(isDefinitiveCommandRejection(409)).toBe(true)
    expect(isDefinitiveCommandRejection(408)).toBe(false)
    expect(isDefinitiveCommandRejection(425)).toBe(false)
    expect(isDefinitiveCommandRejection(429)).toBe(false)
    expect(isDefinitiveCommandRejection(500)).toBe(false)
  })

  it('is wired into every payment/return UI instead of generating a key per submit', () => {
    for (const relativePath of [
      'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
      'src/components/shop/nasiya-payment-modal.tsx',
      'src/app/(admin)/admin/shops/[id]/page.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
      expect(source, relativePath).toContain('useLogicalCommandIdempotency')
      expect(source, relativePath).toContain('.keyFor(payload)')
      expect(source, relativePath).not.toContain('crypto.randomUUID()')
    }
  })
})
