import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('device acquisition evidence write path', () => {
  const route = read('src/app/api/devices/route.ts')
  const page = read('src/app/(shop)/shop/qurilmalar/new/page.tsx')

  it('requires one acquisition idempotency key for both settlement modes', () => {
    expect(route).toContain('if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120)')
    expect(route).toContain('db.devicePurchaseReceipt.findUnique')
    expect(route).toContain('db.supplierPayable.findUnique')
    expect(page).toContain("'Idempotency-Key': idempotencyKey")
    expect(page).not.toContain("form.purchaseSettlement === 'PAY_LATER' ? { 'Idempotency-Key'")
  })

  it('writes the paid-now receipt in the device transaction with complete evidence', () => {
    expect(route).toContain("const purchaseReceipt = purchaseSettlement === 'PAID_NOW'")
    expect(route).toContain('await tx.devicePurchaseReceipt.create')
    expect(route).toContain('inputAmount: purchasePrice')
    expect(route).toContain('inputCurrency: purchaseInput.inputCurrency')
    expect(route).toContain('amountUzsSnapshot: purchaseInput.amountUzs')
    expect(route).toContain('exchangeRateSource: purchaseInput.exchangeRateSource')
    expect(route).toContain('exchangeRateEffectiveAt: purchaseInput.exchangeRateEffectiveAt')
    expect(route).toContain('exchangeRateFetchedAt: purchaseInput.exchangeRateFetchedAt')
    expect(route).toContain('evidenceVersion: 2')
    expect(route).toContain("evidenceStatus: 'CAPTURED'")
  })

  it('uses the exact split as evidence and derives the compatibility method', () => {
    expect(route).toContain('representativePaymentMethod(parsed.data.supplierPaymentBreakdown)')
    expect(route).toContain('paymentMethod: effectivePurchasePaymentMethod')
    expect(route).toContain('paymentBreakdown: parsed.data.supplierPaymentBreakdown')
    expect(page).toContain('supplierPaymentAmount > 0 && form.supplierSplitPayment')
  })

  it('domain-separates payable creation identity and bounds every child receipt key', () => {
    const supplierLedger = read('src/lib/server/supplier-payable-payments.ts')
    const olibRoute = read('src/app/api/olib-sotdim/route.ts')

    expect(supplierLedger).toContain("origin === 'OLIB_SOTDIM' ? 'olib-payable' : 'device-payable'")
    expect(supplierLedger).toContain("createHash('sha256').update(rawScope).digest('hex')")
    expect(supplierLedger).toContain('creationIdempotencyKey,')
    expect(supplierLedger).toContain('idempotencyKey: `supplier-initial:${payable.id}`')
    expect(route).toContain("supplierPayableCreationIdempotencyKey(\n      'DEVICE_PURCHASE'")
    expect(olibRoute).toContain("const saleCreationIdempotencyKey = `olib-sale:${createHash('sha256').update(idempotencyKey).digest('hex')}`")
    expect(olibRoute).toContain('creationIdempotencyKey: saleCreationIdempotencyKey')
    expect(olibRoute).toContain('idempotencyKey: `sale-initial:${saleRow.id}`')
    expect(olibRoute).not.toContain('idempotencyKey: `${idempotencyKey}:customer-initial`')
  })
})
