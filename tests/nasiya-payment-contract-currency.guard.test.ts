import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya payment route allocates in native contract currency alongside the legacy UZS ledger', () => {
  const route = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('computes one exact native applied MoneyDto before the transaction', () => {
    expect(route).toContain('inputMoney = createMoneyDto(inputCurrency, amount)')
    expect(route).toContain('const appliedMoney = convertMoneyDto(inputMoney, contractCurrency, conversionQuote)')
    expect(route).toContain('const appliedAmountInContractCurrency = moneyDtoToAmount(appliedMoney)')
  })

  it('requires a governed rate only when payment and contract currencies differ', () => {
    expect(route).toContain('if (inputCurrency !== contractCurrency)')
    expect(route).toContain('paymentTimeSnapshot = await getUsdUzsRateSnapshot()')
    expect(route).toContain("USDdan USDga to'lov kurs talab qilmaydi")
  })

  it('the pure allocateNasiyaPayment (called by this route) tracks a parallel contract-currency remaining amount alongside the legacy one', () => {
    // The per-schedule allocation loop itself was extracted to
    // src/lib/nasiya-payment-allocation.ts (item 4 rate-drift fix) so it
    // can be unit-tested directly — see tests/nasiya-allocation-rate-drift.test.ts.
    const allocation = read('src/lib/nasiya-payment-allocation.ts')
    expect(allocation).toContain('let remainingContractMinorUnits = allocatableMinorUnits(params.appliedAmountInContractCurrency, contractCurrency)')
    expect(allocation).toContain('const contractAppliedMinorUnits = Math.min(remainingContractMinorUnits, contractOutstandingMinorUnits)')
    expect(allocation).toContain('remainingContractMinorUnits -= contractAppliedMinorUnits')
  })

  it('uses the reconciled native schedule ledger rather than UZS-only outstanding math', () => {
    expect(route).toContain('const currentLedger = reconcileNasiyaLedger({')
    expect(route).toContain('const totalOutstandingContract = currentLedger.remaining')
    const allocation = read('src/lib/nasiya-payment-allocation.ts')
    expect(allocation).toContain('const contractExpected = createMoneyDto(contractCurrency, schedule.contractExpectedAmount)')
  })

  it('updates contractPaidAmount/contractRemainingAmount on every allocated schedule row', () => {
    // Deferral is a separate command; the payment route has one allocation write.
    const firstIdx = route.indexOf('await tx.nasiyaSchedule.updateMany')
    const block = route.slice(firstIdx, firstIdx + 700)
    expect(block).toContain('contractPaidAmount: scheduleUpdate.newContractPaidAmount')
    expect(block).toContain('contractRemainingAmount: scheduleUpdate.newContractRemainingAmount')
  })

  it('stores appliedAmountInContractCurrency on the created NasiyaPayment row', () => {
    expect(route).toContain('appliedAmountInContractCurrency,')
  })

  it('synchronizes Nasiya-level contract cache fields from a freshly reconciled schedule projection', () => {
    expect(route).toContain('const postPaymentLedger = reconcileNasiyaLedger({')
    expect(route).toContain('const contractPaidToStore = moneyDtoDatabaseAmount(postPaymentLedger.paid)')
    expect(route).toContain('contractPaidAmount: contractPaidToStore')
    expect(route).toContain('contractRemainingAmount: contractRemainingToStore')
  })
})

// The completion decision itself (which ledger decides newStatus/COMPLETED)
// is covered by tests/nasiya-completion-contract-tolerance.guard.test.ts.
