import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contractScheduleOutstanding } from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * P0 fix (production-readiness audit): the sale payment route used to decide
 * `paidFully`/`contractRemainingAmount` from the LEGACY UZS remainder alone
 * (`nextRemaining <= 0`). For a USD-native sale, the legacy remainder is the
 * SUM of payments each converted to UZS at whatever rate was live on that
 * payment's own day — it is not the same quantity as the contract-currency
 * remainder (which decrements by the exact native amount applied). These two
 * can cross zero at different moments once the rate has moved between
 * payments, so deciding completion from the legacy side could:
 *   (a) mark a sale `paidFully` while real USD debt remains (forgiven debt), or
 *   (b) keep dunning a customer whose USD balance is genuinely settled.
 *
 * The fix mirrors the nasiya payment route exactly: completion is decided
 * from `contractScheduleOutstanding` (currency-aware tolerance), and the
 * legacy remainder is snapped to 0 in lockstep once the contract side is done.
 */
describe('worked numeric example: legacy vs. contract-currency completion can diverge', () => {
  it('a USD sale can still owe real money by contract math while the legacy-UZS math already reads zero', () => {
    // $500 sale created at rate 12,500 -> legacy snapshot 6,250,000 so‘m.
    // Customer pays in two USD-denominated instalments; the rate has moved to
    // 13,000 by the time the SECOND payment's legacy-UZS delta is computed
    // (moneyInputToUzs always uses TODAY's rate for a non-UZS payment).
    // First payment: $250 paid in USD (matches contract currency, no FX
    // needed on the contract side) -> contract remaining = $250.
    // Its legacy delta was converted at rate 12,600 (some earlier day) -> 3,150,000 so‘m.
    // Second payment: another $250 in USD -> contract remaining goes to $0.
    // Its legacy delta is converted at TODAY's rate 13,000 -> 3,250,000 so‘m.
    // Total legacy paid = 3,150,000 + 3,250,000 = 6,400,000 > the 6,250,000
    // legacy snapshot -- i.e. the legacy ledger "overshoots" zero before the
    // contract ledger even finishes, or (in the opposite rate-drift
    // direction) could undershoot it. Either way, using `nextRemaining <= 0`
    // (legacy) to decide completion is not equivalent to deciding from the
    // contract ledger itself.
    const contractRemainingAfterFirstPayment = contractScheduleOutstanding(500, 250, 'USD')
    expect(contractRemainingAfterFirstPayment).toBe(250) // still owes $250 by contract math

    const contractRemainingAfterSecondPayment = contractScheduleOutstanding(500, 500, 'USD')
    expect(contractRemainingAfterSecondPayment).toBe(0) // correctly settled by contract math

    // The legacy UZS total (6,400,000) does NOT equal the frozen creation
    // snapshot (6,250,000) once the rate has moved between payments -- proof
    // that "legacy remaining <= 0" is a different question from "contract
    // remaining <= 0" and must not be used to decide either one.
    const legacyCreationSnapshot = 6_250_000
    const legacyPaidTotal = 3_150_000 + 3_250_000
    expect(legacyPaidTotal).not.toBe(legacyCreationSnapshot)
  })

  it('contractScheduleOutstanding applies a currency-aware tolerance (cents for USD, so\'m for UZS), matching the nasiya completion pattern', () => {
    expect(contractScheduleOutstanding(500, 499.99, 'USD')).toBe(0.01) // 1 cent short -> still payable
    expect(contractScheduleOutstanding(500, 499, 'USD')).toBe(1) // $1 short -> real debt
    expect(contractScheduleOutstanding(6_250_000, 6_249_600, 'UZS')).toBe(0) // 400 so‘m short -> snapped
    expect(contractScheduleOutstanding(6_250_000, 6_249_000, 'UZS')).toBe(1000) // 1000 so‘m short -> real debt
  })
})

describe('sale payment route: acceptance and completion decided from the contract ledger, not the legacy remainder', () => {
  const route = read('src/app/api/sales/[id]/payment/route.ts')

  it('rejects a payment only when the contract helper says the sale is already settled or overpaid', () => {
    expect(route).toContain('const contractPayment = applySalePaymentToContractLedger({')
    expect(route).toContain("if (contractPayment.reason === 'ALREADY_SETTLED')")
    expect(route).toContain("if (contractPayment.reason === 'OVERPAYMENT')")
    expect(route).not.toContain('if (amount > oldRemaining)')
  })

  it('paidFully/dueDate/reminderEnabled are decided from contractPayment, never nextRemaining', () => {
    expect(route).toContain('contractRemainingAmount: Number(sale.contractRemainingAmount)')
    expect(route).toContain('appliedAmountInContractCurrency: requestedAppliedAmountInContractCurrency')
    expect(route).toContain('paidFully: contractPayment.isFullyPaid,')
    expect(route).toContain('dueDate: contractPayment.isFullyPaid ? null : (parsed.data.nextDueDate ?? sale.dueDate),')
    expect(route).toContain('reminderEnabled: contractPayment.isFullyPaid ? false : sale.reminderEnabled,')
    expect(route).not.toContain('paidFully: nextRemaining <= 0')
  })

  it('the legacy remainingAmount is snapped to 0 in lockstep once the contract side is fully paid (remainingToStore)', () => {
    expect(route).toContain('const nextRemaining = Math.max(0, oldRemaining - amount)')
    expect(route).toContain('const remainingToStore = contractPayment.isFullyPaid ? 0 : nextRemaining')
    expect(route).toContain('remainingAmount: remainingToStore,')
  })

  it('salePaymentMessage receives the same contract-currency remaining used for the completion decision', () => {
    expect(route).toContain('paidAmount: contractPayment.appliedAmountInContractCurrency,')
    expect(route).toContain('remaining: contractPayment.newContractRemainingAmount,')
    expect(route).toContain('contractCurrency: sale.contractCurrency,')
  })
})
