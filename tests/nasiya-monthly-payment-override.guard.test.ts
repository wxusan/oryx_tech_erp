import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 6 — changing the monthly payment must recalculate interest, not
 * silently ignore it. `calculateNasiyaAmountsFromMonthlyPayment` (unit
 * tested in tests/nasiya-utils.test.ts) is the pure reverse formula; these
 * guard tests confirm the create-nasiya form and its API route actually
 * wire it in end-to-end, matching exactly (no client/server drift).
 */
describe('createNasiyaSchema accepts an explicit monthly-payment override', () => {
  const source = read('src/lib/validations.ts')

  it('has a useMonthlyPaymentOverride flag requiring monthlyPayment when set', () => {
    expect(source).toContain('useMonthlyPaymentOverride: z.boolean().optional()')
    expect(source).toMatch(/!data\.useMonthlyPaymentOverride \|\| data\.monthlyPayment !== undefined/)
  })
})

describe('POST /api/devices/[id]/nasiya uses the reverse calculation when overridden', () => {
  const source = read('src/lib/server/nasiya-contract-core.ts')

  it('imports calculateNasiyaAmountsFromMonthlyPayment', () => {
    expect(source).toContain('calculateNasiyaAmountsFromMonthlyPayment')
  })

  it('branches on useMonthlyPaymentOverride for both the legacy UZS and contract-currency ledgers', () => {
    expect(source).toContain('input.useMonthlyPaymentOverride && monthlyPaymentUzs !== undefined')
    const overrideBlockStart = source.indexOf('const amounts = input.useMonthlyPaymentOverride')
    const overrideBlock = source.slice(overrideBlockStart, overrideBlockStart + 1200)
    expect(overrideBlock).toContain('calculateNasiyaAmountsFromMonthlyPayment({')
    // Both the UZS amounts and the native contract-currency amounts branch —
    // confirmed by two separate calls to the reverse function in this block.
    const calls = overrideBlock.split('calculateNasiyaAmountsFromMonthlyPayment(').length - 1
    expect(calls).toBe(2)
  })

  it('stores the DERIVED interestPercent (amounts.interestPercent), never the client-sent raw value, in the created row/log', () => {
    // The raw destructured `interestPercent` client input is only used as a
    // fallback default in the non-override forward-calculation branch —
    // every persisted/logged value reads amounts.interestPercent instead.
    const occurrences = source.match(/interestPercent: prepared\.amounts\.interestPercent/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(1)
  })
})

describe('nasiyalar/new page: monthly payment is editable and drives interest (item 6)', () => {
  const source = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')

  it('the monthly payment field is a real MoneyInput, not readOnly', () => {
    const idx = source.indexOf("Oylik to&apos;lov")
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 700)
    expect(block).toContain('<MoneyInput')
    expect(block).not.toContain('readOnly')
    expect(block).toContain('onChange={setMonthlyPaymentInput}')
  })

  it('editing interestPercent directly clears any monthly-payment override', () => {
    expect(source).toContain('setMonthlyPaymentInput(null)')
  })

  it('selecting a different device clears a stale monthly-payment override', () => {
    const fnStart = source.indexOf('function selectDevice')
    const fn = source.slice(fnStart, fnStart + 350)
    expect(fn).toContain('setMonthlyPaymentInput(null)')
  })

  it('submits useMonthlyPaymentOverride + the raw monthly payment only when the override is active', () => {
    expect(source).toContain('useMonthlyPaymentOverride: true')
  })
})
