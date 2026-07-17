import { describe, it, expect } from 'vitest'
import { paymentMethodLabel } from '@/lib/labels'

describe('paymentMethodLabel — user-facing labels are Uzbek, internal enum unchanged', () => {
  it('maps every PaymentMethod enum value to Uzbek', () => {
    expect(paymentMethodLabel('CASH')).toBe('Naqd pul')
    expect(paymentMethodLabel('CARD')).toBe('Karta orqali')
    expect(paymentMethodLabel('TRANSFER')).toBe('Pul o‘tkazmasi')
    expect(paymentMethodLabel('OTHER')).toBe('Boshqa')
  })

  it('falls back gracefully for null/undefined/unknown values', () => {
    expect(paymentMethodLabel(null)).toBe('-')
    expect(paymentMethodLabel(undefined)).toBe('-')
    expect(paymentMethodLabel('SOMETHING_NEW')).toBe('Noma’lum to‘lov usuli')
  })
})
