import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level regression GUARD for the overdue-reminder fix (req 12). The
// selection/dedupe live inline in the cron route (a Prisma query), so a true
// behavioural test needs a DB (see integration.todo.test.ts). This guard fails
// if the fix is reverted.

const src = readFileSync(
  resolve(process.cwd(), 'src/app/api/cron/reminders/route.ts'),
  'utf8',
).replace(/\s+/g, ' ')

describe('cron overdue-reminder guard (req 12)', () => {
  it('overdue nasiya selection includes OVERDUE so chronic debtors keep alerting', () => {
    expect(src).toContain("status: { in: ['PENDING', 'PARTIAL', 'DEFERRED', 'OVERDUE'] }")
  })

  it('due-today and overdue windows are date-disjoint (no same-schedule duplicate)', () => {
    expect(src).toContain('dueDate: { gte: today, lt: tomorrow }') // due today
    expect(src).toContain('dueDate: { lt: today }') // overdue
  })

  it('reminders are deduped once per Tashkent day per admin (no same-day spam)', () => {
    expect(src).toContain('REMINDER:${dayKey}')
    expect(src).toContain('OVERDUE:${dayKey}')
  })

  it('overdue notification + status update happen in one transaction', () => {
    expect(src).toContain('prisma.$transaction')
  })

  it('transitions active debt regardless of reminder preference, but queues alerts only when enabled', () => {
    const overdueStart = src.indexOf('const overdue = await prisma.nasiyaSchedule.findMany')
    const overdueLoop = src.indexOf('for (const schedule of overdue)')
    const selection = src.slice(overdueStart, overdueLoop)
    expect(selection).not.toContain('reminderEnabled: true')
    expect(selection).toContain("status: { in: ['ACTIVE', 'OVERDUE'] }")
    expect(src).toContain('if (schedule.nasiya.reminderEnabled)')
  })

  it('respects disabled sale reminders for both due-today and overdue sales', () => {
    const dueTodayStart = src.indexOf('const salePaymentsDueToday = await prisma.sale.findMany')
    const overdueStart = src.indexOf('const overdueSales = await prisma.sale.findMany')
    const dueTodayBlock = src.slice(dueTodayStart, overdueStart)
    const overdueBlock = src.slice(overdueStart, src.indexOf('for (const sale of overdueSales)'))

    expect(dueTodayBlock).toContain('reminderEnabled: true')
    expect(dueTodayBlock).toContain('dueDate: { gte: today, lt: tomorrow }')
    expect(overdueBlock).toContain('reminderEnabled: true')
    expect(overdueBlock).toContain('dueDate: { lt: today }')
  })
})
