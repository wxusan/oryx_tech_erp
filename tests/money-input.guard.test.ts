import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guard: every MONEY input uses the text-based MoneyInput (no browser steppers),
// not <Input type="number">. Deliberately scoped to specific money value
// bindings so non-money number inputs (battery %, interest %, months) are left
// alone.

function readFlat(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// file -> money value bindings that must live inside a <MoneyInput ...>
const moneyBindings: Record<string, string[]> = {
  'src/app/(shop)/shop/sotuv/new/page.tsx': ['salePrice', 'partialAmount'],
  'src/app/(shop)/shop/nasiyalar/new/page.tsx': ['totalPrice', 'downPayment'],
  'src/app/(shop)/shop/nasiyalar/[id]/page.tsx': ['payAmount'],
  'src/app/(shop)/shop/qurilmalar/new/page.tsx': ['form.purchasePrice'],
  'src/app/(shop)/shop/qurilmalar/[id]/page.tsx': ['editForm.purchasePrice', 'salePayAmount', 'returnRefundAmount'],
  'src/app/(shop)/shop/nasiyalar/import/page.tsx': [
    'form.originalTotalAmount',
    'form.alreadyPaidBeforeImport',
    'form.remainingDebt',
    'form.monthlyPayment',
  ],
  'src/app/(admin)/admin/shops/[id]/page.tsx': ['payAmount'],
  'src/app/(admin)/admin/settings/settings-client.tsx': ['manualRate'],
}

describe('money inputs use MoneyInput, not type="number"', () => {
  for (const [file, bindings] of Object.entries(moneyBindings)) {
    it(`${file}: money fields are MoneyInput`, () => {
      const src = readFlat(file)
      expect(src, `${file} should import MoneyInput`).toContain("from '@/components/ui/money-input'")
      for (const binding of bindings) {
        // The binding must appear inside a <MoneyInput ...> opening tag.
        const insideMoney = new RegExp(`<MoneyInput[^>]*value=\\{${escapeRe(binding)}\\}`)
        expect(insideMoney.test(src), `${file}: value={${binding}} should be inside <MoneyInput>`).toBe(true)
        // ...and must NOT be a number input.
        const asNumber = new RegExp(`type="number"[^>]*value=\\{${escapeRe(binding)}\\}`)
        expect(asNumber.test(src), `${file}: value={${binding}} must not be type="number"`).toBe(false)
      }
    })
  }
})

describe('MoneyInput component itself has no browser steppers', () => {
  const src = readFlat('src/components/ui/money-input.tsx')
  it('is a text input with inputMode=decimal and no type="number"', () => {
    expect(src).toContain("type=\"text\"")
    expect(src).toContain('inputMode="decimal"')
    expect(src).not.toContain('type="number"')
  })
  it('emits a clean (space-free) value via cleanMoneyInput', () => {
    expect(src).toContain('cleanMoneyInput(el.value)')
    expect(src).toContain('onChange(clean)')
  })
})

describe('CSS fallback hides steppers on any remaining number inputs', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
  it('globals.css removes webkit/moz number spinners', () => {
    expect(css).toContain('-webkit-inner-spin-button')
    expect(css).toContain('appearance: textfield')
  })
})
