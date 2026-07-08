import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya payment route allocates in native contract currency alongside the legacy UZS ledger', () => {
  const route = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('computes appliedAmountInContractCurrency once, before the transaction, reusing the payment rate when possible', () => {
    expect(route).toContain('let contractRate: number | null = amountInput.exchangeRateUsed')
    expect(route).toContain('appliedAmountInContractCurrency = convertPaymentToContractCurrency(')
  })

  it('only fetches an extra rate when the payment currency differs from the contract currency and no rate was already fetched', () => {
    expect(route).toContain('amountInput.inputCurrency !== contractCurrency && contractRate == null')
    expect(route).toContain('contractRate = await getUsdUzsRate()')
  })

  it('tracks a parallel remainingContractPayment alongside the legacy remainingPayment in the allocation loop', () => {
    expect(route).toContain('let remainingContractPayment = appliedAmountInContractCurrency')
    expect(route).toContain('contractApplied = Math.min(remainingContractPayment, contractOutstanding)')
    expect(route).toContain('remainingContractPayment -= contractApplied')
  })

  it('uses contractScheduleOutstanding (currency-aware tolerance), not the UZS-only scheduleOutstanding, for the contract ledger', () => {
    expect(route).toContain('contractScheduleOutstanding(')
  })

  it('updates contractPaidAmount/contractRemainingAmount on every allocated schedule row', () => {
    // Two updateMany calls exist (deferredToNext branch, then the payment
    // allocation branch) — the second is the one that must carry contract fields.
    const firstIdx = route.indexOf('await tx.nasiyaSchedule.updateMany')
    const secondIdx = route.indexOf('await tx.nasiyaSchedule.updateMany', firstIdx + 1)
    const block = route.slice(secondIdx, secondIdx + 700)
    expect(block).toContain('contractPaidAmount: newContractPaidAmount')
    expect(block).toContain('contractRemainingAmount: newContractRemainingAmount')
  })

  it('stores appliedAmountInContractCurrency on the created NasiyaPayment row', () => {
    expect(route).toContain('appliedAmountInContractCurrency,')
  })

  it('dual-writes Nasiya-level contractPaidAmount/contractRemainingAmount from the freshly-refetched schedules', () => {
    expect(route).toContain('const contractTotalPaid = allSchedules.reduce((sum, s) => sum + Number(s.contractPaidAmount), 0)')
    expect(route).toContain('contractPaidAmount: contractTotalPaid')
    expect(route).toContain('contractRemainingAmount: contractRemainingToStore')
  })
})

// The completion decision itself (which ledger decides newStatus/COMPLETED)
// is covered by tests/nasiya-completion-contract-tolerance.guard.test.ts.
