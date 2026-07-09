import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Split payment (e.g. half cash, half card). The pure validation
 * (validatePaymentBreakdown/representativePaymentMethod) is unit-tested in
 * tests/payment-breakdown.test.ts; these guard tests confirm the sale and
 * nasiya payment routes, Telegram templates, and payment-history UI all
 * actually wire it in, and that a normal single-method payment is
 * unaffected (paymentMethod stays populated on every row).
 *
 * BUGFIX (docs/product-feature-fixes.md's split-payment amount-entry fix):
 * the split UI used to have a single "Miqdor" field that meant TOTAL, plus
 * a second field for the FIRST part's amount — so "first field" actually
 * meant "whole total" while a second, separate field meant "first part",
 * and the true first part was the difference. Fixed so each payment method
 * has its OWN, independently-typed amount, and the total is always
 * displayed as the (read-only) SUM of the two parts.
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

  it('rejects (does not proceed) when validatePaymentBreakdown returns an error', () => {
    const validateIndex = source.indexOf('validatePaymentBreakdown(parsed.data.paymentBreakdown, parsed.data.amount)')
    const block = source.slice(validateIndex, validateIndex + 200)
    expect(block).toContain('if (breakdownError) return badRequest(breakdownError)')
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

  it('rejects (does not proceed) when validatePaymentBreakdown returns an error', () => {
    const validateIndex = source.indexOf('validatePaymentBreakdown(paymentBreakdown, amount)')
    const block = source.slice(validateIndex, validateIndex + 200)
    expect(block).toContain('if (breakdownError) return badRequest(breakdownError)')
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

describe('payment-breakdown.ts: backend rejects duplicate methods and missing methods (defense in depth beyond the frontend check)', () => {
  const source = read('src/lib/payment-breakdown.ts')

  it('rejects a part with no method', () => {
    expect(source).toContain('if (!part.method) {')
  })

  it('rejects duplicate methods across parts', () => {
    expect(source).toContain('new Set(methods).size !== methods.length')
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

  it('formats each part with its own amount (never the total or only the second part)', () => {
    expect(source).toContain('function formatPaymentBreakdown(')
    expect(source).toContain('data.paymentBreakdown?.length')
    const fnStart = source.indexOf('function formatPaymentBreakdown(')
    const fnBlock = source.slice(fnStart, fnStart + 700)
    expect(fnBlock).toContain('parts.map(')
    expect(fnBlock).toContain('part.amount')
  })
})

describe('payment history UI shows each split part with its own amount, inline (not hidden in a hover-only tooltip)', () => {
  it('nasiya detail page renders one line per part with formatUserFacingMoney, using the payment\'s own input currency', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(source).toContain('payment.paymentBreakdown?.length')
    expect(source).toContain('payment.paymentBreakdown.map((p, i) =>')
    expect(source).toContain('amountCurrency: payment.paymentInputCurrency ?? \'UZS\'')
    // The old bug's "Naqd + Karta" (method names only, amounts hidden in a
    // `title=` tooltip) must be gone.
    expect(source).not.toMatch(/payment\.paymentBreakdown\.map\(\(p\) => paymentMethodLabel\(p\.method\)\)\.join\(' \+ '\)/)
  })

  it('device detail page (sale payments) does the same', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    expect(source).toContain('payment.paymentBreakdown?.length')
    expect(source).toContain('payment.paymentBreakdown.map((p, i) =>')
    expect(source).toContain('amountCurrency: payment.paymentInputCurrency ?? \'UZS\'')
    expect(source).not.toMatch(/payment\.paymentBreakdown\.map\(\(p\) => paymentMethodLabel\(p\.method\)\)\.join\(' \+ '\)/)
  })
})

describe('nasiya payment modal: split-payment UI has two independent amount fields, not "total + second part"', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('has a split-payment checkbox toggle', () => {
    expect(source).toContain('checked={splitPayment}')
  })

  it('has TWO independent amount input states — no single field is silently reused as the total', () => {
    expect(source).toContain("const [splitAmount1Input, setSplitAmount1Input] = useState('')")
    expect(source).toContain("const [splitAmount2Input, setSplitAmount2Input] = useState('')")
  })

  it('the total is calculated as part 1 + part 2 (never a total-minus-second-part subtraction)', () => {
    expect(source).toContain(
      'const splitTotal = Math.round((Number(splitAmount1Input || 0) + Number(splitAmount2Input || 0)) * 100) / 100',
    )
    // The old buggy formula must be gone.
    expect(source).not.toMatch(/Number\(payAmount \|\| 0\) - Number\(splitAmount1Input \|\| 0\)/)
  })

  it('the single "Miqdor" field is only used in non-split mode — split mode never re-purposes it as the total', () => {
    expect(source).toContain('{!carryOver && !splitPayment && (')
  })

  it('both parts require their own method and a positive amount, and the two methods must differ', () => {
    expect(source).toContain('splitAmount1Input.trim().length > 0')
    expect(source).toContain('Number(splitAmount1Input) > 0')
    expect(source).toContain('splitAmount2Input.trim().length > 0')
    expect(source).toContain('Number(splitAmount2Input) > 0')
    expect(source).toContain('splitMethod2 !== payMethod')
  })

  it('the recommended-amount button fills PART 1 and clears part 2, rather than filling a "total" field', () => {
    const btnIndex = source.lastIndexOf('Tavsiya etilgan summa: {dfmt(selectedScheduleContractOutstanding)}')
    const btnRegion = source.slice(Math.max(0, btnIndex - 900), btnIndex)
    expect(btnRegion).toContain('setSplitAmount1Input(')
    expect(btnRegion).toContain("setSplitAmount2Input('')")
  })

  it('submits paymentBreakdown with BOTH parts\' real typed amounts (not a computed remainder)', () => {
    expect(source).toContain('{ method: payMethod, amount: Number(splitAmount1Input) }')
    expect(source).toContain('{ method: splitMethod2, amount: Number(splitAmount2Input) }')
  })

  it('the submitted total in split mode is the split total, and single-mode amount entry is untouched', () => {
    expect(source).toContain('amount: carryOver ? 0 : splitPayment ? splitTotal : Number(payAmount)')
  })

  it('displays a calculated (read-only) "Jami to\'lov" total, never an editable total field in split mode', () => {
    expect(source).toContain('Jami to&apos;lov')
    expect(source).toContain('{currencyLabel(currency.currency)} {splitTotal.toLocaleString(\'ru-RU\')}')
  })
})

/**
 * Mirrors the nasiya split-payment modal pattern (above) into the sale
 * payment modal on the device detail page.
 */
describe('sale payment modal: split-payment UI has two independent amount fields, not "total + second part"', () => {
  const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('has a split-payment checkbox toggle', () => {
    expect(source).toContain('checked={saleSplitPayment}')
  })

  it('has TWO independent amount input states', () => {
    expect(source).toContain("const [saleSplitAmount1Input, setSaleSplitAmount1Input] = useState('')")
    expect(source).toContain("const [saleSplitAmount2Input, setSaleSplitAmount2Input] = useState('')")
  })

  it('the total is calculated as part 1 + part 2 (never a total-minus-second-part subtraction)', () => {
    expect(source).toContain(
      'const saleSplitTotal = Math.round((Number(saleSplitAmount1Input || 0) + Number(saleSplitAmount2Input || 0)) * 100) / 100',
    )
    expect(source).not.toMatch(/Number\(salePayAmount \|\| 0\) - Number\(saleSplitAmount1Input \|\| 0\)/)
  })

  it('both parts require their own method and a positive amount, and the two methods must differ', () => {
    expect(source).toContain('saleSplitAmount1Input.trim().length > 0')
    expect(source).toContain('Number(saleSplitAmount1Input) > 0')
    expect(source).toContain('saleSplitAmount2Input.trim().length > 0')
    expect(source).toContain('Number(saleSplitAmount2Input) > 0')
    expect(source).toContain('saleSplitMethod2 !== salePayMethod')
  })

  it('blocks submission when the split is invalid (guard in the handler, not just the button)', () => {
    const handlerStart = source.indexOf('function handleSalePayment')
    const handlerBlock = source.slice(handlerStart, handlerStart + 600)
    expect(handlerBlock).toContain('!saleSplitValid')
  })

  it('submits paymentBreakdown with BOTH parts\' real typed amounts (not a computed remainder)', () => {
    expect(source).toContain('amount: Number(saleSplitAmount1Input)')
    expect(source).toContain('{ method: saleSplitMethod2, amount: Number(saleSplitAmount2Input) }')
  })

  it('the submitted amount in split mode is the split total, and single-mode amount entry is untouched', () => {
    expect(source).toContain('const saleEffectiveAmount = saleSplitPayment ? saleSplitTotal : Number(salePayAmount || 0)')
    expect(source).toContain('amount: saleEffectiveAmount')
  })

  it('displays a calculated (read-only) "Jami to\'lov" total', () => {
    expect(source).toContain('Jami to&apos;lov')
    expect(source).toContain("{currencyLabel(currency.currency)} {saleSplitTotal.toLocaleString('ru-RU')}")
  })

  it('resets split state after a successful payment', () => {
    expect(source).toContain('setSaleSplitPayment(false)')
    expect(source).toContain("setSaleSplitMethod2('')")
    expect(source).toContain("setSaleSplitAmount1Input('')")
    expect(source).toContain("setSaleSplitAmount2Input('')")
  })
})

describe('single (non-split) payment mode is unaffected by the split-mode fix', () => {
  it('nasiya modal: single mode still submits the plain "Miqdor" field with no paymentBreakdown', () => {
    const source = read('src/components/shop/nasiya-payment-modal.tsx')
    expect(source).toContain('paymentBreakdown:\n            !carryOver && splitPayment')
    // Single-mode canSubmit path still requires the plain amount field.
    expect(source).toContain('const hasEffectiveAmount = splitPayment ? splitTotal > 0 : payAmount.trim().length > 0')
  })

  it('sale modal: single mode still submits the plain "Miqdor" field with no paymentBreakdown', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    expect(source).toContain('paymentBreakdown: saleSplitPayment')
    expect(source).toContain('const saleHasEffectiveAmount = saleSplitPayment ? saleSplitTotal > 0 : salePayAmount.trim().length > 0')
  })
})
