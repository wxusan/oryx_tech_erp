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

describe('nasiya detail page shows only the selected display currency', () => {
  const page = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('does not show a native "Shartnoma: ..." money hint when contract currency differs', () => {
    expect(page).not.toContain('nasiya.contractCurrency !== currency.currency')
    expect(page).not.toContain('Shartnoma:')
    expect(page).not.toContain('formatContractMoney(nasiya.contractFinalAmount, nasiya.contractCurrency)')
  })

  it("paymentAmountDisplay is called with the nasiya's contractCurrency", () => {
    expect(page).toContain('paymentAmountDisplay(payment, nasiya.contractCurrency, currency)')
  })
})

describe('nasiya payment modal previews the applied amount without leaking a second currency', () => {
  const modal = read('src/components/shop/nasiya-payment-modal.tsx')

  it("fetches and stores the deal's contractCurrency", () => {
    expect(modal).toContain("setContractCurrency((json.data.contractCurrency as CurrencyCode) ?? 'UZS')")
  })

  it('shows a "Shartnomaga qo\'llanadi" preview only when payment currency differs from contract currency, formatted through dfmt', () => {
    expect(modal).toContain('contractCurrency !== currency.currency && currency.usdUzsRate')
    expect(modal).toContain(
      'convertPaymentToContractCurrency(Number(payAmount) || 0, currency.currency, contractCurrency, currency.usdUzsRate)',
    )
    expect(modal).toContain('Shartnomaga qo&apos;llanadi: {dfmt(contractPreviewAmount)}')
  })

  it('does NOT change the existing UZS-based overpayment/exceeds-remaining validation (still correct via the dual-ledger lockstep)', () => {
    expect(modal).toContain('const exceedsRemaining = !carryOver && payAmountUzs > nasiyaRemainingAmount')
  })
})
