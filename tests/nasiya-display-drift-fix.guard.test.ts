import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isContractScheduleOverdue } from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * A USD-native nasiya's "current state" figures (Nasiya jami, Qarz qoldig'i,
 * To'langan, Oylik to'lov) must never be shown by reconverting the legacy
 * UZS snapshot (frozen at the CREATION rate) through TODAY's rate — that
 * double-conversion silently drifts from the true contract value as the
 * rate moves between creation and any later viewing. These guard tests
 * confirm every such figure now reads from the contract-currency ledger and
 * converts exactly once, via formatDisplayMoneyFromContract.
 */
describe('nasiya detail page: no double-conversion drift for USD contracts', () => {
  const page = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('defines dfmt() converting from the deal\'s own contractCurrency, not a legacy UZS field', () => {
    expect(page).toContain(
      'const dfmt = (n: number) => formatDisplayMoneyFromContract(n, nasiya.contractCurrency, currency.currency, currency.usdUzsRate)',
    )
  })

  it('every summary card money value uses dfmt() + a contract* field, not fmt() + a legacy field', () => {
    expect(page).toContain('{ label: \'Jami narx\', value: dfmt(nasiya.contractTotalAmount) }')
    expect(page).toContain('{ label: "Boshlang\'ich to\'lov", value: dfmt(nasiya.contractDownPayment) }')
    expect(page).toContain('{ label: \'Nasiya jami\', value: dfmt(nasiya.contractFinalAmount) }')
    expect(page).toContain('{ label: "To\'langan", value: dfmt(nasiya.contractPaidAmount) }')
    expect(page).toContain('{ label: "Qarz qoldig\'i", value: dfmt(nasiya.contractRemainingAmount) }')
    expect(page).toContain('{ label: "Oylik to\'lov", value: dfmt(contractMonthlyPayment) }')
  })

  it('the progress card and per-schedule table also use dfmt() + contract fields', () => {
    expect(page).toContain('dfmt(nasiya.contractPaidAmount)} to\'landi')
    expect(page).toContain('dfmt(row.contractExpectedAmount)')
    expect(page).toContain('dfmt(row.contractPaidAmount)')
  })
})

describe('nasiya payment modal: no double-conversion drift for USD contracts', () => {
  const modal = read('src/components/shop/nasiya-payment-modal.tsx')

  it('defines dfmt() converting from the fetched contractCurrency', () => {
    expect(modal).toContain(
      'const dfmt = (n: number) => formatDisplayMoneyFromContract(n, contractCurrency, currency.currency, currency.usdUzsRate)',
    )
  })

  it('schedule balances, "Jami qolgan qarz", and the Tavsiya suggestion all use dfmt() + contract-currency amounts', () => {
    expect(modal).toContain('dfmt(contractScheduleBalance(s, contractCurrency))')
    expect(modal).toContain('dfmt(selectedScheduleContractOutstanding)')
    expect(modal).toContain('dfmt(nasiyaContractRemainingAmount)')
  })

  it('the Tavsiya button prefill is computed from the contract-currency balance (falls back safely with no rate)', () => {
    expect(modal).toContain('convertPaymentToContractCurrency(\n                          selectedScheduleContractOutstanding,')
    expect(modal).toContain('if (contractCurrency !== currency.currency && !currency.usdUzsRate)')
  })

  it('validation math (exceedsRemaining) is untouched — still the UZS legacy comparison, which stays accurate via the dual-ledger lockstep', () => {
    expect(modal).toContain('const exceedsRemaining = !carryOver && payAmountUzs > nasiyaRemainingAmount')
  })
})

describe('isContractScheduleOverdue — currency-aware, byte-identical to legacy for UZS', () => {
  it('UZS: matches nasiya-utils.ts isScheduleOverdue exactly (500 so\'m tolerance)', () => {
    const now = new Date('2026-07-08T00:00:00.000Z')
    const s = { status: 'PARTIAL', dueDate: new Date('2020-01-01'), delayedUntil: null, expectedAmount: 200_000, paidAmount: 199_600 }
    expect(isContractScheduleOverdue(s, 'UZS', now)).toBe(false) // 400 so'm short -> within tolerance
    const s2 = { ...s, paidAmount: 199_000 } // 1000 so'm short -> real debt
    expect(isContractScheduleOverdue(s2, 'UZS', now)).toBe(true)
  })

  it('USD: uses cent tolerance, not the UZS-sized 500 tolerance', () => {
    const now = new Date('2026-07-08T00:00:00.000Z')
    const s = { status: 'PARTIAL', dueDate: new Date('2020-01-01'), delayedUntil: null, expectedAmount: 200, paidAmount: 199 }
    expect(isContractScheduleOverdue(s, 'USD', now)).toBe(true) // $1 short -> real debt despite being < 500
  })

  it('a PAID schedule is never overdue, regardless of currency', () => {
    const now = new Date('2026-07-08T00:00:00.000Z')
    const s = { status: 'PAID', dueDate: new Date('2020-01-01'), delayedUntil: null, expectedAmount: 200, paidAmount: 200 }
    expect(isContractScheduleOverdue(s, 'USD', now)).toBe(false)
  })
})
