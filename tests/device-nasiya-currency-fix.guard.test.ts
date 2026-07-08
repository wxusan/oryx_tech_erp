import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 15 — bug fix: opening a device that was sold on nasiya used to show
 * its price/interest/remaining-debt figures stuck reading the LEGACY UZS
 * ledger (Nasiya.totalAmount/finalNasiyaAmount/remainingAmount/
 * interestAmount) via a single-currency `fmt()` call — for a USD-native
 * nasiya this ignored the deal's own contract currency entirely. Root
 * cause: GET /api/devices/[id] never selected the Nasiya's contract*
 * fields at all. Fixed by selecting them and switching every money value in
 * the page's nasiya card to the same dfmt()-from-contract-currency pattern
 * already used for Sale (see docs/currency-accounting-model.md).
 *
 * Item 16 — the device profile now also offers a "To'lov qabul qilish"
 * button that opens the shared NasiyaPaymentModal (no duplicated payment
 * logic), shown only while the nasiya is still ACTIVE/OVERDUE.
 */
describe('GET /api/devices/[id] selects the nasiya contract-currency fields', () => {
  it('selects contractCurrency, contractTotalAmount, contractInterestAmount, contractFinalAmount, contractRemainingAmount, contractExchangeRateAtCreation, and status', () => {
    const source = read('src/app/api/devices/[id]/route.ts')
    const nasiyaSelectStart = source.indexOf('nasiya: {')
    const nasiyaSelectBlock = source.slice(nasiyaSelectStart, nasiyaSelectStart + 900)
    for (const field of [
      'status: true',
      'contractCurrency: true',
      'contractTotalAmount: true',
      'contractInterestAmount: true',
      'contractFinalAmount: true',
      'contractRemainingAmount: true',
      'contractExchangeRateAtCreation: true',
    ]) {
      expect(nasiyaSelectBlock).toContain(field)
    }
  })
})

describe('device detail page: nasiya card uses contract-currency values, not the legacy UZS ledger', () => {
  const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('defines dfmtNasiya converting from the nasiya\'s own contractCurrency', () => {
    expect(source).toMatch(/const dfmtNasiya = \(amount: number\) =>\s*\n\s*latestNasiya \? formatDisplayMoneyFromContract\(amount, latestNasiya\.contractCurrency, currency\.currency, currency\.usdUzsRate\)/)
  })

  it('every nasiya-card money value reads a contract* field through dfmtNasiya, not a legacy field through fmt()', () => {
    expect(source).toContain('dfmtNasiya(latestNasiya.contractTotalAmount)')
    expect(source).toContain('dfmtNasiya(latestNasiya.contractInterestAmount)')
    expect(source).toContain('dfmtNasiya(latestNasiya.contractFinalAmount)')
    expect(source).toContain('dfmtNasiya(latestNasiya.contractRemainingAmount)')
    expect(source).not.toContain('fmt(latestNasiya.totalAmount, currency)')
    expect(source).not.toContain('fmt(latestNasiya.finalNasiyaAmount, currency)')
    expect(source).not.toContain('fmt(latestNasiya.remainingAmount, currency)')
    expect(source).not.toContain('fmt(latestNasiya.interestAmount, currency)')
  })

  it('the paid-percentage progress bar derives from contract totals, not the legacy UZS ledger', () => {
    expect(source).toContain('latestNasiya.contractFinalAmount > 0')
    expect(source).toContain('latestNasiya.contractFinalAmount - latestNasiya.contractRemainingAmount')
  })

  it('links to the nasiya profile page', () => {
    expect(source).toContain('href={`/shop/nasiyalar/${latestNasiya.id}`}')
  })
})

describe('device detail page: receive nasiya payment (item 16)', () => {
  const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('reuses the shared NasiyaPaymentModal instead of duplicating payment logic', () => {
    expect(source).toContain("import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'")
    expect(source).toContain('<NasiyaPaymentModal')
    expect(source).toContain('nasiyaId={latestNasiya.id}')
  })

  it('the receive-payment button only shows while the nasiya is ACTIVE or OVERDUE', () => {
    expect(source).toMatch(/latestNasiya\.status === 'ACTIVE' \|\| latestNasiya\.status === 'OVERDUE'/)
  })

  it('a successful payment refreshes the device via the existing fetchDevice callback', () => {
    const modalBlockStart = source.indexOf('<NasiyaPaymentModal')
    const modalBlock = source.slice(modalBlockStart, modalBlockStart + 400)
    expect(modalBlock).toContain('fetchDevice()')
  })
})
