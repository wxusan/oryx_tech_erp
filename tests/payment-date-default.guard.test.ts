import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tashkentTodayInputValue, tashkentDayRange } from '@/lib/timezone'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('tashkentTodayInputValue', () => {
  it('returns the Tashkent calendar day as YYYY-MM-DD', () => {
    const now = new Date('2026-07-08T23:30:00.000Z') // late UTC, already the next Tashkent day
    expect(tashkentTodayInputValue(now)).toBe(tashkentDayRange(now).dayKey)
    expect(tashkentTodayInputValue(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('is not hardcoded to any fixed date (moves with `now`)', () => {
    const a = tashkentTodayInputValue(new Date('2026-01-01T04:00:00.000Z'))
    const b = tashkentTodayInputValue(new Date('2026-12-31T04:00:00.000Z'))
    expect(a).not.toBe(b)
  })
})

describe('nasiya payment modal defaults the date field to today', () => {
  const modal = read('src/components/shop/nasiya-payment-modal.tsx')

  it('imports and uses tashkentTodayInputValue instead of a hardcoded/empty default', () => {
    expect(modal).toContain("import { tashkentTodayInputValue } from '@/lib/timezone'")
    expect(modal).toContain('setPayDate(tashkentTodayInputValue())')
    // Regression guard: must not silently reset to blank on open.
    expect(modal).not.toContain("setPayDate('')")
  })

  it('is the single modal shared by both the nasiyalar list and the detail page', () => {
    const listPage = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
    const detailPage = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(listPage).toContain('NasiyaPaymentModal')
    expect(detailPage).toContain('NasiyaPaymentModal')
  })

  it('still submits the user-selected date (not silently overridden)', () => {
    expect(modal).toContain('date: new Date(payDate).toISOString()')
  })
})
