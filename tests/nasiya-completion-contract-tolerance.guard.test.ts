import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getCompletionToleranceForCurrency, contractScheduleOutstanding, isContractCurrencyDust } from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya completion is decided from the contract-currency ledger', () => {
  const route = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('newStatus/remainingToStore/contractRemainingToStore all key off the shared contract status derivation, not the legacy allFullyPaid', () => {
    expect(route).toContain('const derivedAfterPayment = deriveContractNasiyaStatus({')
    expect(route).toContain('const newStatus = derivedAfterPayment.displayStatus')
    expect(route).toContain("const remainingToStore = newStatus === 'COMPLETED' ? 0 : remaining")
    expect(route).toContain("const contractRemainingToStore = newStatus === 'COMPLETED' ? 0 : contractRemaining")
  })

  it('guards a stale stored COMPLETED parent through contract status, not raw parent status', () => {
    expect(route).toContain('const currentContractStatus = deriveContractNasiyaStatus({')
    expect(route).toContain("if (currentContractStatus.displayStatus === 'COMPLETED')")
    expect(route).not.toContain("if (nasiya.status === 'COMPLETED')")
  })
})

describe('currency-aware completion tolerance (nasiya-contract.ts)', () => {
  it("UZS preserves every whole so'm of debt", () => {
    expect(contractScheduleOutstanding(10_000_000, 9_999_600, 'UZS')).toBe(400)
    expect(contractScheduleOutstanding(10_000_000, 9_999_999, 'UZS')).toBe(1)
    expect(contractScheduleOutstanding(10_000_000, 10_000_000, 'UZS')).toBe(0)
  })

  it('USD treats one whole cent as real debt, never 500 so\'m-equivalent slack', () => {
    expect(contractScheduleOutstanding(1000, 999.99, 'USD')).toBe(0.01) // 1 cent short -> still payable
    expect(contractScheduleOutstanding(1000, 999, 'USD')).toBe(1) // $1 short -> real debt, not silently forgiven
  })

  it("tolerance constants are exactly 1 so'm / $0.01", () => {
    expect(getCompletionToleranceForCurrency('UZS')).toBe(1)
    expect(getCompletionToleranceForCurrency('USD')).toBe(0.01)
  })

  it('dust allocation is strict: below tolerance is ignored, tolerance itself is meaningful', () => {
    expect(isContractCurrencyDust(0.009, 'USD')).toBe(true)
    expect(isContractCurrencyDust(0.01, 'USD')).toBe(false)
    expect(isContractCurrencyDust(0.4, 'UZS')).toBe(true)
    expect(isContractCurrencyDust(1, 'UZS')).toBe(false)
  })
})
