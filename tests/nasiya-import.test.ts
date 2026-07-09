import { describe, it, expect } from 'vitest'
import { generateImportSchedule } from '@/lib/nasiya-utils'
import { nasiyaImportedMessage } from '@/lib/telegram-templates'

const NEXT = new Date(2026, 7, 1) // 2026-08-01 local

describe('generateImportSchedule', () => {
  it('splits an exact multiple into equal monthly instalments', () => {
    const s = generateImportSchedule(NEXT, 3_700_000, 740_000)
    expect(s).toHaveLength(5)
    expect(s.every((r) => r.expectedAmount === 740_000)).toBe(true)
    expect(s.reduce((sum, r) => sum + r.expectedAmount, 0)).toBe(3_700_000)
  })

  it('puts the remainder on the LAST instalment and still sums exactly', () => {
    const s = generateImportSchedule(NEXT, 3_800_000, 740_000)
    expect(s).toHaveLength(6)
    expect(s.slice(0, 5).every((r) => r.expectedAmount === 740_000)).toBe(true)
    expect(s[5].expectedAmount).toBe(100_000)
    expect(s.reduce((sum, r) => sum + r.expectedAmount, 0)).toBe(3_800_000)
  })

  it('handles debt smaller than one monthly payment (single instalment)', () => {
    const s = generateImportSchedule(NEXT, 500_000, 740_000)
    expect(s).toHaveLength(1)
    expect(s[0].expectedAmount).toBe(500_000)
  })

  it('starts due dates at nextPaymentDate and steps one month each', () => {
    const s = generateImportSchedule(NEXT, 2_000_000, 1_000_000)
    expect(s[0].dueDate.getTime()).toBe(NEXT.getTime())
    expect(s[1].dueDate.getMonth()).toBe((NEXT.getMonth() + 1) % 12)
  })

  it('always sums exactly to the remaining debt for assorted inputs', () => {
    for (const [debt, monthly] of [
      [1_234_567, 200_000],
      [9_999_999, 1_000_000],
      [10_000, 3_000],
      [7_400_000, 740_000],
    ] as const) {
      const s = generateImportSchedule(NEXT, debt, monthly)
      expect(s.reduce((sum, r) => sum + r.expectedAmount, 0)).toBe(Math.round(debt))
      // No negative or zero instalments.
      expect(s.every((r) => r.expectedAmount > 0)).toBe(true)
    }
  })

  it('rejects non-positive debt or monthly payment', () => {
    expect(() => generateImportSchedule(NEXT, 0, 740_000)).toThrow()
    expect(() => generateImportSchedule(NEXT, -1, 740_000)).toThrow()
    expect(() => generateImportSchedule(NEXT, 100, 0)).toThrow()
  })

  it('defaults to UZS (whole-number split) when no currency is passed — unchanged legacy behavior', () => {
    const s = generateImportSchedule(NEXT, 3_800_000, 740_000)
    expect(s.every((r) => Number.isInteger(r.expectedAmount))).toBe(true)
  })

  it('USD currency splits in cents, not whole dollars — $380 over 6 instalments of $74', () => {
    const s = generateImportSchedule(NEXT, 380, 74, 'USD')
    expect(s).toHaveLength(6)
    expect(s.slice(0, 5).every((r) => r.expectedAmount === 74)).toBe(true)
    expect(s[5].expectedAmount).toBe(10)
    expect(s.reduce((sum, r) => sum + r.expectedAmount, 0)).toBe(380)
  })

  it('monthCountOverride forces the same instalment count regardless of the naturally-derived ratio, still summing exactly', () => {
    // Without an override this would naturally split into 5 instalments.
    const natural = generateImportSchedule(NEXT, 3_700_000, 740_000)
    expect(natural).toHaveLength(5)
    // Forcing 6 (e.g. to match a contract-currency mirror's own count) still
    // sums exactly to the total — used so a nasiya's legacy-UZS and
    // contract-currency schedules never disagree by one row.
    const forced = generateImportSchedule(NEXT, 3_700_000, 740_000, 'UZS', 6)
    expect(forced).toHaveLength(6)
    expect(forced.reduce((sum, r) => sum + r.expectedAmount, 0)).toBe(3_700_000)
  })
})

describe('nasiyaImportedMessage', () => {
  const msg = nasiyaImportedMessage({
    shopName: 'Malika',
    customerName: 'Ali',
    customerPhone: '+998900000000',
    device: { deviceModel: 'iPhone 15', storage: '256GB', color: 'Black', imei: '123456789012345' },
    originalTotalAmount: 5_200_000,
    alreadyPaidBeforeImport: 1_500_000,
    remainingDebt: 3_700_000,
    monthlyPayment: 740_000,
    nextPaymentDate: NEXT,
    adminName: 'Dilshod',
  })

  it('is titled "Eski nasiya import qilindi" and NOT "Yangi nasiya"', () => {
    expect(msg).toContain('Eski nasiya import qilindi')
    expect(msg).not.toContain('Yangi nasiya')
  })

  it('shows original, already-paid and remaining amounts distinctly', () => {
    expect(msg).toMatch(/Eski nasiya summasi: 5.?200.?000 so‘m/)
    expect(msg).toMatch(/Importgacha to‘langan: 1.?500.?000 so‘m/)
    expect(msg).toMatch(/Qolgan qarz: 3.?700.?000 so‘m/)
  })

  it('leaks no sensitive data and uses no Markdown', () => {
    expect(msg).not.toContain('*')
    for (const w of ['passportPhotoUrl', 'password', 'token', 'http', 'IMPORT-']) {
      expect(msg).not.toContain(w)
    }
  })

  it('omits internal placeholder IMEIs from imported nasiya Telegram messages', () => {
    const placeholderMsg = nasiyaImportedMessage({
      shopName: 'Malika',
      customerName: 'Ali',
      customerPhone: '+998900000000',
      device: { deviceModel: 'iPhone 15', storage: '256GB', color: 'Black', imei: 'IMPORT-abc' },
      originalTotalAmount: 5_200_000,
      alreadyPaidBeforeImport: 1_500_000,
      remainingDebt: 3_700_000,
      monthlyPayment: 740_000,
      nextPaymentDate: NEXT,
      adminName: 'Dilshod',
    })

    expect(placeholderMsg).not.toContain('IMPORT-')
    expect(placeholderMsg).not.toContain('IMEI')
  })
})
