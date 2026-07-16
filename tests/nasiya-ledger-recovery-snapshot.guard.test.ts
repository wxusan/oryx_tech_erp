import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'scripts/create-nasiya-ledger-recovery-snapshot.mjs'), 'utf8')

describe('Nasiya ledger recovery snapshot', () => {
  it('is read-only, permission-restricted, and verifies a checksum before returning a backup reference', () => {
    expect(source).toContain('REPEATABLE READ READ ONLY')
    expect(source).toContain('gzipSync(JSON.stringify(payload))')
    expect(source).toContain("chmodSync(outputFile, 0o600)")
    expect(source).toContain('snapshot checksum verification failed')
    expect(source).toContain('backupReference')
    expect(source).not.toMatch(/\b(?:UPDATE|DELETE|INSERT INTO)\b/)
  })

  it('captures the parent cache and the direct schedule/payment/allocation evidence together', () => {
    for (const table of [
      'Nasiya',
      'NasiyaSchedule',
      'NasiyaPayment',
      'NasiyaPaymentAllocation',
      'NasiyaDeferral',
      'NasiyaResolutionEvent',
    ]) {
      expect(source).toContain(`"${table}"`)
    }
  })
})
