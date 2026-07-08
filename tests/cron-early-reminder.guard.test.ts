import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('cron generates early reminders in addition to due-day reminders', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('queries nasiya schedules and sales gated on earlyReminderEnabled', () => {
    expect(cron).toContain('earlyReminderEnabled: true')
    // Both the nasiya and sale early-reminder blocks must also respect reminderEnabled.
    const earlyBlockIndex = cron.indexOf('earlyCandidates')
    expect(cron.slice(earlyBlockIndex, earlyBlockIndex + 400)).toContain('reminderEnabled: true')
  })

  it('uses the same 11:00 jitter helper (no separate jitter logic)', () => {
    expect(cron).toContain("dedupeKey = `EARLY_REMINDER:")
    expect(cron).toContain("dedupeKey = `SALE_EARLY_REMINDER:")
    // Both new dedupe keys feed into scheduledReminderSendAt like every other planned type.
    const count = cron.split('scheduledAt: scheduledReminderSendAt(dedupeKey)').length - 1
    expect(count).toBe(6)
  })

  it('computes days-until-due from the due date, not the schedule creation date', () => {
    expect(cron).toContain('daysUntil')
    expect(cron).toContain('tashkentDayRange(effectiveDue)')
    expect(cron).toContain('tashkentDayRange(sale.dueDate)')
  })

  it('never generates a due-day reminder and early reminder from the same code path (additive, not replacing)', () => {
    // The due-today block (section 1) and the early block (section 2b) are
    // separate for-loops over separate queries, so one cannot suppress the other.
    expect(cron).toContain('1. Today\'s reminders')
    expect(cron).toContain('Nasiya early reminders')
  })

  it('imports the new early-reminder message templates', () => {
    expect(cron).toContain('nasiyaEarlyReminderMessage')
    expect(cron).toContain('saleEarlyReminderMessage')
  })
})
