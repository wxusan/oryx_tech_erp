import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}
function routeExists(rel: string): boolean {
  return existsSync(resolve(process.cwd(), rel))
}

const DASHBOARD = 'src/app/(shop)/shop/dashboard/dashboard-client.tsx'
const NASIYALAR_CLIENT = 'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx'
const DETAIL = 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx'
const MODAL = 'src/components/shop/nasiya-payment-modal.tsx'
const QURILMALAR_CLIENT = 'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx'

describe('dashboard links', () => {
  const src = read(DASHBOARD)

  it('has "Ko\'rish" links to reports, inventory and nasiyalar', () => {
    expect(src).toContain('href="/shop/hisobot"')
    expect(src).toContain('href="/shop/qurilmalar"')
    expect(src).toContain('href="/shop/qurilmalar?status=IN_STOCK"')
    expect(src).toContain('href="/shop/nasiyalar?status=ACTIVE"')
    expect(src).toContain("Ko'rish")
  })

  it('overdue card links to the nasiyalar overdue filter', () => {
    expect(src).toContain('href="/shop/nasiyalar?status=OVERDUE"')
  })

  it('recent operations "Barchasini ko\'rish" links to logs', () => {
    expect(src).toContain('href="/shop/logs"')
    expect(src).toContain("Barchasini ko'rish")
  })

  it('nearby payment rows link to the nasiya detail via its id', () => {
    expect(src).toContain('href={`/shop/nasiyalar/${p.nasiya.id}`}')
  })

  it('every linked base route actually exists (no broken links)', () => {
    for (const route of [
      'src/app/(shop)/shop/hisobot/page.tsx',
      'src/app/(shop)/shop/qurilmalar/page.tsx',
      'src/app/(shop)/shop/nasiyalar/page.tsx',
      'src/app/(shop)/shop/nasiyalar/[id]/page.tsx',
      'src/app/(shop)/shop/logs/page.tsx',
    ]) {
      expect(routeExists(route), `${route} must exist`).toBe(true)
    }
  })
})

describe('nasiyalar list payment action', () => {
  const src = read(NASIYALAR_CLIENT)

  it('shows "To\'lov qabul qilish" only for active/overdue with remaining > 0', () => {
    expect(src).toContain(
      "const canPay = (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0",
    )
    expect(src).toContain('{canPay && (')
    expect(src).toContain("To&apos;lov qabul qilish")
  })

  it('opens the shared modal and refetches only the active nasiya query on success', () => {
    expect(src).toContain('onClick={() => setPayFor(n)}')
    expect(src).toContain('<NasiyaPaymentModal')
    expect(src).toContain('onSuccess={handlePaymentSuccess}')
    expect(src).toContain('function handlePaymentSuccess()')
    expect(src).toContain('nasiyalarQuery.refetch()')
    expect(src).not.toContain('router.refresh()')
  })
})

describe('payment modal is the single shared implementation', () => {
  const modal = read(MODAL)
  const detail = read(DETAIL)
  const list = read(NASIYALAR_CLIENT)

  it('the modal posts to the existing payment endpoint with idempotency + inputCurrency', () => {
    expect(modal).toContain('/payment')
    expect(modal).toContain("'Idempotency-Key': paymentCommand.keyFor(payload)")
    expect(modal).toContain('inputCurrency: currency.currency')
  })

  it('uses MoneyInput and currency formatting (USD/UZS preserved)', () => {
    expect(modal).toContain('MoneyInput')
    expect(modal).toContain('formatDisplayMoneyFromContract')
    expect(modal).toContain('currencyLabel')
  })

  it('does NOT re-implement schedule allocation (no server payment logic client-side)', () => {
    expect(modal).not.toContain('calculateRemaining')
    expect(modal).not.toContain('allocationRows')
  })

  it('detail + list pages route payment through the component, not a duplicate fetch', () => {
    // Neither page should still contain its own payment POST / idempotency header.
    expect(detail).not.toContain('Idempotency-Key')
    expect(list).not.toContain('Idempotency-Key')
    expect(detail).toContain('<NasiyaPaymentModal')
    expect(list).toContain('<NasiyaPaymentModal')
  })
})

describe('retired device statuses are not exposed as filters', () => {
  const src = read(QURILMALAR_CLIENT)
  it('qurilmalar filter tabs do not include RESERVED', () => {
    const tabs = src.slice(src.indexOf('const filterTabs'), src.indexOf('const filterTabs') + 400)
    expect(tabs).not.toContain("value: 'RESERVED'")
    expect(tabs).not.toContain("label: 'Band'")
  })
})
