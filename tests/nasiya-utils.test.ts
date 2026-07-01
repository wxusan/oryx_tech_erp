import { describe, it, expect } from 'vitest'
import {
  generatePaymentSchedule,
  calculateRemaining,
  getNextPayment,
  isOverdue,
} from '@/lib/nasiya-utils'
import { NasiyaScheduleStatus, type NasiyaSchedule } from '@/types'

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0)
}

/** Minimal NasiyaSchedule fixture — only the fields the utils read matter. */
function schedule(overrides: Partial<NasiyaSchedule>): NasiyaSchedule {
  return {
    id: 'sch',
    nasiyaId: 'n',
    shopId: 's',
    monthNumber: 1,
    dueDate: new Date('2026-01-15'),
    expectedAmount: 1000,
    paidAmount: 0,
    status: NasiyaScheduleStatus.PENDING,
    paidAt: null,
    paymentMethod: null,
    delayedUntil: null,
    deferredToNext: false,
    note: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('generatePaymentSchedule — schedule sums exactly to remaining (req 1)', () => {
  const start = new Date('2026-01-01')

  it('10,000,000 over 6 months sums exactly and last month absorbs the remainder', () => {
    const s = generatePaymentSchedule(start, 6, 10_000_000)
    expect(s).toHaveLength(6)
    expect(sum(s.map((x) => x.expectedAmount))).toBe(10_000_000)
    // base = floor(10,000,000/6) = 1,666,666; remainder = 4 goes to last month
    expect(s.slice(0, 5).every((x) => x.expectedAmount === 1_666_666)).toBe(true)
    expect(s[5].expectedAmount).toBe(1_666_670)
    expect(s.map((x) => x.monthNumber)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('down payment is counted once: schedule covers only (total - down) (req 2)', () => {
    // total 10,000,000, down 1,500,000 => remaining base 8,500,000 over 12 months
    const remaining = 10_000_000 - 1_500_000
    const s = generatePaymentSchedule(start, 12, remaining)
    expect(sum(s.map((x) => x.expectedAmount))).toBe(8_500_000)
    // The down payment is NOT part of any schedule row.
    expect(sum(s.map((x) => x.expectedAmount))).not.toBe(10_000_000)
  })

  it('exactly-divisible amount yields equal instalments', () => {
    const s = generatePaymentSchedule(start, 4, 12_000_000)
    expect(s.every((x) => x.expectedAmount === 3_000_000)).toBe(true)
    expect(sum(s.map((x) => x.expectedAmount))).toBe(12_000_000)
  })

  it('rounds a fractional remaining and still sums to the rounded total', () => {
    const s = generatePaymentSchedule(start, 3, 10_000_000.4)
    expect(sum(s.map((x) => x.expectedAmount))).toBe(10_000_000)
  })
})

describe('calculateRemaining — counts paid once, never negative', () => {
  it('subtracts paid from the (already down-adjusted) total', () => {
    expect(calculateRemaining(8_500_000, 2_000_000)).toBe(6_500_000)
  })
  it('never returns negative on overpay', () => {
    expect(calculateRemaining(1_000_000, 1_200_000)).toBe(0)
  })
})

describe('getNextPayment — includes OVERDUE/DEFERRED (req 12 helper)', () => {
  it('returns the earliest unpaid schedule by effective due date', () => {
    const rows = [
      schedule({ id: 'b', monthNumber: 2, dueDate: new Date('2026-02-15'), status: NasiyaScheduleStatus.PENDING }),
      schedule({ id: 'a', monthNumber: 1, dueDate: new Date('2026-01-15'), status: NasiyaScheduleStatus.OVERDUE }),
      schedule({ id: 'paid', monthNumber: 0, dueDate: new Date('2025-12-15'), status: NasiyaScheduleStatus.PAID }),
    ]
    expect(getNextPayment(rows)?.id).toBe('a') // OVERDUE row is still surfaced and is earliest
  })

  it('honors delayedUntil when ordering', () => {
    const rows = [
      schedule({ id: 'x', dueDate: new Date('2026-01-15'), delayedUntil: new Date('2026-05-01'), status: NasiyaScheduleStatus.DEFERRED }),
      schedule({ id: 'y', dueDate: new Date('2026-03-15'), status: NasiyaScheduleStatus.PENDING }),
    ]
    expect(getNextPayment(rows)?.id).toBe('y')
  })

  it('returns null when everything is paid', () => {
    const rows = [schedule({ status: NasiyaScheduleStatus.PAID })]
    expect(getNextPayment(rows)).toBeNull()
  })
})

describe('isOverdue', () => {
  it('is true when a schedule is already flipped to OVERDUE', () => {
    expect(isOverdue([schedule({ status: NasiyaScheduleStatus.OVERDUE, dueDate: new Date('2999-01-01') })])).toBe(true)
  })
  it('is true when an unpaid schedule is past its due date', () => {
    expect(isOverdue([schedule({ status: NasiyaScheduleStatus.PENDING, dueDate: new Date('2000-01-01') })])).toBe(true)
  })
  it('is false when all unpaid schedules are in the future', () => {
    expect(isOverdue([schedule({ status: NasiyaScheduleStatus.PENDING, dueDate: new Date('2999-01-01') })])).toBe(false)
  })
})
