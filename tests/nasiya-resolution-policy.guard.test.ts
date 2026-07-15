import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

describe('Nasiya resolution accounting surface contract', () => {
  it('keeps non-active resolutions out of collection cohorts and reminder generation', () => {
    expect(source('src/lib/server/shop-stats-queries.ts')).toContain('n."resolutionState" = \'ACTIVE\'')
    expect(source('src/app/api/cron/reminders/route.ts')).toContain("resolutionState: 'ACTIVE'")
    expect(source('src/lib/notification-service.ts')).toContain("schedule.nasiya.resolutionState === 'ACTIVE'")
  })

  it('reports write-off and compensating reopen amounts without rewriting history', () => {
    const dashboard = source('src/lib/server/shop-stats-queries.ts')
    const report = source('src/lib/server/shop-report-range.ts')
    const migration = source('prisma/migrations/202607130008_nasiya_resolution_deferral/migration.sql')

    for (const implementation of [dashboard, report]) {
      expect(implementation).toContain("e.\"eventType\" = 'WRITE_OFF'")
      expect(implementation).toContain("e.\"eventType\" = 'REOPEN'")
      expect(implementation).toContain('e."nativeRemainingAmount"')
      expect(implementation).toContain('e."frozenUzsAmount"')
    }
    expect(migration).toContain('NasiyaResolutionEvent_immutable')
    expect(migration).toContain('immutable nasiya command events cannot be updated or deleted')
  })

  it('retires new write-off commands while preserving legacy event types', () => {
    const route = source('src/app/api/nasiya/[id]/resolution/route.ts')
    const validation = source('src/lib/validations.ts')
    const access = source('src/lib/access-control.ts')

    expect(route).toContain("type ResolutionAction = 'ARCHIVE' | 'REOPEN'")
    expect(route).not.toContain("action === 'WRITE_OFF'")
    expect(validation).toContain("action: z.enum(['ARCHIVE', 'REOPEN'])")
    expect(access).toContain("'NASIYA_WRITE_OFF',\n  'INVENTORY_MANAGE'")
  })

  it('keeps resolution visible in list, export, customer profile, and trust behavior', () => {
    expect(source('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')).toContain("value: 'WRITTEN_OFF'")
    expect(source('src/app/api/export/[entity]/route.ts')).toContain("'resolutionState'")
    expect(source('src/lib/server/customer-profile.ts')).toContain('written_off_nasiya_count')
    expect(source('src/lib/nasiya-customer-trust.ts')).toContain("resolutionState !== 'ACTIVE'")
  })

  it('has a durable policy document that makes archive current and write-off legacy-only', () => {
    const policy = source('docs/nasiya-resolution-accounting-policy.md')
    expect(policy).toContain('Archive')
    expect(policy).toContain('New debt write-offs are retired')
    expect(policy).toContain('Archive and restore are not payments')
    expect(policy).toContain('Any repair of historical states')
  })
})
