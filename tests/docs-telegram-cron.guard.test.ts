import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('cron docs exist and state the schedule + timezone', () => {
  const doc = read('docs/cron-jobs.md')

  it('documents the reminders route, cadence and Tashkent window', () => {
    expect(doc).toContain('/api/cron/reminders')
    expect(doc).toContain('35 6 * * *')
    expect(doc).toContain('Asia/Tashkent')
    expect(doc).toContain('11:00')
    expect(doc).toContain('CRON_SECRET')
  })

  it('explains how to confirm a run and how to test manually', () => {
    expect(doc).toContain('/admin/ops')
    expect(doc).toContain('cron.reminders.completed')
    expect(doc).toContain('curl')
  })
})

describe('telegram/cron audit exists and inventories every message type', () => {
  const doc = read('docs/telegram-cron-audit.md')

  it('lists the scheduled reminder types and their 11:00 window', () => {
    for (const t of ['REMINDER', 'OVERDUE', 'SALE_REMINDER', 'SALE_OVERDUE']) {
      expect(doc).toContain(t)
    }
    expect(doc).toContain('11:00–11:30')
  })

  it('lists the immediate event types', () => {
    for (const t of ['SALE', 'NASIYA', 'RETURN', 'RESTOCK', 'PAYMENT_RECEIVED', 'DEVICE_CREATED']) {
      expect(doc).toContain(t)
    }
  })

  it('documents the privacy stance (device photos only, no passport)', () => {
    expect(doc.toLowerCase()).toContain('passport')
    expect(doc).toContain('signed URL')
  })
})
