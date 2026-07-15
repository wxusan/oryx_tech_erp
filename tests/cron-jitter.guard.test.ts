import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('cron schedules planned reminders with jitter', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('all nine planned reminder types use the deterministic 11:00 jitter', () => {
    expect(cron).toContain("import { scheduledReminderSendAt } from '@/lib/notification-schedule'")
    // No planned reminder is scheduled at raw `new Date()` (would fire immediately).
    expect(cron).not.toContain('scheduledAt: new Date(),')
    const count = cron.split('scheduledAt: scheduledReminderSendAt(dedupeKey,').length - 1
    // REMINDER, OVERDUE, EARLY_REMINDER, SALE_REMINDER, SALE_OVERDUE, SALE_EARLY_REMINDER,
    // SUPPLIER_PAYABLE_REMINDER, SUPPLIER_PAYABLE_OVERDUE, SUPPLIER_PAYABLE_EARLY_REMINDER
    expect(count).toBe(9)
  })

  it('only busts caches for shops that actually transitioned to OVERDUE (no thrash)', () => {
    expect(cron).toContain('const transitionedShopIds = new Set<string>()')
    expect(cron).toContain('if (transitioned) transitionedShopIds.add(schedule.nasiya.shopId)')
    expect(cron).toContain('for (const overdueShopId of transitionedShopIds)')
  })

  it('queues reminders only for opted-in, verified, non-deleted admins', () => {
    expect(cron).toContain('reminderEnabled: true')
    expect(cron).toContain('telegramVerifiedAt: { not: null }')
    expect(cron).toContain('telegramNotificationsEnabled: true')
    expect(cron).toContain('deletedAt: null')
  })
})

describe('immediate notifications are NOT jittered', () => {
  it('sale/nasiya/payment events still queue with scheduledAt = now', () => {
    // Spot-check the sell route: an immediate SALE notification keeps new Date().
    const sell = read('src/app/api/devices/[id]/sell/route.ts')
    expect(sell).toContain('scheduledAt: new Date()')
    expect(sell).not.toContain('scheduledReminderSendAt')
  })
})

describe('vercel cron cadence drains the jitter window', () => {
  const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
  it('runs the reminders cron once daily, after the 11:00-11:30 jitter window closes (Hobby plan: no sub-daily cron)', () => {
    const cron = vercel.crons.find((c) => c.path === '/api/cron/reminders')
    expect(cron).toBeTruthy()
    expect(cron?.schedule).toBe('35 6 * * *')
    // 06:35 UTC = 11:35 Asia/Tashkent (UTC+5) — 5 minutes after the 11:00-11:30
    // jitter window closes, so a single run catches every reminder for the day.
    const [minute, hour] = (cron?.schedule ?? '').split(' ')
    expect(Number(hour) + 5).toBe(11) // 6 UTC + 5h offset = 11 Tashkent
    expect(minute).toBe('35')
  })
})
