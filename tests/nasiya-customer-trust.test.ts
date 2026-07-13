import { describe, it, expect } from 'vitest'
import {
  computeCustomerTrustRating,
  TRUST_TIER_LABELS,
  isValidTrustTier,
  type CustomerNasiyaInput,
} from '@/lib/nasiya-customer-trust'

const DAY = 86_400_000
const now = new Date('2026-07-09T00:00:00.000Z')

function paidOnTime(dueDate: Date, paidAt: Date, amount = 100000): CustomerNasiyaInput['schedules'][number] {
  return { status: 'PAID', dueDate, delayedUntil: null, expectedAmount: amount, paidAmount: amount, paidAt }
}

function paidLate(dueDate: Date, daysLate: number, amount = 100000): CustomerNasiyaInput['schedules'][number] {
  return {
    status: 'PAID',
    dueDate,
    delayedUntil: null,
    expectedAmount: amount,
    paidAmount: amount,
    paidAt: new Date(dueDate.getTime() + daysLate * DAY),
  }
}

function overdueUnpaid(dueDate: Date, amount = 100000): CustomerNasiyaInput['schedules'][number] {
  return { status: 'PENDING', dueDate, delayedUntil: null, expectedAmount: amount, paidAmount: 0, paidAt: null }
}

describe('Uzbek labels — exact strings required by the ticket', () => {
  it('matches the 5 specified labels exactly', () => {
    expect(TRUST_TIER_LABELS.NEW).toBe('Yangi mijoz')
    expect(TRUST_TIER_LABELS.LOW).toBe('Past ishonch')
    expect(TRUST_TIER_LABELS.MEDIUM).toBe("O'rtacha ishonch")
    expect(TRUST_TIER_LABELS.HIGH).toBe('Ishonchli')
    expect(TRUST_TIER_LABELS.VERY_HIGH).toBe('Juda ishonchli')
  })
})

describe('brand-new customer defaults to lowest/NEW tier', () => {
  it('no nasiyas at all -> NEW, with an explaining reason', () => {
    const rating = computeCustomerTrustRating([], now)
    expect(rating.tier).toBe('NEW')
    expect(rating.reasons.length).toBeGreaterThan(0)
    expect(rating.factors.totalNasiyaCount).toBe(0)
  })
})

describe('a currently overdue schedule always caps the tier at LOW', () => {
  it('overrides an otherwise-good history', () => {
    const nasiyas: CustomerNasiyaInput[] = [
      {
        status: 'COMPLETED',
        contractCurrency: 'UZS',
        schedules: [
          paidOnTime(new Date('2026-01-01'), new Date('2026-01-01')),
          paidOnTime(new Date('2026-02-01'), new Date('2026-02-01')),
          paidOnTime(new Date('2026-03-01'), new Date('2026-03-01')),
        ],
      },
      {
        status: 'ACTIVE',
        contractCurrency: 'UZS',
        schedules: [overdueUnpaid(new Date('2026-06-01'))],
      },
    ]
    const rating = computeCustomerTrustRating(nasiyas, now)
    expect(rating.tier).toBe('LOW')
    expect(rating.factors.hasCurrentOverdue).toBe(true)
    expect(rating.reasons.some((r) => r.includes("muddati o'tgan"))).toBe(true)
  })
})

describe('written-off debt stops current collection pressure without erasing paid history', () => {
  it('does not count an unpaid written-off schedule as current overdue or active', () => {
    const rating = computeCustomerTrustRating([{
      status: 'OVERDUE',
      resolutionState: 'WRITTEN_OFF',
      contractCurrency: 'UZS',
      schedules: [
        paidLate(new Date('2026-01-01'), 3),
        overdueUnpaid(new Date('2026-02-01')),
      ],
    }], now)
    expect(rating.factors.totalNasiyaCount).toBe(1)
    expect(rating.factors.activeNasiyaCount).toBe(0)
    expect(rating.factors.paidInstallmentCount).toBe(1)
    expect(rating.factors.lateInstallmentCount).toBe(1)
    expect(rating.factors.currentOverdueScheduleCount).toBe(0)
    expect(rating.factors.hasCurrentOverdue).toBe(false)
  })
})

describe('multiple fully-completed, all-on-time nasiyas -> VERY_HIGH', () => {
  it('requires zero late payments and zero cancellations', () => {
    const nasiyas: CustomerNasiyaInput[] = [
      {
        status: 'COMPLETED',
        contractCurrency: 'UZS',
        schedules: [
          paidOnTime(new Date('2026-01-01'), new Date('2026-01-01')),
          paidOnTime(new Date('2026-02-01'), new Date('2026-02-01')),
          paidOnTime(new Date('2026-03-01'), new Date('2026-03-01')),
        ],
      },
      {
        status: 'COMPLETED',
        contractCurrency: 'UZS',
        schedules: [
          paidOnTime(new Date('2026-04-01'), new Date('2026-04-01')),
          paidOnTime(new Date('2026-05-01'), new Date('2026-05-01')),
          paidOnTime(new Date('2026-06-01'), new Date('2026-06-01')),
        ],
      },
    ]
    const rating = computeCustomerTrustRating(nasiyas, now)
    expect(rating.tier).toBe('VERY_HIGH')
    expect(rating.factors.completedNasiyaCount).toBe(2)
    expect(rating.factors.onTimeRatio).toBe(1)
  })
})

describe('one completed nasiya with a couple of late payments -> a mid tier, not VERY_HIGH', () => {
  it('late history keeps it out of VERY_HIGH', () => {
    const nasiyas: CustomerNasiyaInput[] = [
      {
        status: 'COMPLETED',
        contractCurrency: 'UZS',
        schedules: [
          paidLate(new Date('2026-01-01'), 10),
          paidLate(new Date('2026-02-01'), 12),
          paidOnTime(new Date('2026-03-01'), new Date('2026-03-01')),
        ],
      },
    ]
    const rating = computeCustomerTrustRating(nasiyas, now)
    expect(rating.tier).not.toBe('VERY_HIGH')
    expect(rating.factors.lateInstallmentCount).toBe(2)
    expect(rating.reasons.some((r) => r.includes('kechikkan'))).toBe(true)
  })
})

describe('sparse history (1-2 paid installments, nothing completed yet) never jumps straight to HIGH/VERY_HIGH', () => {
  it('caps at MEDIUM even if the couple of payments were on time', () => {
    const nasiyas: CustomerNasiyaInput[] = [
      {
        status: 'ACTIVE',
        contractCurrency: 'UZS',
        schedules: [
          paidOnTime(new Date('2026-05-01'), new Date('2026-05-01')),
          overdueUnpaid(new Date('2026-08-01')), // not yet due relative to `now`, so not counted overdue
        ],
      },
    ]
    const rating = computeCustomerTrustRating(nasiyas, now)
    expect(['LOW', 'MEDIUM']).toContain(rating.tier)
    expect(rating.tier).not.toBe('HIGH')
    expect(rating.tier).not.toBe('VERY_HIGH')
  })
})

describe('cancelled nasiya history is a negative signal', () => {
  it('a cancelled deal never counts toward paid/on-time history, and penalizes the score', () => {
    const nasiyas: CustomerNasiyaInput[] = [
      {
        status: 'COMPLETED',
        contractCurrency: 'UZS',
        schedules: [
          paidOnTime(new Date('2026-01-01'), new Date('2026-01-01')),
          paidOnTime(new Date('2026-02-01'), new Date('2026-02-01')),
          paidOnTime(new Date('2026-03-01'), new Date('2026-03-01')),
        ],
      },
      {
        status: 'CANCELLED',
        contractCurrency: 'UZS',
        schedules: [paidOnTime(new Date('2026-01-15'), new Date('2026-01-15'))],
      },
    ]
    const rating = computeCustomerTrustRating(nasiyas, now)
    expect(rating.factors.cancelledNasiyaCount).toBe(1)
    // The cancelled deal's schedule is excluded from paid-installment counting.
    expect(rating.factors.paidInstallmentCount).toBe(3)
    expect(rating.tier).not.toBe('VERY_HIGH')
  })
})

describe('admin override', () => {
  it('wins over the computed tier but keeps the computed factors and adds a reason', () => {
    const rating = computeCustomerTrustRating([], now, 'HIGH')
    expect(rating.tier).toBe('HIGH')
    expect(rating.isOverridden).toBe(true)
    expect(rating.factors.totalNasiyaCount).toBe(0)
    expect(rating.reasons.some((r) => r.includes('qo\'lda belgilangan'))).toBe(true)
  })

  it('no override -> isOverridden is false', () => {
    const rating = computeCustomerTrustRating([], now, null)
    expect(rating.isOverridden).toBe(false)
  })
})

describe('isValidTrustTier', () => {
  it('accepts the 5 known tiers and rejects anything else', () => {
    expect(isValidTrustTier('NEW')).toBe(true)
    expect(isValidTrustTier('VERY_HIGH')).toBe(true)
    expect(isValidTrustTier('CREDIT_SCORE')).toBe(false)
    expect(isValidTrustTier(undefined)).toBe(false)
    expect(isValidTrustTier(123)).toBe(false)
  })
})

describe('deterministic', () => {
  it('same input always yields the same output', () => {
    const nasiyas: CustomerNasiyaInput[] = [
      {
        status: 'COMPLETED',
        contractCurrency: 'USD',
        schedules: [paidOnTime(new Date('2026-01-01'), new Date('2026-01-01'), 50)],
      },
    ]
    const a = computeCustomerTrustRating(nasiyas, now)
    const b = computeCustomerTrustRating(nasiyas, now)
    expect(a).toEqual(b)
  })
})
