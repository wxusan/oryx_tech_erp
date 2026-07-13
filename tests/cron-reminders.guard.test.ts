import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level regression GUARD for the overdue-reminder fix (req 12). The
// selection/dedupe live inline in the cron route (a Prisma query). Real DB
// behavior is covered by tests/integration/reminder-cron.integration.test.ts;
// this guard fails quickly if the wiring is reverted.

const src = readFileSync(
  resolve(process.cwd(), 'src/app/api/cron/reminders/route.ts'),
  'utf8',
).replace(/\s+/g, ' ')

describe('cron overdue-reminder guard (req 12)', () => {
  it('overdue nasiya selection includes OVERDUE so chronic debtors keep alerting', () => {
    expect(src).toContain("status: { in: ['PENDING', 'PARTIAL', 'DEFERRED', 'OVERDUE'] }")
  })

  it('due reminders use the durable catch-up window while overdue alerts remain current-day', () => {
    expect(src).toContain('dueDate: { gte: windowStart, lt: windowEnd }')
    expect(src).toContain('dueDate: { lt: today }')
  })

  it('reminders are deduped once per Tashkent day per admin (no same-day spam)', () => {
    expect(src).toContain('REMINDER:${triggerDay.dayKey}')
    expect(src).toContain('OVERDUE:${dayKey}')
  })

  it('overdue notification + status update happen in one transaction', () => {
    expect(src).toContain('transitionNasiyaToOverdue({')
  })

  it('transitions active debt regardless of reminder preference, but queues alerts only when enabled', () => {
    const selection = src.slice(src.indexOf("'NASIYA_OVERDUE'"), src.indexOf("'NASIYA_EARLY'"))
    expect(selection).not.toContain('reminderEnabled: true')
    expect(selection).toContain("status: { in: ['ACTIVE', 'OVERDUE'] }")
    expect(src).toContain('if (schedule.nasiya.reminderEnabled)')
  })

  it('respects disabled sale reminders for both due-today and overdue sales', () => {
    const dueTodayBlock = src.slice(src.indexOf("'SALE_DUE'"), src.indexOf("'SALE_OVERDUE'"))
    const overdueBlock = src.slice(src.indexOf("'SALE_OVERDUE'"), src.indexOf("'SALE_EARLY'"))

    expect(dueTodayBlock).toContain('reminderEnabled: true')
    expect(dueTodayBlock).toContain('dueDate: { gte: windowStart, lt: windowEnd }')
    expect(overdueBlock).toContain('reminderEnabled: true')
    expect(overdueBlock).toContain('dueDate: { lt: today }')
  })
})
