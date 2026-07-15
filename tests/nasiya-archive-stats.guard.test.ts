import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Nasiya archive: permission and accounting boundaries', () => {
  it('keeps the staff archive grant as an owner-only checkbox-backed capability', () => {
    const access = read('src/lib/access-control.ts')
    const staffUi = read('src/components/shop/staff-management.tsx')
    const resolutionRoute = read('src/app/api/nasiya/[id]/resolution/route.ts')

    expect(access).toContain("code: 'NASIYA_ARCHIVE'")
    expect(access).toContain("label: 'Nasiyani arxivlash mumkin'")
    expect(access).toContain("staffManagerDelegable: false")
    expect(staffUi).toContain('type="checkbox"')
    expect(staffUi).toContain('staff-permission-${permission.code.toLowerCase()}')
    expect(staffUi).toContain("item.code !== 'NASIYA_REOPEN'")
    expect(staffUi).toContain('withNasiyaArchivePermissionBundle([...current.permissionCodes, \'NASIYA_ARCHIVE\'])')
    expect(resolutionRoute).toContain("requireShopAnyPermission(['NASIYA_ARCHIVE', 'NASIYA_WRITE_OFF', 'NASIYA_REOPEN'])")
    expect(resolutionRoute).toContain('principalHasPermission(guarded.principal, requiredPermission)')
  })

  it('backfills restore for existing archive grants and revokes affected staff sessions', () => {
    const migration = read('prisma/migrations/202607150002_nasiya_archive_permission_bundle/migration.sql')
    expect(migration).toContain("archive_permission.\"permissionCode\" = 'NASIYA_ARCHIVE'")
    expect(migration).toContain("'NASIYA_REOPEN'")
    expect(migration).toContain('UPDATE "AuthSession" session')
    expect(migration).toContain('"permissionVersion" = member."permissionVersion" + 1')
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)
  })

  it('removes archived unpaid amounts from reports and operational stats but leaves payment cash independent', () => {
    const dashboard = read('src/lib/server/shop-stats-queries.ts')
    const dashboardWriter = read('src/lib/server/shop-stats.ts')
    const rangeReport = read('src/lib/server/shop-report-range.ts')
    const customerProfile = read('src/lib/server/customer-profile.ts')

    expect(dashboard).toContain('AND n."resolutionState" = \'ACTIVE\'')
    expect(rangeReport).toContain('AND n."resolutionState" = \'ACTIVE\'')
    expect(customerProfile).toContain('WHEN "resolutionState" = \'ARCHIVED\' THEN "contractDownPayment" + "contractPaidAmount"')
    expect(customerProfile).toContain('"resolutionState" <> \'ARCHIVED\'')

    const paymentAggregateStart = dashboardWriter.indexOf('prisma.nasiyaPayment.aggregate({')
    const paymentAggregateEnd = dashboardWriter.indexOf('\n\n    prisma.nasiya.count({', paymentAggregateStart)
    const nasiyaPaymentAggregate = dashboardWriter.slice(paymentAggregateStart, paymentAggregateEnd)
    expect(nasiyaPaymentAggregate).toContain('paidAt: { gte: monthStart, lt: monthEnd }')
    expect(nasiyaPaymentAggregate).not.toContain('resolutionState')
  })

  it('documents that paid cash is preserved while unpaid archived value is excluded', () => {
    const policy = read('docs/nasiya-resolution-accounting-policy.md')
    expect(policy).toContain('Previously paid margin/interest remains in its original payment month')
    expect(policy).toContain('Cash and paid profit remain in their payment periods')
  })
})
