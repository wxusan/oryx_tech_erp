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

  it('uses the shared canonical derivation and exposes display fields', () => {
    expect(src).toContain('deriveNasiyaOverdue')
    expect(src).toContain('displayStatus')
    expect(src).toContain('isOverdue')
    expect(src).toContain('overdueAmount')
    expect(src).toContain('nextPaymentDate')
  })
})

describe('nasiyalar list client renders the derived display status', () => {
  const src = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')

  it('status filtering is real server-side pagination (GET /api/nasiya?status=...), not a client-side check against the lagging n.status', () => {
    // The list is now server-paginated (true skip/take/total, not a
    // load-everything-then-filter-in-JS array), so the status filter has to
    // travel to the server as a query param instead of running as a
    // client-side .filter() — see getShopNasiyalarList in shop-lists.ts.
    expect(src).toContain("params.set('status', filter)")
    expect(src).not.toContain('n.status === activeFilter')
  })

  it('badges and highlights by the derived status', () => {
    expect(src).toContain('StatusBadge status={n.displayStatus}')
    expect(src).toContain('n.isOverdue')
  })
})

describe('nasiya detail page derives per-row overdue', () => {
  const src = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('uses scheduleDisplayStatus for the row badge instead of the raw status', () => {
    expect(src).toContain('rowDisplayStatus(row)')
    expect(src).toContain('scheduleDisplayStatus')
    expect(src).not.toContain('status={row.status as RowStatus}')
  })
})

describe('cron invalidates overdue caches', () => {
  const src = read('src/app/api/cron/reminders/route.ts')

  it('busts nasiya/stat caches for shops it marks OVERDUE', () => {
    expect(src).toContain('invalidateShopOverdueCron')
  })
})
