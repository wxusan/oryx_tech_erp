import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('Qarz work queue', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/page.tsx')
  const client = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')
  const lists = read('src/lib/server/shop-lists.ts')

  it('accepts the exact banner URL and makes the requested focus visible without hiding earlier debt', () => {
    expect(page).toContain("tab?.toLowerCase() === 'qarz'")
    expect(page).toContain("focus === 'OVERDUE' || focus === 'DUE_TODAY'")
    expect(client).toContain("tab: activeStatus === 'SOLD_DEBT' ? 'qarz' : null")
    expect(client).toContain('Muddati o\'tgan qarzlar ro\'yxatning yuqorisida turadi.')
    expect(client).toContain("Avval muddati o'tgan qarzlar, undan keyin bugun to'lanadigan qarzlar")
  })

  it('orders debt in PostgreSQL as overdue, today, upcoming, then no-date', () => {
    expect(lists).toContain('async function findShopDebtDeviceIdsByPriority')
    expect(lists).toContain('WHEN sale."dueDate" < ${start} THEN 0')
    expect(lists).toContain('WHEN sale."dueDate" < ${end} THEN 1')
    expect(lists).toContain('WHEN sale."dueDate" IS NOT NULL THEN 2')
    expect(lists).toContain('ELSE 3')
    expect(lists).toContain('ORDER BY payment_priority ASC, due_date ASC NULLS LAST, sale_created_at DESC, "id" ASC')
    expect(lists).toContain("query.status === 'SOLD_DEBT'")
  })
})

describe('Nasiya cohort tabs', () => {
  const route = read('src/app/api/nasiya/route.ts')
  const page = read('src/app/(shop)/shop/nasiyalar/page.tsx')
  const client = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
  const lists = read('src/lib/server/shop-lists.ts')

  it('uses tab=ACTIVE/DUE_TODAY/OVERDUE as the exact server and client contract', () => {
    expect(route).toContain("const cohortFilters = ['ACTIVE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING'] as const")
    expect(route).toContain("const tabParam = searchParams.get('tab')")
    expect(page).toContain("['ACTIVE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING']")
    expect(lists).toContain("display_status IN ('ACTIVE', 'OVERDUE')")
    expect(client).toContain("{ label: \"Bugun to'lanadi\", value: 'DUE_TODAY' }")
    expect(client).toContain("{ label: \"Muddati o'tgan\", value: 'OVERDUE' }")
    expect(client).toContain("params.set('tab', filter)")
  })

  it('keeps each schedule in its real cohort when a contract has both old and today debt', () => {
    expect(lists).toContain("display_status IN ('ACTIVE', 'OVERDUE') AND has_overdue")
    expect(lists).toContain("display_status IN ('ACTIVE', 'OVERDUE') AND has_due_today")
    expect(lists).not.toContain("display_status = 'ACTIVE' AND NOT has_overdue AND has_due_today")
    expect(lists).toContain('AND NOT has_due_today')
    expect(lists).toContain('AND has_upcoming')
    expect(lists).toContain('deriveNasiyaCollectionWorkItem')
    expect(lists).toContain('collectionWorkItem')
    expect(client).toContain('preferredScheduleId={payFor?.collectionWorkItem?.preferredScheduleId}')
    expect(client).toContain("Shartnomada eski qarz bor")
    expect(lists).toContain("s.\"status\" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')")
    expect(lists).toContain('n."returnedAt" IS NULL')
  })
})
