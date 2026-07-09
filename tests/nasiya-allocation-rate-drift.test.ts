import { describe, it, expect } from 'vitest'
import { allocateNasiyaPayment, totalContractOutstanding, type NasiyaAllocationScheduleInput } from '@/lib/nasiya-payment-allocation'

const NOW = new Date('2026-07-15T00:00:00.000Z')
const FUTURE_DUE = new Date('2026-08-01T00:00:00.000Z')
const PAST_DUE = new Date('2026-06-01T00:00:00.000Z')

function schedule(overrides: Partial<NasiyaAllocationScheduleInput>): NasiyaAllocationScheduleInput {
  return {
    id: 's1',
    monthNumber: 1,
    dueDate: FUTURE_DUE,
    delayedUntil: null,
    expectedAmount: 1_200_000,
    paidAmount: 0,
    contractExpectedAmount: 100,
    contractPaidAmount: 0,
    ...overrides,
  }
}

// Item 4 — the exact rate-drift edge case from docs/product-feature-fixes.md:
// a USD-native nasiya schedule paid across TWO payments at different
// exchange rates. Before the fix, "is this fully paid" was decided from the
// legacy UZS ledger alone and could disagree with the contract-currency
// truth (see the long doc comment in nasiya-payment-allocation.ts for the
// full worked numeric example this reproduces).
describe('allocateNasiyaPayment — rate-drift edge case (item 4)', () => {
  it('BUG SCENARIO: contract math says fully paid even though legacy-UZS math alone would not — schedule must become PAID, not PARTIAL/OVERDUE', () => {
    // Schedule: $100 owed, created at rate 12,000 -> legacy expectedAmount = 1,200,000.
    // Payment 1 already applied: $60 paid at rate 11,000 -> legacy applied 660,000.
    const afterPayment1 = schedule({
      paidAmount: 660_000,
      contractPaidAmount: 60,
      dueDate: PAST_DUE, // overdue if not closed, to prove OVERDUE isn't wrongly assigned
    })

    // Payment 2: the remaining $40, also at rate 11,000 -> amountUzs = 440,000.
    // Legacy total would be 660,000 + 440,000 = 1,100,000 (100,000 SHORT of
    // the 1,200,000 legacy expectedAmount) — legacy math alone says NOT done.
    const updates = allocateNasiyaPayment({
      schedules: [afterPayment1],
      amountUzs: 440_000,
      appliedAmountInContractCurrency: 40,
      contractCurrency: 'USD',
      now: NOW,
    })

    expect(updates).toHaveLength(1)
    const [update] = updates
    // Contract side is genuinely done: $60 + $40 = $100.
    expect(update.newContractPaidAmount).toBe(100)
    expect(update.newContractRemainingAmount).toBe(0)
    // THE FIX: status is PAID (contract-driven), never PARTIAL/OVERDUE, even
    // though this schedule is past its due date and legacy math alone would
    // have said "100,000 so'm still owed".
    expect(update.status).toBe('PAID')
    expect(update.markPaidAt).toBe(true)
    // Legacy paidAmount is snapped to fully-closed too (compatibility
    // snapshot never left dangling short of expectedAmount).
    expect(update.newPaidAmount).toBe(1_200_000)
  })

  it('REVERSE DRIFT: legacy math would close early (rate rose) — contract math still correctly closes at $0 remaining, no false overpayment created', () => {
    const afterPayment1 = schedule({
      paidAmount: 750_000, // $60 @ rate 12,500
      contractPaidAmount: 60,
    })

    // Payment 2: remaining $40 at a HIGHER rate (13,000) -> amountUzs = 520,000,
    // more so'm than the legacy schedule's remaining 450,000 (1,200,000-750,000).
    const updates = allocateNasiyaPayment({
      schedules: [afterPayment1],
      amountUzs: 520_000,
      appliedAmountInContractCurrency: 40,
      contractCurrency: 'USD',
      now: NOW,
    })

    const [update] = updates
    expect(update.newContractPaidAmount).toBe(100)
    expect(update.newContractRemainingAmount).toBe(0)
    expect(update.status).toBe('PAID')
    // Legacy paidAmount snapped to exactly expectedAmount — never overshoots
    // past it even though the today's-rate legacy-equivalent portion
    // (520,000) would have exceeded the legacy remaining (450,000).
    expect(update.newPaidAmount).toBe(1_200_000)
  })

  it('no drift (same rate throughout): behaves exactly as before — a partial payment stays PARTIAL, not falsely PAID', () => {
    const fresh = schedule({})
    const updates = allocateNasiyaPayment({
      schedules: [fresh],
      amountUzs: 600_000, // half of 1,200,000
      appliedAmountInContractCurrency: 50, // half of $100, same rate as creation
      contractCurrency: 'USD',
      now: NOW,
    })

    const [update] = updates
    expect(update.status).toBe('PARTIAL')
    expect(update.markPaidAt).toBe(false)
    expect(update.newPaidAmount).toBe(600_000)
    expect(update.newContractPaidAmount).toBe(50)
  })

  it('UZS-native nasiya paid in UZS has no currency drift possible — behaves identically to before', () => {
    const uzsSchedule = schedule({
      contractExpectedAmount: 1_200_000,
      contractPaidAmount: 0,
    })
    const updates = allocateNasiyaPayment({
      schedules: [uzsSchedule],
      amountUzs: 1_200_000,
      appliedAmountInContractCurrency: 1_200_000,
      contractCurrency: 'UZS',
      now: NOW,
    })
    const [update] = updates
    expect(update.status).toBe('PAID')
    expect(update.newPaidAmount).toBe(1_200_000)
    expect(update.newContractRemainingAmount).toBe(0)
  })

  it('overdue-ness is still due-date-driven when NOT fully paid (unchanged behavior)', () => {
    const overdueSchedule = schedule({ dueDate: PAST_DUE })
    const updates = allocateNasiyaPayment({
      schedules: [overdueSchedule],
      amountUzs: 100_000, // small partial payment, nowhere near enough to close
      appliedAmountInContractCurrency: 8,
      contractCurrency: 'USD',
      now: NOW,
    })
    const [update] = updates
    expect(update.status).toBe('OVERDUE')
  })

  it('multi-schedule allocation: oldest-unpaid-first order is respected (caller pre-sorts, function just consumes in order)', () => {
    const schedule1 = schedule({ id: 's1', monthNumber: 1, contractExpectedAmount: 50, expectedAmount: 600_000 })
    const schedule2 = schedule({ id: 's2', monthNumber: 2, contractExpectedAmount: 50, expectedAmount: 600_000 })

    const updates = allocateNasiyaPayment({
      schedules: [schedule1, schedule2],
      amountUzs: 900_000, // pays schedule 1 fully (600,000) + half of schedule 2 (300,000)
      appliedAmountInContractCurrency: 75, // $50 + $25
      contractCurrency: 'USD',
      now: NOW,
    })

    expect(updates).toHaveLength(2)
    expect(updates[0].scheduleId).toBe('s1')
    expect(updates[0].status).toBe('PAID')
    expect(updates[1].scheduleId).toBe('s2')
    expect(updates[1].status).toBe('PARTIAL')
    expect(updates[1].newContractPaidAmount).toBe(25)
  })

  it('stops allocating once both remaining amounts are exhausted (does not touch schedules beyond what was paid)', () => {
    const schedule1 = schedule({ id: 's1', contractExpectedAmount: 50, expectedAmount: 600_000 })
    const schedule2 = schedule({ id: 's2', contractExpectedAmount: 50, expectedAmount: 600_000 })
    const updates = allocateNasiyaPayment({
      schedules: [schedule1, schedule2],
      amountUzs: 600_000,
      appliedAmountInContractCurrency: 50,
      contractCurrency: 'USD',
      now: NOW,
    })
    expect(updates).toHaveLength(1)
    expect(updates[0].scheduleId).toBe('s1')
  })
})

describe('allocateNasiyaPayment — ignores contract-currency rounding dust', () => {
  it('does not allocate a USD dust remainder smaller than one cent to the next schedule', () => {
    const schedule1 = schedule({ id: 's1', monthNumber: 1, contractExpectedAmount: 36.89, expectedAmount: 461_125 })
    const schedule2 = schedule({ id: 's2', monthNumber: 2, contractExpectedAmount: 36.89, expectedAmount: 461_125 })

    const updates = allocateNasiyaPayment({
      schedules: [schedule1, schedule2],
      amountUzs: 461_125,
      appliedAmountInContractCurrency: 36.894,
      contractCurrency: 'USD',
      now: NOW,
    })

    expect(updates).toHaveLength(1)
    expect(updates[0].scheduleId).toBe('s1')
    expect(updates[0].appliedContract).toBe(36.89)
    expect(updates[0].status).toBe('PAID')
  })

  it('does not mark a current schedule PARTIAL for a USD dust-only payment', () => {
    const updates = allocateNasiyaPayment({
      schedules: [schedule({ id: 's1', monthNumber: 1 })],
      amountUzs: 100,
      appliedAmountInContractCurrency: 0.004,
      contractCurrency: 'USD',
      now: NOW,
    })

    expect(updates).toHaveLength(0)
  })

  it('does not allocate tiny 1–499 so‘m UZS dust to the next schedule', () => {
    const schedule1 = schedule({ id: 's1', monthNumber: 1, contractExpectedAmount: 500_000, expectedAmount: 500_000 })
    const schedule2 = schedule({ id: 's2', monthNumber: 2, contractExpectedAmount: 500_000, expectedAmount: 500_000 })

    const updates = allocateNasiyaPayment({
      schedules: [schedule1, schedule2],
      amountUzs: 500_499,
      appliedAmountInContractCurrency: 500_499,
      contractCurrency: 'UZS',
      now: NOW,
    })

    expect(updates).toHaveLength(1)
    expect(updates[0].scheduleId).toBe('s1')
    expect(updates[0].appliedContract).toBe(500_000)
  })

  it('still allocates a real USD overpayment of one cent or more to the next schedule', () => {
    const schedule1 = schedule({ id: 's1', monthNumber: 1, contractExpectedAmount: 36.89, expectedAmount: 461_125 })
    const schedule2 = schedule({ id: 's2', monthNumber: 2, contractExpectedAmount: 36.89, expectedAmount: 461_125 })

    const updates = allocateNasiyaPayment({
      schedules: [schedule1, schedule2],
      amountUzs: 461_250,
      appliedAmountInContractCurrency: 36.9,
      contractCurrency: 'USD',
      now: NOW,
    })

    expect(updates).toHaveLength(2)
    expect(updates[1].scheduleId).toBe('s2')
    expect(updates[1].appliedContract).toBe(0.01)
    expect(updates[1].status).toBe('PARTIAL')
  })
})

describe('totalContractOutstanding (item 4 — overpayment gate uses contract currency, not legacy UZS)', () => {
  it('sums per-schedule contract-currency outstanding, ignoring legacy UZS entirely', () => {
    const schedules = [
      schedule({ contractExpectedAmount: 100, contractPaidAmount: 60 }),
      schedule({ contractExpectedAmount: 50, contractPaidAmount: 0 }),
    ]
    expect(totalContractOutstanding(schedules, 'USD')).toBe(90)
  })

  it('is 0 once every schedule is contract-complete, regardless of legacy drift', () => {
    const schedules = [schedule({ contractExpectedAmount: 100, contractPaidAmount: 100, expectedAmount: 1_200_000, paidAmount: 1_100_000 })]
    expect(totalContractOutstanding(schedules, 'USD')).toBe(0)
  })
})
