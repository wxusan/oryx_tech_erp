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
    for (const text of [
      'Sotilish narxi',
      "Boshlang'ich to'lov",
      'Nasiya jami',
      "To'langan",
      "Qarz qoldig'i",
      "Oylik to'lov",
      'dfmt(nasiya.contractTotalAmount)',
      'dfmt(nasiya.contractDownPayment)',
      'dfmt(nasiya.contractFinalAmount)',
      'dfmt(nasiya.contractPaidAmount)',
      'dfmt(nasiya.contractRemainingAmount)',
      'dfmt(contractMonthlyPayment)',
    ]) {
      expect(page).toContain(text)
    }
  })

  it('the progress card and per-schedule table also use dfmt() + contract fields', () => {
    const history = read('src/components/shop/nasiya-history-sections.tsx')
    expect(page).toContain('dfmt(nasiya.contractPaidAmount)} to\'landi')
    expect(page).toContain('formatContractAmount={dfmt}')
    expect(history).toContain('formatContractAmount(row.contractExpectedAmount)')
    expect(history).toContain('formatContractAmount(row.contractPaidAmount)')
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

describe('isContractScheduleOverdue — currency-aware native minor-unit rules', () => {
  it("UZS: every unpaid whole so'm remains overdue after its due date", () => {
    const now = new Date('2026-07-08T00:00:00.000Z')
    const s = { status: 'PARTIAL', dueDate: new Date('2020-01-01'), delayedUntil: null, expectedAmount: 200_000, paidAmount: 199_600 }
    expect(isContractScheduleOverdue(s, 'UZS', now)).toBe(true)
    const s2 = { ...s, paidAmount: 199_999 }
    expect(isContractScheduleOverdue(s2, 'UZS', now)).toBe(true)
    expect(isContractScheduleOverdue({ ...s, paidAmount: 200_000 }, 'UZS', now)).toBe(false)
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
