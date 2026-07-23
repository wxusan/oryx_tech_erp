import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formatContractMoneyWithDisplay } from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('cron reminders use contract-currency remaining amounts', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('due-today, overdue, and early reminders all use the authoritative schedule remaining amount', () => {
    const occurrences = cron.split('amountDue: Number(schedule.contractRemainingAmount)').length - 1
    expect(occurrences).toBe(3)
    expect(cron.split('contractRemainingAmount: { gt: 0 }').length - 1).toBeGreaterThanOrEqual(9)
    const contractCurrencyFields = cron.split('contractCurrency: ').length - 1
    expect(contractCurrencyFields).toBeGreaterThanOrEqual(3)
  })

  it('fails a cross-currency page closed instead of checkpointing a reminder formatted with an unavailable rate', () => {
    expect(cron).toContain('usdUzsRateForRun ??= getUsdUzsRate()')
    expect(cron).not.toContain('getUsdUzsRate().catch(() => null)')
    expect(cron).toContain('if (shop.preferredCurrency === contractCurrency)')
    expect(cron).toContain('await reminderCurrency(nasiya.shop, nasiya.contractCurrency)')
    expect(cron).toContain('await reminderCurrency(sale.shop, sale.contractCurrency)')
    expect(cron).toContain('await reminderCurrency(payable.shop, payable.contractCurrency)')
  })

  it('dedupe keys preserve original trigger days and every query is bounded', () => {
    expect(cron).toContain('REMINDER:${triggerDay.dayKey}:${recipient.id}:${schedule.id}')
    expect(cron).toContain('OVERDUE:${dayKey}:${recipient.id}:${schedule.id}')
    expect(cron).toContain('EARLY_REMINDER:${triggerKey}:${recipient.id}:${schedule.id}')
    expect(cron).toContain('scheduledReminderSendAt(dedupeKey,')
    expect(cron.split('findMany({').length - 1).toBe(9)
    expect(cron.split('orderBy: { id: \'asc\' }').length - 1).toBe(9)
    expect(cron.split('...pageAfter(cursor)').length - 1).toBe(9)
    expect(cron).toContain("generationStatus = acquired.state.windowEnd >= tomorrow ? 'complete' : 'partial'")
  })
})

describe('nasiya reminder Telegram templates format the contract amount in the shop display currency only', () => {
  const templates = read('src/lib/telegram-templates.ts')

  it('nasiyaDueTodayMessage/nasiyaOverdueMessage/nasiyaEarlyReminderMessage require contractCurrency and use the shared contract-money wrapper', () => {
    const occurrences = templates.split('contractMoney(data.amountDue, data.contractCurrency, data.currency)').length - 1
    expect(occurrences).toBe(3)
    expect(templates).toContain('formatContractMoneyWithDisplay(')
  })
})

describe('formatContractMoneyWithDisplay — user-facing single currency', () => {
  it('same currency: just the display figure, no parenthetical', () => {
    expect(formatContractMoneyWithDisplay(200, 'USD', 'USD', 13_500)).toBe('$200.00')
  })

  it('USD contract shown to a UZS-display shop: only UZS is shown', () => {
    expect(formatContractMoneyWithDisplay(200, 'USD', 'UZS', 12_500)).toMatch(/2.?500.?000 so'm/)
    expect(formatContractMoneyWithDisplay(200, 'USD', 'UZS', 12_500)).not.toContain('$')
  })

  it('UZS contract shown to a USD-display shop: only USD is shown', () => {
    expect(formatContractMoneyWithDisplay(2_000_000, 'UZS', 'USD', 12_500)).toBe('$160.00')
  })

  it('returns a dash instead of leaking another currency when no rate is available', () => {
    expect(formatContractMoneyWithDisplay(200, 'USD', 'UZS', null)).toBe('—')
  })
})
