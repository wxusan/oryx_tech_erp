import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('GET /api/nasiya/[id] returns the contract-currency ledger for the UI', () => {
  const route = read('src/app/api/nasiya/[id]/route.ts')

  it('selects contractCurrency/contractFinalAmount/contractRemainingAmount on Nasiya', () => {
    expect(route).toContain('contractCurrency: true')
    expect(route).toContain('contractFinalAmount: true')
    expect(route).toContain('contractRemainingAmount: true')
  })

  it('selects contractExpectedAmount/contractPaidAmount on schedules', () => {
    expect(route).toContain('contractExpectedAmount: true')
    expect(route).toContain('contractPaidAmount: true')
  })

  it('selects appliedAmountInContractCurrency on payments', () => {
    expect(route).toContain('appliedAmountInContractCurrency: true')
  })
})

describe('nasiya detail page derives from contract money but renders one selected shop currency', () => {
  const page = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('converts native MoneyDto values exactly once and never appends a second currency', () => {
    expect(page).toContain('const selectedCurrencyAmount = amount.currency === currency.currency')
    expect(page).toContain('convertMoneyDto(amount, currency.currency, currency.fxQuote)')
    expect(page).toContain('Joriy kurs · 1 USD =')
    expect(page).not.toContain('const primary = formatMoneyDto(amount)')
    expect(page).not.toContain(' · ≈ ')
  })

  it('payment history preserves the recorded input and native applied amounts', () => {
    const history = read('src/components/shop/nasiya-history-sections.tsx')
    expect(history).toContain('paymentAmountDisplay(payment)')
    expect(history).toContain('formatMoneyDto(part.amount)')
  })
})

describe('nasiya payment modal previews the applied amount without leaking a second currency', () => {
  const modal = read('src/components/shop/nasiya-payment-modal.tsx')

  it('reads the deal contract currency from the shared operation context', () => {
    expect(modal).toContain("const contractCurrency = contextQuery.data?.contractCurrency ?? 'UZS'")
    expect(modal).toContain('useNasiyaOperationContext')
  })

  it('shows a native applied preview only for genuine cross-currency payments', () => {
    expect(modal).toContain('convertMoneyDto(enteredMoney, contractCurrency, currency.fxQuote)')
    expect(modal).toContain('payAmountContract && enteredMoney?.currency !== contractCurrency')
    expect(modal).toContain('Shartnomaga qo&apos;llanadi: {moneyView(payAmountContract)}')
  })

  it('validates overpayment in exact native contract minor units', () => {
    expect(modal).toContain('payAmountContract.minorUnits > ledgerRemaining.minorUnits')
  })
})
