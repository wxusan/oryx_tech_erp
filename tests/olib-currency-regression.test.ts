import { describe, expect, it } from 'vitest'
import { formatUserFacingMoney } from '@/lib/currency'

describe('Olib-sotdim screenshot currency regression', () => {
  it('keeps native USD input native in review and profit output', () => {
    const display = (amount: number) => formatUserFacingMoney({ amount, amountCurrency: 'USD', displayCurrency: 'USD', rate: 12_600 })
    expect(display(500)).toBe('$500.00')
    expect(display(800)).toBe('$800.00')
    expect(display(800 - 500)).toBe('$300.00')
  })
})
