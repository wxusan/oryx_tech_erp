import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { hasValidNasiyaScheduleNativeLedger } from '@/lib/server/overdue-transition'

describe('hasValidNasiyaScheduleNativeLedger', () => {
  it('accepts an unpaid schedule with a matching native remaining balance', () => {
    expect(hasValidNasiyaScheduleNativeLedger({
      contractExpectedAmount: '120.00',
      contractPaidAmount: '0.00',
      contractRemainingAmount: '120.00',
      contractCurrency: 'USD',
      status: 'PENDING',
    })).toBe(true)
  })

  it('quarantines the historic zero-remaining row that would fail the database constraint', () => {
    expect(hasValidNasiyaScheduleNativeLedger({
      contractExpectedAmount: '120.00',
      contractPaidAmount: '0.00',
      contractRemainingAmount: '0.00',
      contractCurrency: 'USD',
      status: 'PENDING',
    })).toBe(false)
  })

  it('rejects a paid status while balance remains', () => {
    expect(hasValidNasiyaScheduleNativeLedger({
      contractExpectedAmount: '120.00',
      contractPaidAmount: '10.00',
      contractRemainingAmount: '110.00',
      contractCurrency: 'USD',
      status: 'PAID',
    })).toBe(false)
  })
})
