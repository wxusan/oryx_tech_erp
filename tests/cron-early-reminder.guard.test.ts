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
    const nasiyaEarly = cron.slice(cron.indexOf("'NASIYA_EARLY'"), cron.indexOf("'SALE_DUE'"))
    const saleEarly = cron.slice(cron.indexOf("'SALE_EARLY'"), cron.indexOf("'SUPPLIER_DUE'"))
    expect(nasiyaEarly).toContain('reminderEnabled: true')
    expect(saleEarly).toContain('reminderEnabled: true')
  })

  it('uses the same 11:00 jitter helper (no separate jitter logic)', () => {
    expect(cron).toContain("dedupeKey: (recipient) => `EARLY_REMINDER:")
    expect(cron).toContain("dedupeKey: (recipient) => `SALE_EARLY_REMINDER:")
    // Both new dedupe keys feed into scheduledReminderSendAt like every other planned type
    // (total also includes the later supplier-payable reminder blocks — see cron-jitter.guard.test.ts).
    const count = cron.split('scheduledReminderSendAt(').length - 1
    expect(count).toBe(9)
  })

  it('computes the trigger day from the due date and configured lead time', () => {
    expect(cron).toContain('earlyTriggerDay(effectiveDue, nasiya.earlyReminderDays)')
    expect(cron).toContain('earlyTriggerDay(sale.dueDate, sale.earlyReminderDays)')
    expect(cron).not.toContain('createdAt, earlyReminderDays')
  })

  it('never generates a due-day reminder and early reminder from the same code path (additive, not replacing)', () => {
    expect(cron).toContain("await runPhase(\n        'NASIYA_DUE'")
    expect(cron).toContain("await runPhase(\n        'NASIYA_EARLY'")
  })

  it('imports the new early-reminder message templates', () => {
    expect(cron).toContain('nasiyaEarlyReminderMessage')
    expect(cron).toContain('saleEarlyReminderMessage')
  })
})
