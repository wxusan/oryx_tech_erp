import { describe, expect, it } from 'vitest'
import { reconcileNasiyaLedger, type NasiyaLedgerInput } from '@/lib/nasiya-ledger'

const NOW = new Date('2026-07-16T12:00:00.000Z')
const FUTURE = new Date('2026-08-01T12:00:00.000Z')
const PAST = new Date('2026-07-01T12:00:00.000Z')

function ledgerInput(overrides: Partial<NasiyaLedgerInput> = {}): NasiyaLedgerInput {
  return {
    status: 'ACTIVE',
    contractCurrency: 'UZS',
    contractFinalAmount: '1000',
    contractPaidAmount: '0',
    contractRemainingAmount: '1000',
    schedules: [
      {
        id: 'schedule-1',
        status: 'PENDING',
        dueDate: FUTURE,
        delayedUntil: null,
        contractCurrency: 'UZS',
        contractExpectedAmount: '1000',
        contractPaidAmount: '0',
        contractRemainingAmount: '1000',
      },
    ],
    ...overrides,
  }
}

describe('reconcileNasiyaLedger', () => {
  it('keeps a USD contract exactly in USD across future exchange-rate changes', () => {
    const ledger = reconcileNasiyaLedger(ledgerInput({
      contractCurrency: 'USD',
      contractFinalAmount: '1000.00',
      contractPaidAmount: '0.00',
      contractRemainingAmount: '1000.00',
      schedules: [{
        id: 'usd-schedule',
        status: 'PENDING',
        dueDate: FUTURE,
        delayedUntil: null,
        contractCurrency: 'USD',
        contractExpectedAmount: '1000.00',
        contractPaidAmount: '0.00',
        contractRemainingAmount: '1000.00',
      }],
    }), NOW)

    expect(ledger.health).toBe('HEALTHY')
    expect(ledger.financed).toEqual({ currency: 'USD', minorUnits: 100_000 })
    expect(ledger.remaining).toEqual({ currency: 'USD', minorUnits: 100_000 })
  })

  it('marks only a stale parent cache as safely repairable', () => {
    const ledger = reconcileNasiyaLedger(ledgerInput({
      status: 'COMPLETED',
      contractFinalAmount: '9800000',
      contractPaidAmount: '9800000',
      contractRemainingAmount: '0',
      schedules: [{
        id: 'known-schedule',
        status: 'PARTIAL',
        dueDate: FUTURE,
        delayedUntil: null,
        contractCurrency: 'UZS',
        contractExpectedAmount: '9800000',
        contractPaidAmount: '9799942',
        contractRemainingAmount: '58',
      }],
    }), NOW)

    expect(ledger.health).toBe('REPAIRABLE_PARENT_CACHE')
    expect(ledger.repair).toEqual({
      contractPaid: { currency: 'UZS', minorUnits: 9_799_942 },
      contractRemaining: { currency: 'UZS', minorUnits: 58 },
      status: 'ACTIVE',
    })
  })

  it('quarantines schedule arithmetic evidence that cannot be safely repaired as a cache', () => {
    const ledger = reconcileNasiyaLedger(ledgerInput({
      schedules: [{
        id: 'bad-schedule',
        status: 'PARTIAL',
        dueDate: FUTURE,
        delayedUntil: null,
        contractCurrency: 'UZS',
        contractExpectedAmount: '1000',
        contractPaidAmount: '999',
        contractRemainingAmount: '2',
      }],
    }), NOW)

    expect(ledger.health).toBe('QUARANTINED')
    expect(ledger.repair).toBeNull()
    expect(ledger.reasons).toContain('schedule bad-schedule: expected does not equal paid plus remaining')
  })

  it('quarantines a complete allocation history that disagrees with schedule payment facts', () => {
    const ledger = reconcileNasiyaLedger(ledgerInput({
      contractPaidAmount: '1000',
      contractRemainingAmount: '0',
      status: 'COMPLETED',
      schedules: [{
        id: 'paid-schedule',
        status: 'PAID',
        dueDate: FUTURE,
        delayedUntil: null,
        contractCurrency: 'UZS',
        contractExpectedAmount: '1000',
        contractPaidAmount: '1000',
        contractRemainingAmount: '0',
      }],
      allocationHistoryComplete: true,
      allocations: [{ nasiyaScheduleId: 'paid-schedule', contractCurrency: 'UZS', contractAmount: '999' }],
    }), NOW)

    expect(ledger.health).toBe('QUARANTINED')
    expect(ledger.allocationLedger).toBe('MISMATCH')
  })

  it('derives overdue state from unpaid schedules rather than a stale parent status', () => {
    const ledger = reconcileNasiyaLedger(ledgerInput({
      schedules: [{
        id: 'late-schedule',
        status: 'OVERDUE',
        dueDate: PAST,
        delayedUntil: null,
        contractCurrency: 'UZS',
        contractExpectedAmount: '1000',
        contractPaidAmount: '0',
        contractRemainingAmount: '1000',
      }],
    }), NOW)

    expect(ledger.status).toBe('OVERDUE')
    expect(ledger.overdue).toEqual({ currency: 'UZS', minorUnits: 1000 })
    expect(ledger.health).toBe('REPAIRABLE_PARENT_CACHE')
  })
})
