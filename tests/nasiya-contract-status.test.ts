import { describe, expect, it } from 'vitest'
import { deriveContractNasiyaStatus, deriveContractScheduleStatus } from '@/lib/nasiya-contract-status'

const FUTURE = new Date('2026-08-15T00:00:00.000Z')
const PAST = new Date('2026-06-15T00:00:00.000Z')
const NOW = new Date('2026-07-10T12:00:00.000Z')

function usdSchedule(overrides: Partial<Parameters<typeof deriveContractScheduleStatus>[0]> = {}) {
  return {
    status: 'PARTIAL',
    dueDate: FUTURE,
    delayedUntil: null,
    // The legacy snapshot was created when $100 was worth 12,000 UZS.
    expectedAmount: 1_200_000,
    // A later 1,200,000 UZS payment at 15,000 UZS/USD fills that snapshot,
    // while it applies only $80 against the actual $100 contract debt.
    paidAmount: 1_200_000,
    contractExpectedAmount: 100,
    contractPaidAmount: 80,
    ...overrides,
  }
}

describe('contract-authoritative nasiya status', () => {
  it('keeps a rate-rise schedule and stale COMPLETED parent open while $20 remains', () => {
    const schedule = usdSchedule()
    expect(deriveContractScheduleStatus(schedule, 'USD', NOW)).toMatchObject({
      displayStatus: 'PARTIAL',
      outstanding: 20,
      isOverdue: false,
    })

    const derived = deriveContractNasiyaStatus(
      {
        status: 'COMPLETED', // legacy-derived/stale and therefore not authoritative
        contractCurrency: 'USD',
        contractFinalAmount: 100,
        contractRemainingAmount: 20,
        schedules: [schedule],
      },
      NOW,
    )

    expect(derived).toMatchObject({
      displayStatus: 'ACTIVE',
      isOverdue: false,
      usesContractLedger: true,
    })
    // The payment endpoint gates on this result, so the final $20 remains payable.
    expect(derived.displayStatus).not.toBe('COMPLETED')
  })

  it('marks the same outstanding contract debt overdue from its effective due date', () => {
    const schedule = usdSchedule({ dueDate: PAST, delayedUntil: null })
    const derived = deriveContractNasiyaStatus(
      {
        status: 'COMPLETED',
        contractCurrency: 'USD',
        contractFinalAmount: 100,
        contractRemainingAmount: 20,
        schedules: [schedule],
      },
      NOW,
    )

    expect(deriveContractScheduleStatus(schedule, 'USD', NOW)).toMatchObject({
      displayStatus: 'OVERDUE',
      outstanding: 20,
      isOverdue: true,
    })
    expect(derived).toMatchObject({ displayStatus: 'OVERDUE', isOverdue: true, overdueAmount: 20, overdueCount: 1 })
  })

  it('completes when a rate fall overpays the contract, even if the legacy mirror is lower', () => {
    const schedule = usdSchedule({ paidAmount: 1_000_000, contractPaidAmount: 120 })
    const derived = deriveContractNasiyaStatus(
      {
        status: 'ACTIVE',
        contractCurrency: 'USD',
        contractFinalAmount: 100,
        contractRemainingAmount: 0,
        schedules: [schedule],
      },
      NOW,
    )

    expect(deriveContractScheduleStatus(schedule, 'USD', NOW)).toMatchObject({ displayStatus: 'PAID', outstanding: 0 })
    expect(derived.displayStatus).toBe('COMPLETED')
  })

  it('completes an exact $100 USD contract payment', () => {
    const schedule = usdSchedule({ contractPaidAmount: 100 })
    const derived = deriveContractNasiyaStatus(
      {
        status: 'ACTIVE',
        contractCurrency: 'USD',
        contractFinalAmount: 100,
        contractRemainingAmount: 0,
        schedules: [schedule],
      },
      NOW,
    )

    expect(derived).toMatchObject({ displayStatus: 'COMPLETED', isOverdue: false })
  })

  it('preserves the SETTLED label while waived profit makes native remaining zero', () => {
    const schedule = usdSchedule({ status: 'SETTLED', contractPaidAmount: 80, contractRemainingAmount: 0 })
    const derived = deriveContractNasiyaStatus(
      {
        status: 'COMPLETED',
        contractCurrency: 'USD',
        contractFinalAmount: 100,
        contractRemainingAmount: 0,
        schedules: [schedule],
      },
      NOW,
    )

    expect(deriveContractScheduleStatus(schedule, 'USD', NOW)).toMatchObject({ displayStatus: 'SETTLED', outstanding: 0 })
    expect(derived).toMatchObject({ displayStatus: 'COMPLETED', isOverdue: false })
  })

  it('does not forgive a meaningful one-cent USD balance', () => {
    const schedule = usdSchedule({ paidAmount: 1_200_000, contractPaidAmount: 99.99 })
    const derived = deriveContractNasiyaStatus(
      {
        status: 'ACTIVE',
        contractCurrency: 'USD',
        contractFinalAmount: 100,
        contractRemainingAmount: 0.01,
        schedules: [schedule],
      },
      NOW,
    )

    expect(deriveContractScheduleStatus(schedule, 'USD', NOW)).toMatchObject({ displayStatus: 'PARTIAL', outstanding: 0.01 })
    expect(derived.displayStatus).toBe('ACTIVE')
  })

  it('uses the old UZS derivation only when native contract data is absent', () => {
    const derived = deriveContractNasiyaStatus(
      {
        status: 'ACTIVE',
        contractCurrency: null,
        contractFinalAmount: null,
        contractRemainingAmount: null,
        schedules: [
          {
            status: 'PARTIAL',
            dueDate: FUTURE,
            delayedUntil: null,
            expectedAmount: 100_000,
            paidAmount: 100_000,
            contractExpectedAmount: null,
            contractPaidAmount: null,
          },
        ],
      },
      NOW,
    )

    expect(derived).toMatchObject({ displayStatus: 'COMPLETED', usesContractLedger: false })
  })

  it('uses delayedUntil instead of the original dueDate for contract overdue checks', () => {
    const schedule = usdSchedule({ dueDate: PAST, delayedUntil: FUTURE })
    expect(deriveContractScheduleStatus(schedule, 'USD', NOW)).toMatchObject({ displayStatus: 'PARTIAL', isOverdue: false })
  })
})
