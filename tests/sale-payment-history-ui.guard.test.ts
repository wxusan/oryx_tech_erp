import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Sale has no dedicated /sales/[id] page — the device detail page is the
 * canonical Sale detail view (it already renders the "Sotuv ma'lumotlari"
 * card). This adds a "To'lov tarixi" table there, mirroring the nasiya
 * detail page's payment history exactly: original payment-time amount,
 * applied contract-currency amount, and the payment-time rate when the two
 * differ — never a live reconversion via today's rate. See
 * docs/currency-accounting-model.md.
 */
describe('GET /api/devices/[id]: fetches SalePayment rows for the sale payment history table', () => {
  const route = read('src/app/api/devices/[id]/route.ts')

  it('selects payments under the sale, ordered oldest first, excluding soft-deleted rows', () => {
    expect(route).toContain("payments: {\n                where: { deletedAt: null },")
    expect(route).toContain("orderBy: { paidAt: 'asc' },")
  })

  it('selects every field salePaymentAmountDisplay needs (payment-time context, never inventing a historical rate)', () => {
    expect(route).toContain('paymentInputAmount: true,')
    expect(route).toContain('paymentInputCurrency: true,')
    expect(route).toContain('paymentExchangeRate: true,')
    expect(route).toContain('appliedAmountInContractCurrency: true,')
  })
})

describe('Device detail page: "To\'lov tarixi" section for Sale payments', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('renders a payment history table for SOLD_CASH devices, using salePaymentAmountDisplay per row', () => {
    expect(page).toContain("device.status === 'SOLD_CASH' && latestSale && (")
    expect(page).toContain("To'lov tarixi")
    expect(page).toContain('salePaymentAmountDisplay(payment, latestSale.contractCurrency, currency)')
  })

  it('shows an empty state instead of an empty/broken table when there are no payments yet', () => {
    expect(page).toContain("To'lov tarixi hali yo'q")
  })

  it('shows the payment date, method, and note (falling back to a dash for an empty note, never blank/undefined text)', () => {
    expect(page).toContain('{uzDateTime(payment.paidAt)}')
    expect(page).toContain('{paymentMethodLabel(payment.paymentMethod)}')
    expect(page).toContain("{payment.note ?? '—'}")
  })

  it('the Sale interface carries SalePaymentLike fields so the row never needs to invent a historical rate', () => {
    expect(page).toContain('interface SalePaymentRow extends SalePaymentLike')
    expect(page).toContain('payments: SalePaymentRow[]')
  })
})
