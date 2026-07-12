import { describe, expect, it } from 'vitest'
import { isBeforeTashkentToday } from '@/lib/timezone'
import { isContractScheduleOverdue } from '@/lib/nasiya-contract'

describe('Tashkent due-day boundary', () => {
  const today = new Date('2026-07-12T18:59:59.000+05:00')

  it('keeps every time on the due calendar day due-today, not overdue', () => {
    expect(isBeforeTashkentToday('2026-07-12T00:00:00.000Z', today)).toBe(false)
    expect(isContractScheduleOverdue({ status: 'PENDING', dueDate: new Date('2026-07-12T00:00:00.000Z'), delayedUntil: null, expectedAmount: 100, paidAmount: 0 }, 'USD', today)).toBe(false)
  })

  it('marks it overdue only on the next Tashkent day', () => {
    const tomorrow = new Date('2026-07-13T00:00:00.000+05:00')
    expect(isBeforeTashkentToday('2026-07-12T00:00:00.000Z', tomorrow)).toBe(true)
  })
})
