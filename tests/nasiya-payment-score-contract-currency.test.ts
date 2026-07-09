import { describe, it, expect } from 'vitest'
import { computeNasiyaPaymentScore, type NasiyaScoreScheduleInput } from '@/lib/nasiya-payment-score'

function schedule(overrides: Partial<NasiyaScoreScheduleInput> = {}): NasiyaScoreScheduleInput {
  return {
    status: 'PENDING',
    dueDate: '2026-01-01T00:00:00.000Z',
    delayedUntil: null,
    expectedAmount: 200,
    paidAmount: 0,
    paidAt: null,
    ...overrides,
  }
}

const now = new Date('2026-07-08T00:00:00.000Z')
const uzsDisplay = { currency: 'UZS' as const, usdUzsRate: null }
const usdDisplay = { currency: 'USD' as const, usdUzsRate: 12_500 }

describe('computeNasiyaPaymentScore — currency-aware overdue tolerance', () => {
  it('defaults to UZS (unchanged behavior for any caller not yet updated)', () => {
    // 400 so'm short of a 200,000 so'm schedule, overdue -> within UZS tolerance (500), NOT overdue.
    const s = schedule({ expectedAmount: 200_000, paidAmount: 199_600, status: 'PARTIAL', dueDate: '2020-01-01T00:00:00.000Z' })
    const score = computeNasiyaPaymentScore({ schedules: [s] }, now, uzsDisplay)
    expect(score.factors.overdueScheduleCount).toBe(0)
  })

  it('USD contract: a genuine $1 shortfall on an overdue schedule is NOT forgiven by UZS-sized tolerance', () => {
    const s = schedule({ expectedAmount: 200, paidAmount: 199, status: 'PARTIAL', dueDate: '2020-01-01T00:00:00.000Z' })
    const score = computeNasiyaPaymentScore({ schedules: [s] }, now, usdDisplay, 'USD')
    expect(score.factors.overdueScheduleCount).toBe(1)
    expect(score.color).toBe('red')
  })

  it('USD contract: one exact cent remains meaningful and overdue when past due', () => {
    const s = schedule({ expectedAmount: 200, paidAmount: 199.99, status: 'PARTIAL', dueDate: '2020-01-01T00:00:00.000Z' })
    const score = computeNasiyaPaymentScore({ schedules: [s] }, now, usdDisplay, 'USD')
    expect(score.factors.overdueScheduleCount).toBe(1)
  })

  it('USD contract overdue reason shows the native $ amount, not a UZS-misread figure', () => {
    const s = schedule({ expectedAmount: 200, paidAmount: 0, status: 'PENDING', dueDate: '2020-01-01T00:00:00.000Z' })
    const score = computeNasiyaPaymentScore({ schedules: [s] }, now, usdDisplay, 'USD')
    expect(score.reason).toContain('$200.00')
  })

  it('UZS contract overdue reason shown in the shop\'s USD display terms converts using the given rate', () => {
    const s = schedule({ expectedAmount: 2_500_000, paidAmount: 0, status: 'PENDING', dueDate: '2020-01-01T00:00:00.000Z' })
    const score = computeNasiyaPaymentScore({ schedules: [s] }, now, usdDisplay, 'UZS')
    expect(score.reason).toContain('$200.00')
  })

  it('score/label/color math stays currency-agnostic (ratio-based) — same shape for UZS and USD contracts with proportional numbers', () => {
    const uzsSchedules = [schedule({ expectedAmount: 2_000_000, paidAmount: 2_000_000, status: 'PAID', paidAt: '2026-01-01T00:00:00.000Z', dueDate: '2026-01-01T00:00:00.000Z' })]
    const usdSchedules = [schedule({ expectedAmount: 160, paidAmount: 160, status: 'PAID', paidAt: '2026-01-01T00:00:00.000Z', dueDate: '2026-01-01T00:00:00.000Z' })]
    const uzsScore = computeNasiyaPaymentScore({ schedules: uzsSchedules }, now, uzsDisplay, 'UZS')
    const usdScore = computeNasiyaPaymentScore({ schedules: usdSchedules }, now, usdDisplay, 'USD')
    expect(uzsScore.score).toBe(usdScore.score)
    expect(uzsScore.color).toBe(usdScore.color)
  })
})
