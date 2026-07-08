import { describe, it, expect } from 'vitest'
import { computeNasiyaPaymentScore, GRACE_DAYS, type NasiyaScoreScheduleInput } from '@/lib/nasiya-payment-score'

const NOW = new Date('2026-07-08T06:00:00.000Z')

function schedule(overrides: Partial<NasiyaScoreScheduleInput> = {}): NasiyaScoreScheduleInput {
  return {
    status: 'PENDING',
    dueDate: new Date('2026-07-01T00:00:00.000Z'),
    delayedUntil: null,
    expectedAmount: 1_000_000,
    paidAmount: 0,
    paidAt: null,
    ...overrides,
  }
}

function paid(dueDate: string, paidAt: string, expectedAmount = 1_000_000): NasiyaScoreScheduleInput {
  return schedule({
    status: 'PAID',
    dueDate: new Date(dueDate),
    paidAmount: expectedAmount,
    expectedAmount,
    paidAt: new Date(paidAt),
  })
}

describe('computeNasiyaPaymentScore', () => {
  it('1. no payments, no overdue -> gray/new', () => {
    const result = computeNasiyaPaymentScore(
      { schedules: [schedule({ dueDate: new Date('2026-08-01') })] },
      NOW,
    )
    expect(result.color).toBe('gray')
    expect(result.label).toBe('Yangi mijoz')
    expect(result.riskLevel).toBe('UNKNOWN')
  })

  it('2. current overdue overrides a good history -> red', () => {
    const schedules = [
      paid('2026-01-01', '2025-12-30'),
      paid('2026-02-01', '2026-01-30'),
      paid('2026-03-01', '2026-02-28'),
      schedule({ dueDate: new Date('2026-06-01'), expectedAmount: 1_000_000, paidAmount: 0 }), // overdue relative to NOW
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).toBe('red')
    expect(result.label).toBe('Kechiktiradi')
    expect(result.riskLevel).toBe('HIGH')
    expect(result.factors.overdueScheduleCount).toBeGreaterThan(0)
  })

  it('3. one early payment only -> not green (capped at yellow)', () => {
    const result = computeNasiyaPaymentScore({ schedules: [paid('2026-06-01', '2026-05-25')] }, NOW)
    expect(result.color).not.toBe('green')
    expect(['yellow', 'red', 'gray']).toContain(result.color)
  })

  it('4. three early payments, no overdue -> green', () => {
    const schedules = [
      paid('2026-01-01', '2025-12-20'),
      paid('2026-02-01', '2026-01-20'),
      paid('2026-03-01', '2026-02-20'),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).toBe('green')
    expect(result.label).toBe('Ishonchli mijoz')
  })

  it('5. three on-time payments -> green or yellow, never red', () => {
    const schedules = [
      paid('2026-01-01', '2026-01-01'),
      paid('2026-02-01', '2026-02-01'),
      paid('2026-03-01', '2026-03-01'),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).not.toBe('red')
  })

  it('6. repeated late payments -> red', () => {
    const schedules = [
      paid('2026-01-01', '2026-01-20'),
      paid('2026-02-01', '2026-02-25'),
      paid('2026-03-01', '2026-03-22'),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).toBe('red')
  })

  it('7. paid 1 day after due date (within grace) counts as on-time', () => {
    const result = computeNasiyaPaymentScore(
      { schedules: [paid('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z')] },
      NOW,
    )
    expect(result.factors.latePaymentCount).toBe(0)
    expect(result.factors.onTimePaymentCount).toBe(1)
    expect(GRACE_DAYS).toBe(1)
  })

  it('8. paid 10+ days late reduces the score', () => {
    const onTimeScore = computeNasiyaPaymentScore({ schedules: [paid('2026-01-01', '2026-01-01')] }, NOW).score
    const lateScore = computeNasiyaPaymentScore({ schedules: [paid('2026-01-01', '2026-01-12')] }, NOW).score
    expect(lateScore).toBeLessThan(onTimeScore)
  })

  it('9. max lateness affects score beyond the average', () => {
    const mildlyLate = computeNasiyaPaymentScore(
      { schedules: [paid('2026-01-01', '2026-01-03'), paid('2026-02-01', '2026-02-03')] },
      NOW,
    ).score
    const oneVeryLate = computeNasiyaPaymentScore(
      { schedules: [paid('2026-01-01', '2026-01-03'), paid('2026-02-01', '2026-03-15')] },
      NOW,
    ).score
    expect(oneVeryLate).toBeLessThan(mildlyLate)
  })

  it('10. paid ratio affects confidence signal, not a standalone green', () => {
    // High paid ratio but currently overdue must never be green.
    const schedules = [
      paid('2026-01-01', '2026-01-01'),
      paid('2026-02-01', '2026-02-01'),
      schedule({ dueDate: new Date('2026-06-01'), paidAmount: 0 }),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).not.toBe('green')
  })

  it('11. only real paidAt history counts (imported lump sums never appear as schedules)', () => {
    // An imported nasiya's alreadyPaidBeforeImport never becomes a PAID schedule
    // row, so a nasiya with only future (unpaid) schedules reads as "new", not
    // as having a payment history — regardless of how much was paid before import.
    const result = computeNasiyaPaymentScore(
      { schedules: [schedule({ dueDate: new Date('2026-08-01'), paidAmount: 0 })] },
      NOW,
    )
    expect(result.factors.paidInstallmentCount).toBe(0)
    expect(result.color).toBe('gray')
  })

  it('12. completed nasiya (all PAID) with good history can be green', () => {
    const schedules = [
      paid('2026-01-01', '2025-12-28'),
      paid('2026-02-01', '2026-01-28'),
      paid('2026-03-01', '2026-02-28'),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).toBe('green')
  })

  it('13. completed nasiya with late history is not green', () => {
    const schedules = [
      paid('2026-01-01', '2026-01-25'),
      paid('2026-02-01', '2026-02-20'),
      paid('2026-03-01', '2026-03-18'),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).not.toBe('green')
  })

  it('14. deterministic for the same input', () => {
    const schedules = [paid('2026-01-01', '2026-01-05'), schedule({ dueDate: new Date('2026-08-01') })]
    const a = computeNasiyaPaymentScore({ schedules }, NOW)
    const b = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(a).toEqual(b)
  })

  it('15. score always clamps to 0-100', () => {
    const veryBad = [
      schedule({ dueDate: new Date('2026-01-01'), paidAmount: 0 }),
      schedule({ dueDate: new Date('2026-02-01'), paidAmount: 0 }),
      schedule({ dueDate: new Date('2026-03-01'), paidAmount: 0 }),
      paid('2026-04-01', '2026-05-20'),
      paid('2026-04-15', '2026-06-10'),
    ]
    const veryGood = [
      paid('2026-01-01', '2025-12-01'),
      paid('2026-02-01', '2026-01-01'),
      paid('2026-03-01', '2026-02-01'),
    ]
    expect(computeNasiyaPaymentScore({ schedules: veryBad }, NOW).score).toBeGreaterThanOrEqual(0)
    expect(computeNasiyaPaymentScore({ schedules: veryGood }, NOW).score).toBeLessThanOrEqual(100)
  })

  it('green badge never appears for a currently-overdue nasiya, no matter the history', () => {
    const schedules = [
      paid('2026-01-01', '2025-12-01'),
      paid('2026-02-01', '2026-01-01'),
      paid('2026-03-01', '2026-02-01'),
      schedule({ dueDate: new Date('2026-06-01'), paidAmount: 0 }),
    ]
    const result = computeNasiyaPaymentScore({ schedules }, NOW)
    expect(result.color).not.toBe('green')
  })
})

describe('computeNasiyaPaymentScore — currency-aware reason text', () => {
  const overdueSchedules = [schedule({ dueDate: new Date('2026-06-01'), expectedAmount: 2_450_000, paidAmount: 0 })]

  it('defaults to UZS ("so\'m") when no currency is passed', () => {
    const result = computeNasiyaPaymentScore({ schedules: overdueSchedules }, NOW)
    expect(result.reason).toContain("so'm")
    expect(result.reason).not.toContain('$')
  })

  it('UZS mode: shows so\'m, never a dollar sign', () => {
    const result = computeNasiyaPaymentScore({ schedules: overdueSchedules }, NOW, { currency: 'UZS', usdUzsRate: null })
    expect(result.reason).toContain("so'm")
    expect(result.reason).not.toContain('$')
  })

  it('USD mode: shows a dollar amount, never raw UZS "so\'m" text', () => {
    const result = computeNasiyaPaymentScore({ schedules: overdueSchedules }, NOW, { currency: 'USD', usdUzsRate: 12_500 })
    expect(result.reason).toContain('$')
    expect(result.reason).not.toContain("so'm")
    // 2,450,000 / 12,500 = 196.00
    expect(result.reason).toContain('$196.00')
  })

  it('the score/label/color/factors never change with currency — only reason text formatting does', () => {
    const uzs = computeNasiyaPaymentScore({ schedules: overdueSchedules }, NOW, { currency: 'UZS', usdUzsRate: null })
    const usd = computeNasiyaPaymentScore({ schedules: overdueSchedules }, NOW, { currency: 'USD', usdUzsRate: 12_500 })
    expect(usd.score).toBe(uzs.score)
    expect(usd.color).toBe(uzs.color)
    expect(usd.label).toBe(uzs.label)
    expect(usd.factors).toEqual(uzs.factors)
  })

  it('non-overdue reasons (history-based, no money amount) are unaffected by currency', () => {
    const noHistory = computeNasiyaPaymentScore({ schedules: [schedule({ dueDate: new Date('2026-08-01') })] }, NOW, {
      currency: 'USD',
      usdUzsRate: 12_500,
    })
    expect(noHistory.reason).toBe("Hali to'lov tarixi yetarli emas")
  })
})
