import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 12 — split payment (e.g. half cash, half card). The pure validation
 * (validatePaymentBreakdown/representativePaymentMethod) is unit-tested in
 * tests/payment-breakdown.test.ts; these guard tests confirm the sale and
 * nasiya payment routes, Telegram templates, and payment-history UI all
 * actually wire it in, and that a normal single-method payment is
 * unaffected (paymentMethod stays populated on every row).
 */
describe('addSalePaymentSchema / addNasiyaPaymentSchema accept an optional paymentBreakdown', () => {
  const source = read('src/lib/validations.ts')

  it('both schemas include paymentBreakdown', () => {
    const saleSchemaStart = source.indexOf('export const addSalePaymentSchema')
    const saleSchema = source.slice(saleSchemaStart, saleSchemaStart + 500)
    expect(saleSchema).toContain('paymentBreakdown: paymentBreakdownSchema')

    const nasiyaSchemaStart = source.indexOf('export const addNasiyaPaymentSchema')
    const nasiyaSchema = source.slice(nasiyaSchemaStart, nasiyaSchemaStart + 700)
    expect(nasiyaSchema).toContain('paymentBreakdown: paymentBreakdownSchema')
  })

  it('requires at least 2 parts (a single part is not a "split")', () => {
    expect(source).toContain(".min(2, \"Aralash to'lov kamida 2 ta usulni")
  })
})

describe('POST /api/sales/[id]/payment validates and stores the split breakdown', () => {
  const source = read('src/app/api/sales/[id]/payment/route.ts')

  it('validates the breakdown sums to the payment amount before proceeding', () => {
    expect(source).toContain('validatePaymentBreakdown(parsed.data.paymentBreakdown, parsed.data.amount)')
  })

  it('stores paymentBreakdown on the created SalePayment row', () => {
    const createStart = source.indexOf('tx.salePayment.create')
    const createBlock = source.slice(createStart, createStart + 600)
    expect(createBlock).toContain('paymentBreakdown: parsed.data.paymentBreakdown')
  })

  it('the legacy paymentMethod column still gets a representative value (never left blank)', () => {
    expect(source).toContain('representativePaymentMethod(parsed.data.paymentBreakdown)')
  })
})

describe('POST /api/nasiya/[id]/payment validates and stores the split breakdown', () => {
  const source = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('validates the breakdown sums to the payment amount before proceeding', () => {
    expect(source).toContain('validatePaymentBreakdown(paymentBreakdown, amount)')
  })

  it('stores paymentBreakdown on the created NasiyaPayment row', () => {
    const createStart = source.indexOf('tx.nasiyaPayment.create')
    const createBlock = source.slice(createStart, createStart + 700)
    expect(createBlock).toContain('paymentBreakdown: paymentBreakdown ?? undefined')
  })

  it('the legacy paymentMethod column still gets a representative value (never left blank)', () => {
    expect(source).toContain('representativePaymentMethod(paymentBreakdown)')
  })
})

describe('Telegram messages show the split breakdown when present', () => {
  const source = read('src/lib/telegram-templates.ts')

  it('salePaymentMessage and nasiyaPaymentMessage both accept paymentBreakdown', () => {
    const saleStart = source.indexOf('export function salePaymentMessage')
    expect(source.slice(saleStart, saleStart + 1200)).toContain('paymentBreakdown?:')

    const nasiyaStart = source.indexOf('export function nasiyaPaymentMessage')
    expect(source.slice(nasiyaStart, nasiyaStart + 1800)).toContain('paymentBreakdown?:')
  })

  it('formats the breakdown as "Method: amount, Method: amount" via formatPaymentBreakdown', () => {
    expect(source).toContain('function formatPaymentBreakdown(')
    expect(source).toContain("data.paymentBreakdown?.length")
  })
})

describe('payment history UI shows the split breakdown when present', () => {
  it('nasiya detail page joins each method with " + " and falls back to the single-method label', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(source).toContain('payment.paymentBreakdown?.length')
    expect(source).toContain("join(' + ')")
  })

  it('device detail page (sale payments) does the same', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    expect(source).toContain('payment.paymentBreakdown?.length')
    expect(source).toContain("join(' + ')")
  })
})

describe('nasiya payment modal: split-payment UI', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('has a split-payment checkbox toggle', () => {
    expect(source).toContain('checked={splitPayment}')
  })

  it("the second part's amount is always the remainder (user only types one side)", () => {
    expect(source).toContain('const splitAmount2 = Math.round((Number(payAmount || 0) - Number(splitAmount1Input || 0))')
  })

  it('cannot submit an incomplete or same-method split', () => {
    expect(source).toContain("splitMethod2 !== payMethod")
  })

  it('submits paymentBreakdown only when the split toggle is on', () => {
    expect(source).toContain('!carryOver && splitPayment')
  })
})

/**
 * Item 13 — mirrors the nasiya split-payment modal pattern (above) into the
 * sale payment modal on the device detail page. Backend/history/Telegram
 * support already existed from item 12; this only adds the missing UI.
 */
describe('sale payment modal: split-payment UI', () => {
  const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('has a split-payment checkbox toggle', () => {
    expect(source).toContain('checked={saleSplitPayment}')
  })

  it("the second part's amount is always the remainder (user only types one side)", () => {
    expect(source).toContain('const saleSplitAmount2 = Math.round((Number(salePayAmount || 0) - Number(saleSplitAmount1Input || 0))')
  })

  it('cannot submit an incomplete or same-method split', () => {
    expect(source).toContain('saleSplitMethod2 !== salePayMethod')
  })

  it('blocks submission when the split is invalid (guard in the handler, not just the button)', () => {
    const handlerStart = source.indexOf('function handleSalePayment')
    const handlerBlock = source.slice(handlerStart, handlerStart + 600)
    expect(handlerBlock).toContain('!saleSplitValid')
  })

  it('submits paymentBreakdown only when the split toggle is on', () => {
    expect(source).toContain('paymentBreakdown: saleSplitPayment')
  })

  it('resets split state after a successful payment', () => {
    expect(source).toContain('setSaleSplitPayment(false)')
    expect(source).toContain('setSaleSplitMethod2(\'\')')
    expect(source).toContain('setSaleSplitAmount1Input(\'\')')
  })
})
