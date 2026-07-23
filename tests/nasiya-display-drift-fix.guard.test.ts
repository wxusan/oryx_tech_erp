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
 * confirm every such figure reads from the contract-currency ledger before
 * being converted once into the shop-selected display currency.
 */
describe('nasiya detail page: no double-conversion drift for USD contracts', () => {
  const page = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('formats MoneyDto values from the reconciled native ledger, never legacy UZS snapshots', () => {
    expect(page).toContain('const mfmt = (amount: MoneyDto) => {')
    expect(page).toContain('const selectedCurrencyAmount = amount.currency === currency.currency')
    expect(page).toContain('convertMoneyDto(amount, currency.currency, currency.fxQuote)')
    expect(page).toContain("return selectedCurrencyAmount ? formatMoneyDto(selectedCurrencyAmount) : '—'")
  })

  it('every summary card reads a contract term or reconciled ledger MoneyDto', () => {
    for (const text of [
      'Shartnomadagi qurilma narxi',
      "Boshlang'ich to'lov",
      "Bo'lib to'lash jami (boshlang'ichsiz)",
      "To'langan",
      "Qarz qoldig'i",
      "Oylik to'lov",
      'mfmt(contractTerms.original)',
      'mfmt(contractTerms.downPayment)',
      'ledgerFmt(ledger.financed)',
      'ledgerFmt(ledger.paid)',
      'ledgerFmt(currentCustomerDebt)',
      'ledgerFmt(contractMonthlyPayment)',
    ]) {
      expect(page).toContain(text)
    }
  })

  it('the progress card and schedule table also use MoneyDto values', () => {
    const history = read('src/components/shop/nasiya-history-sections.tsx')
    expect(page).toContain("mfmt(ledger.paid)} to'landi")
    expect(page).toContain('formatMoney={mfmt}')
    expect(history).toContain('formatMoney(row.expected)')
    expect(history).toContain('formatMoney(row.paid)')
  })
})

describe('nasiya payment modal: no double-conversion drift for USD contracts', () => {
  const modal = read('src/components/shop/nasiya-payment-modal.tsx')

  it('defines a MoneyDto formatter with a secondary current-rate approximation', () => {
    expect(modal).toContain('const moneyView = (amount: MoneyDto) => {')
    expect(modal).toContain('const primary = formatMoneyDto(amount)')
    expect(modal).toContain('convertMoneyDto(amount, currency.currency, currency.fxQuote)')
  })

  it('schedule balances, total debt, and the Tavsiya suggestion all use MoneyDto values', () => {
    expect(modal).toContain('moneyView(s.remaining)')
    expect(modal).toContain('moneyView(selectedScheduleRemaining)')
    expect(modal).toContain('moneyView(ledgerRemaining)')
  })

  it('the Tavsiya button prefill converts exactly once and fails safely when a cross-currency quote is absent', () => {
    expect(modal).toContain('convertMoneyDto(selectedScheduleRemaining, currency.currency, currency.fxQuote)')
    expect(modal).toContain('setPayAmount(formatAmountForInput(suggestedMoney))')
    expect(modal).toContain('const requiresCrossCurrencyRate = Boolean(enteredMoney && enteredMoney.currency !== contractCurrency && !payAmountContract)')
  })

  it('validation compares exact contract minor units against reconciled remaining debt', () => {
    expect(modal).toContain('payAmountContract.minorUnits > ledgerRemaining.minorUnits')
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
