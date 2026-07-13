import { describe, it, expect } from 'vitest'
import {
  calculateNasiyaAmounts,
  calculateNasiyaAmountsFromMonthlyPayment,
  generatePaymentSchedule,
  calculateRemaining,
  getNextPayment,
  isOverdue,
  isScheduleOverdue,
  scheduleDisplayStatus,
  deriveNasiyaOverdue,
  type OverdueScheduleInput,
} from '@/lib/nasiya-utils'
import { NasiyaScheduleStatus, type NasiyaSchedule } from '@/types'

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0)
}

describe('calculateNasiyaAmounts / calculateNasiyaAmountsFromMonthlyPayment (item 6)', () => {
  it('keeps percent 0 compatible with the old remaining-amount logic', () => {
    const calc = calculateNasiyaAmounts({
      totalAmount: 5_200_000,
      downPayment: 1_500_000,
      interestPercent: 0,
      months: 6,
    })

    expect(calc.baseRemainingAmount).toBe(3_700_000)
    expect(calc.interestAmount).toBe(0)
    expect(calc.finalNasiyaAmount).toBe(3_700_000)
    expect(calc.monthlyPayment).toBe(616_667)
  })

  it('applies 20 percent only to the amount left after down payment', () => {
    const calc = calculateNasiyaAmounts({
      totalAmount: 5_200_000,
      downPayment: 1_500_000,
      interestPercent: 20,
      months: 6,
    })

    expect(calc.baseRemainingAmount).toBe(3_700_000)
    expect(calc.interestAmount).toBe(740_000)
    expect(calc.finalNasiyaAmount).toBe(4_440_000)
    expect(calc.monthlyPayment).toBe(740_000)
  })

  it('round-trips exactly against the forward calculation (same inputs, same outputs)', () => {
    const forward = calculateNasiyaAmounts({
      totalAmount: 5_200_000,
      downPayment: 1_500_000,
      interestPercent: 20,
      months: 6,
    })
    const reverse = calculateNasiyaAmountsFromMonthlyPayment({
      totalAmount: 5_200_000,
      downPayment: 1_500_000,
      months: 6,
      monthlyPayment: forward.monthlyPayment,
    })

    expect(reverse.interestAmount).toBe(forward.interestAmount)
    expect(reverse.interestPercent).toBe(forward.interestPercent)
    expect(reverse.finalNasiyaAmount).toBe(forward.finalNasiyaAmount)
  })

  it('a higher manually-entered monthly payment increases both interestAmount and interestPercent', () => {
    // baseRemainingAmount = 3,700,000. Paying 800,000/mo * 6mo = 4,800,000 total
    // -> interest = 1,100,000 -> ~29.7% -> rounds to 30%.
    const reverse = calculateNasiyaAmountsFromMonthlyPayment({
      totalAmount: 5_200_000,
      downPayment: 1_500_000,
      months: 6,
      monthlyPayment: 800_000,
    })

    expect(reverse.finalNasiyaAmount).toBe(4_800_000)
    expect(reverse.interestAmount).toBe(1_100_000)
    expect(reverse.interestPercent).toBe(30)
  })

  it('a monthly payment that exactly covers the base debt with no interest yields 0%', () => {
    // base = 5,200,000 - 1,600,000 = 3,600,000, which divides evenly by 6
    // months (600,000/mo) — an evenly-divisible fixture so there's no
    // rounding-boundary drift to account for in this assertion.
    const reverse = calculateNasiyaAmountsFromMonthlyPayment({
      totalAmount: 5_200_000,
      downPayment: 1_600_000,
      months: 6,
      monthlyPayment: 600_000,
    })

    expect(reverse.interestPercent).toBe(0)
    expect(reverse.interestAmount).toBe(0)
  })

  it('rejects a monthly payment too low to cover the base debt (negative interest)', () => {
    expect(() =>
      calculateNasiyaAmountsFromMonthlyPayment({
        totalAmount: 5_200_000,
        downPayment: 1_500_000,
        months: 6,
        monthlyPayment: 100_000, // 100,000 * 6 = 600,000 < 3,700,000 base debt
      }),
    ).toThrow(/foiz manfiy/)
  })

  it('rejects a zero or negative monthly payment', () => {
    expect(() =>
      calculateNasiyaAmountsFromMonthlyPayment({
        totalAmount: 5_200_000,
        downPayment: 1_500_000,
        months: 6,
        monthlyPayment: 0,
      }),
    ).toThrow(/Oylik to'lov musbat/)

    expect(() =>
      calculateNasiyaAmountsFromMonthlyPayment({
        totalAmount: 5_200_000,
        downPayment: 1_500_000,
        months: 6,
        monthlyPayment: -50_000,
      }),
    ).toThrow(/Oylik to'lov musbat/)
  })

  it('rejects a monthly payment implying an interest percent above the max', () => {
    expect(() =>
      calculateNasiyaAmountsFromMonthlyPayment({
        totalAmount: 5_200_000,
        downPayment: 1_600_000,
        months: 6,
        // base = 3,600,000; 2,700,000/mo * 6 = 16,200,000 total => interest
        // = 12,600,000 => 350% > 300% max.
        monthlyPayment: 2_700_000,
      }),
    ).toThrow(/Nasiya foizi/)
  })

  it('USD contract: rounds to cents, matches the forward calculation exactly (evenly-divisible fixture)', () => {
    // Chosen so monthlyPayment (1200/6 = 200.00) divides evenly — an
    // unevenly-divisible monthly payment can lose a cent on the round trip
    // (monthlyPayment itself is already rounded before being multiplied back
    // by months), which is an accepted, pre-existing rounding characteristic
    // of any whole-installment schedule, not something this reverse
    // calculation needs to compensate for.
    const forward = calculateNasiyaAmounts({
      totalAmount: 1200,
      downPayment: 200,
      interestPercent: 20,
      months: 6,
      currency: 'USD',
    })
    const reverse = calculateNasiyaAmountsFromMonthlyPayment({
      totalAmount: 1200,
      downPayment: 200,
      months: 6,
      monthlyPayment: forward.monthlyPayment,
      currency: 'USD',
    })

    expect(reverse.finalNasiyaAmount).toBe(forward.finalNasiyaAmount)
    expect(reverse.interestPercent).toBe(forward.interestPercent)
  })

  it('generates schedules from final nasiya amount after interest', () => {
    const calc = calculateNasiyaAmounts({
      totalAmount: 5_200_000,
      downPayment: 1_500_000,
      interestPercent: 20,
      months: 6,
    })
    const schedule = generatePaymentSchedule(new Date('2026-07-01T00:00:00.000Z'), 6, calc.finalNasiyaAmount)

    expect(schedule).toHaveLength(6)
    expect(sum(schedule.map((row) => row.expectedAmount))).toBe(calc.finalNasiyaAmount)
    expect(schedule.every((row) => row.expectedAmount === 740_000)).toBe(true)
  })

  it('USD contract: rounds to cents, not whole dollars ($1000 total, $150.50 down, 15% interest)', () => {
    const calc = calculateNasiyaAmounts({
      totalAmount: 1000,
      downPayment: 150.5,
      interestPercent: 15,
      months: 4,
      currency: 'USD',
    })
    expect(calc.totalAmount).toBe(1000)
    expect(calc.downPayment).toBe(150.5)
    expect(calc.baseRemainingAmount).toBe(849.5)
    expect(calc.interestAmount).toBe(127.43) // 849.5 * 0.15 = 127.425 -> rounds to 127.43
    expect(calc.finalNasiyaAmount).toBe(976.93)
  })

  it('defaults to UZS rounding (whole numbers) when no currency is passed', () => {
    const calc = calculateNasiyaAmounts({
      totalAmount: 5_200_000.7,
      downPayment: 1_500_000,
      interestPercent: 0,
      months: 6,
    })
    expect(Number.isInteger(calc.totalAmount)).toBe(true)
  })

  it('rejects down payment above total price', () => {
    expect(() =>
      calculateNasiyaAmounts({
        totalAmount: 5_200_000,
        downPayment: 5_300_000,
        interestPercent: 0,
        months: 6,
      }),
    ).toThrow("Boshlang'ich to'lov")
  })

  it('rejects invalid percent values', () => {
    expect(() =>
      calculateNasiyaAmounts({
        totalAmount: 5_200_000,
        downPayment: 1_500_000,
        interestPercent: -1,
        months: 6,
      }),
    ).toThrow('Nasiya foizi')

    expect(() =>
      calculateNasiyaAmounts({
        totalAmount: 5_200_000,
        downPayment: 1_500_000,
        interestPercent: 301,
        months: 6,
      }),
    ).toThrow('Nasiya foizi')
  })

  it('rejects nasiya creation when no debt remains after down payment', () => {
    expect(() =>
      calculateNasiyaAmounts({
        totalAmount: 5_200_000,
        downPayment: 5_200_000,
        interestPercent: 0,
        months: 6,
      }),
    ).toThrow('qarz summasi')
  })
})

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

  it('USD currency splits in cents, not whole dollars — $1000 over 6 months', () => {
    const s = generatePaymentSchedule(start, 6, 1000, 'USD')
    expect(s).toHaveLength(6)
    expect(sum(s.map((x) => x.expectedAmount))).toBe(1000)
    // base = floor(100000 cents / 6) = 16666 cents = $166.66; remainder 4 cents -> last month
    expect(s.slice(0, 5).every((x) => x.expectedAmount === 166.66)).toBe(true)
    expect(s[5].expectedAmount).toBe(166.7)
  })

  it('defaults to UZS (whole-number split) when no currency is passed — unchanged legacy behavior', () => {
    const s = generatePaymentSchedule(start, 6, 10_000_000)
    expect(s.every((x) => Number.isInteger(x.expectedAmount))).toBe(true)
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

// ---------------------------------------------------------------------------
// Canonical overdue derivation used by the dashboard, list and detail page.
// A fixed `now` is passed everywhere so the tests are deterministic and the
// Tashkent-day boundary behaviour is explicit (the predicate is instant-based,
// matching shop-stats.ts and the payment route).
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-15T09:00:00.000Z') // ~14:00 Asia/Tashkent

function sch(overrides: Partial<OverdueScheduleInput>): OverdueScheduleInput {
  return {
    status: 'PENDING',
    dueDate: new Date('2026-05-15T00:00:00.000Z'),
    delayedUntil: null,
    expectedAmount: 1_000_000,
    paidAmount: 0,
    ...overrides,
  }
}

describe('isScheduleOverdue (canonical predicate)', () => {
  it('is true for an unpaid schedule past its due date with a balance', () => {
    expect(isScheduleOverdue(sch({ dueDate: new Date('2026-05-15') }), NOW)).toBe(true)
  })

  it('is false for an unpaid schedule due in the future', () => {
    expect(isScheduleOverdue(sch({ dueDate: new Date('2026-08-15') }), NOW)).toBe(false)
  })

  it('is false for a fully-paid schedule even if past due (no outstanding)', () => {
    expect(
      isScheduleOverdue(sch({ status: 'PAID', paidAmount: 1_000_000, dueDate: new Date('2026-01-15') }), NOW),
    ).toBe(false)
  })

  it('honours an active defer (delayedUntil) — future defer is not overdue', () => {
    expect(
      isScheduleOverdue(
        sch({ status: 'DEFERRED', dueDate: new Date('2026-05-15'), delayedUntil: new Date('2026-09-01') }),
        NOW,
      ),
    ).toBe(false)
  })

  it('a defer pushed into the past IS overdue again', () => {
    expect(
      isScheduleOverdue(
        sch({ status: 'DEFERRED', dueDate: new Date('2026-05-15'), delayedUntil: new Date('2026-06-01') }),
        NOW,
      ),
    ).toBe(true)
  })

  it('a partial schedule past due with a remaining balance is overdue (req 3)', () => {
    expect(
      isScheduleOverdue(
        sch({ status: 'PARTIAL', expectedAmount: 1_000_000, paidAmount: 400_000, dueDate: new Date('2026-05-15') }),
        NOW,
      ),
    ).toBe(true)
  })
})

describe('scheduleDisplayStatus (detail row badge)', () => {
  it('reads a past-due PENDING row as OVERDUE even before cron flips it', () => {
    expect(scheduleDisplayStatus(sch({ status: 'PENDING', dueDate: new Date('2026-05-15') }), NOW)).toBe('OVERDUE')
  })
  it('keeps a PAID row as PAID', () => {
    expect(
      scheduleDisplayStatus(sch({ status: 'PAID', paidAmount: 1_000_000, dueDate: new Date('2026-01-15') }), NOW),
    ).toBe('PAID')
  })
  it('keeps a future PENDING row as PENDING', () => {
    expect(scheduleDisplayStatus(sch({ status: 'PENDING', dueDate: new Date('2026-09-15') }), NOW)).toBe('PENDING')
  })
})

describe('deriveNasiyaOverdue (contract display status)', () => {
  it('ACTIVE parent with only future unpaid schedules → ACTIVE (req 1)', () => {
    const d = deriveNasiyaOverdue({ status: 'ACTIVE', schedules: [sch({ dueDate: new Date('2026-09-15') })] }, NOW)
    expect(d.displayStatus).toBe('ACTIVE')
    expect(d.isOverdue).toBe(false)
    expect(d.overdueCount).toBe(0)
    expect(d.overdueAmount).toBe(0)
  })

  it('ACTIVE parent with a past unpaid schedule → OVERDUE (req 2)', () => {
    const d = deriveNasiyaOverdue(
      { status: 'ACTIVE', schedules: [sch({ dueDate: new Date('2026-05-15'), expectedAmount: 1_000_000, paidAmount: 0 })] },
      NOW,
    )
    expect(d.displayStatus).toBe('OVERDUE')
    expect(d.isOverdue).toBe(true)
    expect(d.overdueCount).toBe(1)
    expect(d.overdueAmount).toBe(1_000_000)
  })

  it('sums overdue amount across multiple overdue schedules, ignores future ones', () => {
    const d = deriveNasiyaOverdue(
      {
        status: 'ACTIVE',
        schedules: [
          sch({ dueDate: new Date('2026-04-15'), expectedAmount: 1_000_000, paidAmount: 200_000 }), // 800k overdue
          sch({ status: 'PARTIAL', dueDate: new Date('2026-05-15'), expectedAmount: 1_000_000, paidAmount: 0 }), // 1,000k overdue
          sch({ dueDate: new Date('2026-09-15'), expectedAmount: 1_000_000, paidAmount: 0 }), // future
        ],
      },
      NOW,
    )
    expect(d.overdueCount).toBe(2)
    expect(d.overdueAmount).toBe(1_800_000)
  })

  it('paid past schedules are not overdue (req 4)', () => {
    // A second, still-open future schedule keeps this nasiya genuinely ACTIVE
    // (not effectively complete) so the test isolates what it's actually
    // checking: a paid past schedule doesn't itself count as overdue.
    const d = deriveNasiyaOverdue(
      {
        status: 'ACTIVE',
        schedules: [
          sch({ status: 'PAID', paidAmount: 1_000_000, dueDate: new Date('2026-01-15') }),
          sch({ dueDate: new Date('2026-09-15') }),
        ],
      },
      NOW,
    )
    expect(d.displayStatus).toBe('ACTIVE')
    expect(d.isOverdue).toBe(false)
  })

  it('a nasiya whose only schedule is fully paid is effectively COMPLETED even if status is still ACTIVE', () => {
    // This is the self-heal case: rounding dust from a USD round-trip payment
    // can leave the stored nasiya.status as ACTIVE even though every schedule
    // is settled — displayStatus must still read COMPLETED everywhere.
    const d = deriveNasiyaOverdue(
      { status: 'ACTIVE', schedules: [sch({ status: 'PAID', paidAmount: 1_000_000, dueDate: new Date('2026-01-15') })] },
      NOW,
    )
    expect(d.displayStatus).toBe('COMPLETED')
    expect(d.isOverdue).toBe(false)
  })

  it('a sub-so\'m legacy fractional remainder is arithmetic dust and effectively COMPLETED', () => {
    const d = deriveNasiyaOverdue(
      {
        status: 'ACTIVE',
        schedules: [sch({ status: 'PARTIAL', expectedAmount: 1_000_000, paidAmount: 999_999.5, dueDate: new Date('2026-01-15') })],
      },
      NOW,
    )
    expect(d.displayStatus).toBe('COMPLETED')
  })

  it('an exact one-so\'m balance remains visible and overdue', () => {
    const d = deriveNasiyaOverdue(
      {
        status: 'ACTIVE',
        schedules: [sch({ status: 'PARTIAL', expectedAmount: 1_000_000, paidAmount: 999_999, dueDate: new Date('2026-01-15') })],
      },
      NOW,
    )
    expect(d.displayStatus).toBe('OVERDUE')
    expect(d.overdueAmount).toBe(1)
  })

  it('a nasiya with a real outstanding balance beyond tolerance stays ACTIVE/OVERDUE, never falsely COMPLETED', () => {
    const d = deriveNasiyaOverdue(
      {
        status: 'ACTIVE',
        schedules: [sch({ status: 'PARTIAL', expectedAmount: 1_000_000, paidAmount: 990_000, dueDate: new Date('2026-01-15') })],
      },
      NOW,
    )
    expect(d.displayStatus).toBe('OVERDUE')
    expect(d.overdueAmount).toBe(10_000)
  })

  it('COMPLETED / CANCELLED parents keep their terminal status (req 5)', () => {
    const overduePast = [sch({ dueDate: new Date('2026-01-15') })]
    expect(deriveNasiyaOverdue({ status: 'COMPLETED', schedules: [] }, NOW).displayStatus).toBe('COMPLETED')
    // Even a stray past-due schedule cannot make a COMPLETED/CANCELLED contract "active overdue".
    expect(deriveNasiyaOverdue({ status: 'CANCELLED', schedules: overduePast }, NOW).displayStatus).toBe('CANCELLED')
    expect(deriveNasiyaOverdue({ status: 'CANCELLED', schedules: overduePast }, NOW).isOverdue).toBe(false)
  })

  it('respects a parent already flipped to OVERDUE by cron', () => {
    const d = deriveNasiyaOverdue({ status: 'OVERDUE', schedules: [sch({ dueDate: new Date('2026-09-15') })] }, NOW)
    expect(d.displayStatus).toBe('OVERDUE')
  })

  it('nextPaymentDate is the earliest unpaid schedule by effective due date', () => {
    const d = deriveNasiyaOverdue(
      {
        status: 'ACTIVE',
        schedules: [
          sch({ dueDate: new Date('2026-08-15') }),
          sch({ dueDate: new Date('2026-05-15') }),
          sch({ status: 'PAID', paidAmount: 1_000_000, dueDate: new Date('2026-01-15') }),
        ],
      },
      NOW,
    )
    expect(d.nextPaymentDate?.toISOString()).toBe(new Date('2026-05-15T00:00:00.000Z').toISOString())
  })
})

describe('tab filtering by derived display status (req 6 & 7)', () => {
  const contracts = [
    { id: 'future', status: 'ACTIVE', schedules: [sch({ dueDate: new Date('2026-09-15') })] },
    { id: 'past', status: 'ACTIVE', schedules: [sch({ dueDate: new Date('2026-05-15') })] },
    { id: 'done', status: 'COMPLETED', schedules: [] },
  ].map((c) => ({ id: c.id, displayStatus: deriveNasiyaOverdue(c, NOW).displayStatus }))

  const inTab = (tab: string) => contracts.filter((c) => c.displayStatus === tab).map((c) => c.id)

  it("'Muddati o'tgan' (OVERDUE) includes the derived-overdue contract", () => {
    expect(inTab('OVERDUE')).toContain('past')
    expect(inTab('OVERDUE')).not.toContain('future')
  })

  it("'Faol' (ACTIVE) excludes the derived-overdue contract", () => {
    expect(inTab('ACTIVE')).toContain('future')
    expect(inTab('ACTIVE')).not.toContain('past')
  })
})
