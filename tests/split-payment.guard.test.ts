import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validatePaymentBreakdown } from '@/lib/payment-breakdown'

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
    const validateIndex = source.indexOf('const breakdownError = validatePaymentBreakdown(')
    const block = source.slice(validateIndex, validateIndex + 300)
    expect(validateIndex).toBeGreaterThan(-1)
    expect(block).toContain('parsed.data.paymentBreakdown')
    expect(block).toContain('parsed.data.amount')
    expect(block).toContain("parsed.data.inputCurrency ?? 'UZS'")
  })

  it('rejects (does not proceed) when validatePaymentBreakdown returns an error', () => {
    const validateIndex = source.indexOf('const breakdownError = validatePaymentBreakdown(')
    const block = source.slice(validateIndex, validateIndex + 400)
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
    const validateIndex = source.indexOf('const breakdownError = validatePaymentBreakdown(')
    const block = source.slice(validateIndex, validateIndex + 260)
    expect(validateIndex).toBeGreaterThan(-1)
    expect(block).toContain('paymentBreakdown')
    expect(block).toContain('amount')
    expect(block).toContain('parsed.data.inputCurrency')
    expect(block).not.toContain("?? 'UZS'")
  })

  it('rejects (does not proceed) when validatePaymentBreakdown returns an error', () => {
    const validateIndex = source.indexOf('const breakdownError = validatePaymentBreakdown(')
    const block = source.slice(validateIndex, validateIndex + 320)
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

describe('split payment minor units follow the submitted currency', () => {
  it('rejects fractional UZS parts even when their sum matches the total', () => {
    expect(validatePaymentBreakdown([
      { method: 'CASH', amount: 500.5 },
      { method: 'CARD', amount: 499.5 },
    ], 1_000, 'UZS')).toContain("butun so'mda")
  })

  it('accepts two-decimal USD parts whose sum matches the total', () => {
    expect(validatePaymentBreakdown([
      { method: 'CASH', amount: 50.25 },
      { method: 'CARD', amount: 49.75 },
    ], 100, 'USD')).toBeNull()
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
  it('nasiya detail page renders one exact MoneyDto line per payment part', () => {
    const source = read('src/components/shop/nasiya-history-sections.tsx')
    expect(source).toContain('payment.paymentBreakdown?.length')
    expect(source).toContain('payment.paymentBreakdown.map((part, index) =>')
    expect(source).toContain('formatMoneyDto(part.amount)')
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

  it('the total is calculated as exact part-1 + part-2 minor units (never a subtraction)', () => {
    expect(source).toContain('const splitMoney = splitPart1Money && splitPart2Money')
    expect(source).toContain('? addMoneyDto(splitPart1Money, splitPart2Money)')
    // The old buggy formula must be gone.
    expect(source).not.toMatch(/Number\(payAmount \|\| 0\) - Number\(splitAmount1Input \|\| 0\)/)
  })

  it('the single "Miqdor" field is only used in non-split mode — split mode never re-purposes it as the total', () => {
    expect(source).toContain('{!splitPayment && (')
  })

  it('both parts require their own method and a positive amount, and the two methods must differ', () => {
    expect(source).toContain('splitAmount1Input.trim().length > 0')
    expect(source).toContain('splitPart1Money && splitPart1Money.minorUnits > 0')
    expect(source).toContain('splitAmount2Input.trim().length > 0')
    expect(source).toContain('splitPart2Money && splitPart2Money.minorUnits > 0')
    expect(source).toContain('splitMethod2 !== payMethod')
  })

  it('the recommended-amount button fills PART 1 and clears part 2, rather than filling a "total" field', () => {
    const btnIndex = source.lastIndexOf('Tavsiya etilgan summa: {moneyView(selectedScheduleRemaining)}')
    const btnRegion = source.slice(Math.max(0, btnIndex - 900), btnIndex)
    expect(btnRegion).toContain('setSplitAmount1Input(')
    expect(btnRegion).toContain("setSplitAmount2Input('')")
  })

  it('submits paymentBreakdown with BOTH parts\' real typed amounts (not a computed remainder)', () => {
    expect(source).toContain('{ method: payMethod, amount: moneyDtoToAmount(splitPart1Money!) }')
    expect(source).toContain('{ method: splitMethod2, amount: moneyDtoToAmount(splitPart2Money!) }')
  })

  it('the submitted total in split mode is the split total, and single-mode amount entry is untouched', () => {
    expect(source).toContain('amount: moneyDtoToAmount(enteredMoney!)')
  })

  it('displays a calculated (read-only) "Jami to\'lov" total, never an editable total field in split mode', () => {
    expect(source).toContain('Jami to&apos;lov')
    expect(source).toContain("{splitMoney ? formatMoneyDto(splitMoney) : '—'}")
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
    expect(source.replace(/\s+/g, ' ')).toContain('paymentBreakdown: splitPayment')
    // Single-mode canSubmit path still requires the plain amount field.
    expect(source).toContain('const hasEffectiveAmount = Boolean(enteredMoney && enteredMoney.minorUnits > 0)')
  })

  it('sale modal: single mode still submits the plain "Miqdor" field with no paymentBreakdown', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    expect(source).toContain('paymentBreakdown: saleSplitPayment')
    expect(source).toContain('const saleHasEffectiveAmount = saleSplitPayment ? saleSplitTotal > 0 : salePayAmount.trim().length > 0')
  })
})

/**
 * REMAINING-AMOUNT UX FIX (docs/product-feature-fixes.md's split-payment
 * remaining-amount fix): after the amount-entry fix above, the split UI
 * still showed a stale/confusing second-amount value (e.g. a leftover
 * "40.00" default) instead of automatically reflecting how much is left of
 * the suggested amount. Fixed so part 2 auto-fills from
 * `suggestedAmount - part1` while untouched, freezes once the user edits it
 * directly, and a "Qolganini qo'yish" button can refill it on demand — and
 * so every split-mode entry point (modal open, split-mode toggle) starts
 * from a clean slate rather than carrying over stale values.
 */
describe('nasiya payment modal: remaining-amount auto-fill UX', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('tracks whether the second amount was manually edited', () => {
    expect(source).toContain("const [splitAmount2Touched, setSplitAmount2Touched] = useState(false)")
  })

  it('resets the touched flag (and all split fields) when the modal opens for a fresh load', () => {
    const loadIndex = source.indexOf('useEffect(() => {\n    if (!open || !nasiyaId) return')
    const loadBlock = source.slice(loadIndex, loadIndex + 900)
    expect(loadBlock).toContain("setSplitAmount1Input('')")
    expect(loadBlock).toContain("setSplitAmount2Input('')")
    expect(loadBlock).toContain('setSplitAmount2Touched(false)')
  })

  it('resets all split fields (including the touched flag) when split mode is toggled in either direction', () => {
    const toggleIndex = source.indexOf('checked={splitPayment}')
    const toggleBlock = source.slice(toggleIndex, toggleIndex + 600)
    expect(toggleBlock).toContain('setSplitPayment(e.target.checked)')
    expect(toggleBlock).toContain("setSplitAmount1Input('')")
    expect(toggleBlock).toContain("setSplitAmount2Input('')")
    expect(toggleBlock).toContain('setSplitAmount2Touched(false)')
  })

  it('computes a shared suggested/target amount for the split card', () => {
    expect(source).toContain('const suggestedMoney = selectedScheduleRemaining')
  })

  it('auto-fills the second amount from suggestedAmount - firstAmount when untouched, on every first-amount change', () => {
    const idx = source.indexOf('value={splitAmount1Input}')
    const block = source.slice(idx, idx + 600)
    expect(block).toContain('if (!splitAmount2Touched)')
    expect(block).toContain('const remaining = suggestedRemainderAfterFirstPart(v)')
    expect(block).toContain("setSplitAmount2Input(remaining ? formatAmountForInput(remaining) : '')")
  })

  it('marks the second amount as touched as soon as the user edits it directly, so auto-fill stops overwriting it', () => {
    const idx = source.indexOf('value={splitAmount2Input}')
    const block = source.slice(idx, idx + 300)
    expect(block).toContain('setSplitAmount2Touched(true)')
  })

  it('has a "Qolganini qo\'yish" button that refills the second amount from the remaining suggested amount and resumes auto-follow', () => {
    const idx = source.indexOf("Qolganini qo&apos;yish")
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(Math.max(0, idx - 900), idx)
    expect(block).toContain('const remaining = suggestedRemainderAfterFirstPart(splitAmount1Input)')
    expect(block).toContain('setSplitAmount2Touched(false)')
  })

  it('shows "Qolgan"/"Ortiqcha" from exact MoneyDto comparison against the suggested amount', () => {
    expect(source).toContain('const splitComparison = splitMoney && suggestedMoney && !moneyDtoEquals(splitMoney, suggestedMoney)')
    expect(source).toContain('Qolgan: {formatMoneyDto(splitComparison.amount)}')
    expect(source).toContain('Ortiqcha: {formatMoneyDto(splitComparison.amount)}')
  })
})

describe('sale payment modal: remaining-amount auto-fill UX (mirrors the nasiya modal fix)', () => {
  const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('tracks whether the second amount was manually edited', () => {
    expect(source).toContain('const [saleSplitAmount2Touched, setSaleSplitAmount2Touched] = useState(false)')
  })

  it('resets all split fields (including the touched flag) when opening the modal and after a successful payment', () => {
    expect(source).toContain('setSaleSplitAmount2Touched(false)')
    const successIdx = source.indexOf("setSalePaymentOpen(false)")
    const successBlock = source.slice(successIdx, successIdx + 300)
    expect(successBlock).toContain('setSaleSplitAmount2Touched(false)')
  })

  it('resets all split fields (including the touched flag) when split mode is toggled in either direction', () => {
    const toggleIndex = source.indexOf('checked={saleSplitPayment}')
    const toggleBlock = source.slice(toggleIndex, toggleIndex + 500)
    expect(toggleBlock).toContain('setSaleSplitPayment(e.target.checked)')
    expect(toggleBlock).toContain("setSaleSplitAmount1Input('')")
    expect(toggleBlock).toContain("setSaleSplitAmount2Input('')")
    expect(toggleBlock).toContain('setSaleSplitAmount2Touched(false)')
  })

  it('computes a shared suggested/target amount mirroring the "Qolgan to\'lovni qabul qilish" button\'s own suggestion formula', () => {
    expect(source).toContain('const saleSuggestedAmountNumber: number | null =')
  })

  it('auto-fills the second amount from suggestedAmount - firstAmount when untouched', () => {
    const idx = source.indexOf('value={saleSplitAmount1Input}')
    const block = source.slice(idx, idx + 600)
    expect(block).toContain('if (!saleSplitAmount2Touched && saleSuggestedAmountNumber != null)')
    expect(block).toContain('Math.max(0, roundSaleDisplayAmount(saleSuggestedAmountNumber) - Number(v || 0))')
  })

  it('marks the second amount as touched as soon as the user edits it directly', () => {
    const idx = source.indexOf('value={saleSplitAmount2Input}')
    const block = source.slice(idx, idx + 300)
    expect(block).toContain('setSaleSplitAmount2Touched(true)')
  })

  it('has a "Qolganini qo\'yish" button that refills the second amount and resumes auto-follow', () => {
    const idx = source.indexOf("Qolganini qo&apos;yish")
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(Math.max(0, idx - 900), idx)
    expect(block).toContain(
      'Math.max(\n                            0,\n                            roundSaleDisplayAmount(saleSuggestedAmountNumber) - Number(saleSplitAmount1Input || 0),\n                          )',
    )
    expect(block).toContain('setSaleSplitAmount2Touched(false)')
  })

  it('shows "Qolgan"/"Ortiqcha" against the suggested amount, hidden when within currency dust tolerance', () => {
    expect(source).toContain(
      'isContractCurrencyDust(saleSplitTotal - roundSaleDisplayAmount(saleSuggestedAmountNumber), currency.currency)',
    )
    expect(source).toContain('Qolgan: {currencyLabel(currency.currency)}')
    expect(source).toContain('Ortiqcha: {currencyLabel(currency.currency)}')
  })
})

describe('split payment worked example (suggested=$6, part1=$3): auto-fill and remaining/overpayment arithmetic', () => {
  // Pure re-implementation of the auto-fill/remaining formulas used by both
  // modals, to lock in the exact worked example from the ticket without
  // needing a jsdom/RTL render harness (this codebase's guard tests assert
  // wiring via source strings; this test asserts the formula's arithmetic).
  const roundDisplayAmount = (n: number) => Math.round(n * 100) / 100
  const computeAutoFill = (suggested: number, amount1: number) => Math.max(0, roundDisplayAmount(suggested) - amount1)
  const splitTotal = (a1: number, a2: number) => Math.round((a1 + a2) * 100) / 100

  it('typing part1=$3 against a $6 suggestion auto-fills part2=$3, total=$6, no remaining/overpayment', () => {
    const part2 = computeAutoFill(6, 3)
    expect(part2).toBe(3)
    const total = splitTotal(3, part2)
    expect(total).toBe(6)
    expect(Math.abs(total - 6)).toBeLessThan(0.01)
  })

  it('manually changing part2 to $2 gives total=$5, remaining=$1', () => {
    const total = splitTotal(3, 2)
    expect(total).toBe(5)
    expect(6 - total).toBe(1)
  })

  it('manually changing part2 to $4 gives total=$7, overpayment=$1', () => {
    const total = splitTotal(3, 4)
    expect(total).toBe(7)
    expect(total - 6).toBe(1)
  })

  it('clicking "Qolganini qo\'yish" after part2 was edited restores part2=$3, total=$6', () => {
    const part2 = computeAutoFill(6, 3)
    expect(part2).toBe(3)
    expect(splitTotal(3, part2)).toBe(6)
  })
})
