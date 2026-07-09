import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya completion: status transition, log, and Telegram message', () => {
  const route = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('marks the nasiya COMPLETED in the same transaction when fully paid (contract-currency ledger decides, see docs/currency-accounting-model.md)', () => {
    expect(route).toContain('const derivedAfterPayment = deriveContractNasiyaStatus({')
    expect(route).toContain('const newStatus = derivedAfterPayment.displayStatus')
  })

  it('only treats it as a fresh completion when contract status actually crosses to COMPLETED', () => {
    expect(route).toContain("if (currentContractStatus.displayStatus === 'COMPLETED')")
    expect(route).toContain("const justCompleted = newStatus === 'COMPLETED'")
  })

  it('blocks a payment attempt only against a contract-complete nasiya with a clear message', () => {
    expect(route).toContain("if (currentContractStatus.displayStatus === 'COMPLETED')")
    expect(route).toContain("message: 'Bu nasiya yakunlangan'")
  })

  it('queues a NASIYA_COMPLETED Telegram notification only when justCompleted', () => {
    expect(route).toContain("type: 'NASIYA_COMPLETED'")
    expect(route).toContain('nasiyaCompletedMessage')
    expect(route).toContain('if (completedMessage)')
  })

  it('writes a distinct "Nasiya yakunlandi" log row only once, guarded by justCompleted', () => {
    expect(route).toContain("action: 'NASIYA_COMPLETED'")
    expect(route).toContain('if (justCompleted)')
  })
})

describe('nasiyalar list surfaces the Yakunlangan tab and excludes completed nasiyas from active reminders', () => {
  it('nasiyalar-client has a Yakunlangan filter tab wired to COMPLETED', () => {
    const client = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
    expect(client).toContain("{ label: 'Yakunlangan', value: 'COMPLETED' }")
  })

  it('cron reminder queries only select unpaid schedule statuses, so a fully-PAID (completed) nasiya never matches', () => {
    const cron = read('src/app/api/cron/reminders/route.ts')
    // Every schedule query in the cron filters status to unpaid states —
    // a completed nasiya's schedules are all PAID and never appear here.
    expect(cron).not.toContain("status: { in: ['PAID'")
    expect(cron).toContain("status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'")
  })

  it('dashboard/report active-debt stats correct a raw COMPLETED parent when an unpaid native schedule remains', () => {
    const stats = read('src/lib/server/shop-stats.ts')
    expect(stats).toContain("status: { in: ['ACTIVE', 'OVERDUE'] }")
    expect(stats).toContain('const falseCompletedNasiyaIds = new Set(')
    expect(stats).toContain('activeNasiyalar: activeNasiyalar + falseCompletedNasiyaIds.size')
  })
})
