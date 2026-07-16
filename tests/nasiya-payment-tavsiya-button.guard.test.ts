import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 17 — the recommended-amount ("Tavsiya") button inside the nasiya
 * payment modal used to be plain gray underlined text (`text-xs
 * text-zinc-500 hover:underline`) with no border/background — easy to miss,
 * especially on mobile. Fixed to a visible chip/badge-style button (border +
 * background + bolder text), same click behavior, no other redesign.
 */
describe('nasiya payment modal: recommended-amount button is visually prominent', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('has a visible border and background, not just underlined gray text', () => {
    const idx = source.indexOf('Tavsiya etilgan summa:')
    expect(idx).toBeGreaterThan(-1)
    const buttonBlock = source.slice(Math.max(0, idx - 300), idx)
    expect(buttonBlock).toContain('border')
    expect(buttonBlock).toContain('bg-zinc-100')
    expect(buttonBlock).not.toContain('hover:underline')
  })

  it('keeps the same click behavior (fills in the suggested payment amount)', () => {
    expect(source).toContain('setPayAmount(formatAmountForInput(suggestedMoney))')
    expect(source).toContain('convertMoneyDto(selectedScheduleRemaining, currency.currency, currency.fxQuote)')
  })
})
