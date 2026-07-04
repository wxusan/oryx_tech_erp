import { describe, it, expect } from 'vitest'
import {
  cleanMoneyInput,
  formatMoneyInput,
  parseMoneyInput,
  moneyNumberToInputValue,
} from '@/lib/money-input-format'

describe('formatMoneyInput', () => {
  it('groups thousands with spaces', () => {
    expect(formatMoneyInput('1000')).toBe('1 000')
    expect(formatMoneyInput('1000000')).toBe('1 000 000')
    expect(formatMoneyInput('12500000')).toBe('12 500 000')
  })

  it('keeps decimals while typing', () => {
    expect(formatMoneyInput('1200.50')).toBe('1 200.50')
    expect(formatMoneyInput('1200.5')).toBe('1 200.5')
    expect(formatMoneyInput('1200.')).toBe('1 200.') // trailing dot preserved mid-entry
    expect(formatMoneyInput('.5')).toBe('.5')
  })

  it('is idempotent on an already formatted value', () => {
    expect(formatMoneyInput('1 200 000')).toBe('1 200 000')
    expect(formatMoneyInput('1 200.50')).toBe('1 200.50')
  })

  it('UZS-style whole numbers format cleanly', () => {
    expect(formatMoneyInput('7500000')).toBe('7 500 000')
  })

  it('USD-style decimals format cleanly', () => {
    expect(formatMoneyInput('1200.50')).toBe('1 200.50')
    expect(formatMoneyInput('120.5')).toBe('120.5')
  })

  it('empty input stays empty', () => {
    expect(formatMoneyInput('')).toBe('')
  })
})

describe('cleanMoneyInput', () => {
  it('removes letters and stray characters', () => {
    expect(cleanMoneyInput('1a2b3c')).toBe('123')
    expect(cleanMoneyInput('1 200 000 so\'m')).toBe('1200000')
    expect(cleanMoneyInput('$1,200.50')).toBe('1200.50')
  })

  it('collapses multiple dots to the first one', () => {
    expect(cleanMoneyInput('1.2.3')).toBe('1.23')
    expect(cleanMoneyInput('1..2')).toBe('1.2')
    expect(cleanMoneyInput('12..')).toBe('12.')
  })

  it('handles empty/nullish safely', () => {
    expect(cleanMoneyInput('')).toBe('')
    // @ts-expect-error runtime guard for null
    expect(cleanMoneyInput(null)).toBe('')
  })
})

describe('parseMoneyInput', () => {
  it('parses formatted values to numbers', () => {
    expect(parseMoneyInput('1 200 000')).toBe(1200000)
    expect(parseMoneyInput('1 200.50')).toBe(1200.5)
    expect(parseMoneyInput('7 500 000')).toBe(7500000)
  })

  it('returns NaN for empty / dot-only input', () => {
    expect(parseMoneyInput('')).toBeNaN()
    expect(parseMoneyInput('.')).toBeNaN()
    expect(parseMoneyInput('abc')).toBeNaN()
  })
})

describe('moneyNumberToInputValue', () => {
  it('rounds UZS to whole numbers (no spaces)', () => {
    expect(moneyNumberToInputValue(1200000)).toBe('1200000')
    expect(moneyNumberToInputValue(1200000.7)).toBe('1200001')
  })

  it('keeps up to 2 decimals for USD', () => {
    expect(moneyNumberToInputValue(1200.5, 'USD')).toBe('1200.5')
    expect(moneyNumberToInputValue(1200.555, 'USD')).toBe('1200.56')
  })

  it('handles non-finite safely', () => {
    expect(moneyNumberToInputValue(NaN)).toBe('')
  })

  it('round-trips through parse for a formatted display', () => {
    const stored = 12500000
    const display = formatMoneyInput(moneyNumberToInputValue(stored))
    expect(display).toBe('12 500 000')
    expect(parseMoneyInput(display)).toBe(stored)
  })
})
