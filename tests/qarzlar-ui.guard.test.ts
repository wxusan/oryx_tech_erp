import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync('src/app/(shop)/shop/qarzlar/qarzlar-client.tsx', 'utf8')
const dashboardSource = readFileSync('src/app/(shop)/shop/dashboard/dashboard-client.tsx', 'utf8')
const statsQuerySource = readFileSync('src/lib/server/shop-stats-queries.ts', 'utf8')

describe('Qarz UI release guards', () => {
  it('never renders stale rows from the other debt tab during a query transition', () => {
    expect(clientSource).toContain("const activeData = data?.tab === tab ? data : null")
    expect(clientSource).toContain('const items = activeData?.items ?? []')
  })

  it('uses a hydration-safe online status snapshot', () => {
    expect(clientSource).toContain('useSyncExternalStore(subscribeOnlineStatus, onlineSnapshot, onlineServerSnapshot)')
    expect(clientSource).not.toContain("typeof navigator !== 'undefined'")
  })

  it('shows all unpaid supplier balances on the dashboard regardless of due month', () => {
    expect(dashboardSource).toContain('stats.supplierPayablesOpenAllTimeUzs')
    expect(dashboardSource).toContain('stats.supplierPayablesOpenAllTimeCount')
    expect(statsQuerySource).toContain('supplier_open_all_uzs')
    expect(statsQuerySource).toContain('(SELECT count(*) FROM supplier_open)::integer AS supplier_open_all_count')
  })
})
