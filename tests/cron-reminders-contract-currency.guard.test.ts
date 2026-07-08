import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatContractMoneyWithDisplay } from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('cron reminders use contract-currency remaining amounts', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('due-today, overdue, and early reminders all pass contractCurrency + a contractScheduleOutstanding-derived amountDue', () => {
    const occurrences = cron.split('contractScheduleOutstanding(Number(schedule.contractExpectedAmount)').length - 1
    expect(occurrences).toBe(3)
    const contractCurrencyFields = cron.split('contractCurrency: ').length - 1
    expect(contractCurrencyFields).toBeGreaterThanOrEqual(3)
  })

  it('dedupe keys, jitter, and bounded-query patterns are unchanged', () => {
    expect(cron).toContain('REMINDER:${dayKey}:${admin.telegramId}:${schedule.id}')
    expect(cron).toContain('OVERDUE:${dayKey}:${admin.telegramId}:${schedule.id}')
    expect(cron).toContain('EARLY_REMINDER:${dayKey}:${admin.telegramId}:${schedule.id}')
    expect(cron).toContain('scheduledReminderSendAt(dedupeKey)')
  })
})

describe('nasiya reminder Telegram templates format the contract-currency amount natively', () => {
  const templates = read('src/lib/telegram-templates.ts')

  it('nasiyaDueTodayMessage/nasiyaOverdueMessage/nasiyaEarlyReminderMessage require contractCurrency and use formatContractMoneyWithDisplay', () => {
    const occurrences = templates.split('formatContractMoneyWithDisplay(data.amountDue, data.contractCurrency,').length - 1
    expect(occurrences).toBe(3)
  })
})

describe('formatContractMoneyWithDisplay — native leads, display equivalent is a hint', () => {
  it('same currency: just the native figure, no parenthetical', () => {
    expect(formatContractMoneyWithDisplay(200, 'USD', 'USD', 13_500)).toBe('$200.00')
  })

  it('USD contract shown to a UZS-display shop: native $ leads, so\'m equivalent in parentheses', () => {
    const text = formatContractMoneyWithDisplay(200, 'USD', 'UZS', 12_500)
    expect(text.startsWith('$200.00')).toBe(true)
    expect(text).toMatch(/\(~2.?500.?000 so'm\)/)
  })

  it('UZS contract shown to a USD-display shop: native so\'m leads, $ equivalent in parentheses', () => {
    const text = formatContractMoneyWithDisplay(2_000_000, 'UZS', 'USD', 12_500)
    expect(text).toMatch(/^2.?000.?000 so'm/)
    expect(text).toContain('(~$160.00)')
  })

  it('falls back to just the native figure when no rate is available', () => {
    expect(formatContractMoneyWithDisplay(200, 'USD', 'UZS', null)).toBe('$200.00')
  })
})
