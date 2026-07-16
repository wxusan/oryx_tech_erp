import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level GUARDS for the overdue-display wiring. The derivation itself is
// unit-tested in nasiya-utils.test.ts; these fail if a surface is reverted to
// relying on the lagging parent Nasiya.status.

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('nasiyalar list loader derives overdue server-side', () => {
  const src = read('src/lib/server/shop-lists.ts')

  it('selects the schedule amounts needed to derive overdue', () => {
    expect(src).toContain('expectedAmount: true')
    expect(src).toContain('paidAmount: true')
  })

  it('uses the shared contract-authoritative derivation and exposes display fields', () => {
    expect(src).toContain('deriveContractNasiyaStatus')
    expect(src).toContain('contractExpectedAmount: true')
    expect(src).toContain('contractPaidAmount: true')
    expect(src).toContain('displayStatus')
    expect(src).toContain('isOverdue')
    expect(src).toContain('overdueAmount')
    expect(src).toContain('nextPaymentDate')
  })
})

describe('nasiyalar list client renders the derived display status', () => {
  const src = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')

  it('tab filtering requests the server’s contract-derived cohort/status, not a client-side raw status check', () => {
    expect(src).toContain("params.set('tab', filter)")
    expect(src).not.toContain('n.status === activeFilter')
  })

  it('badges and highlights by the derived status', () => {
    expect(src).toContain('StatusBadge status={n.displayStatus}')
    expect(src).toContain('n.isOverdue')
  })
})

describe('nasiya detail page renders server-reconciled schedule DTOs', () => {
  const src = read('src/components/shop/nasiya-history-sections.tsx')

  it('derives the row badge from its reconciled remaining amount instead of trusting a stale raw label', () => {
    expect(src).toContain('function rowStatus(row: NasiyaScheduleRow): RowStatus')
    expect(src).toContain('if (row.remaining.minorUnits === 0) return \'PAID\'')
    expect(src).not.toContain('status={row.status as RowStatus}')
  })
})

describe('cron invalidates overdue caches', () => {
  const src = read('src/app/api/cron/reminders/route.ts')

  it('busts nasiya/stat caches for shops it marks OVERDUE', () => {
    expect(src).toContain('invalidateShopOverdueCron')
  })
})
