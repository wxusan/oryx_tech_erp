import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('shop staff roles source boundaries', () => {
  it('uses an additive transactional migration with exact-match backfill and tenant FKs', () => {
    const migration = read('prisma/migrations/202607220001_custom_shop_staff_roles/migration.sql')
    expect(migration).toMatch(/^BEGIN;/)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)
    expect(migration).toContain('CREATE TABLE "ShopStaffRole"')
    expect(migration).toContain('CREATE TABLE "ShopStaffRolePermission"')
    expect(migration).toContain('"ShopAdmin_staffRoleId_shopId_fkey"')
    expect(migration).toContain('role_sets."permissionCodes" = member_sets."permissionCodes"')
    expect(migration).toContain('member."id" <> shop."ownerAdminId"')
    expect(migration).not.toMatch(/\bTRUNCATE\b/i)
    for (const table of ['Device', 'Sale', 'Nasiya', 'Customer', 'ShopPayment']) {
      expect(migration).not.toMatch(new RegExp(`(?:DELETE FROM|UPDATE) "${table}"`, 'i'))
    }
  })

  it('keeps role reads bounded and avoids exact member counts', () => {
    const roles = read('src/lib/server/shop-staff-roles.ts')
    expect(roles).toContain('take: MAX_SHOP_STAFF_ROLES + 1')
    expect(roles).not.toContain('_count')
    expect(roles).not.toContain('count(')
  })

  it('seeds staff and roles in parallel without a hydration waterfall', () => {
    const page = read('src/app/(shop)/shop/xodimlar/page.tsx')
    const client = read('src/components/shop/staff-management.tsx')
    expect(page).toContain('const [initialStaff, initialRoles] = await Promise.all([')
    expect(client).toContain('initialData: initialRoles')
    expect(client).toContain("queryKey: [...queryKeys.domain(scope, 'access'), 'staff-roles']")
    expect(client).toContain('<QueryActivity')
  })

  it('revalidates live owner authority and propagates permission changes set-wise', () => {
    const update = read('src/app/api/shop/staff/roles/[roleId]/route.ts')
    expect(update).toContain('getLiveShopPrincipalForMutation')
    expect(update).toContain("livePrincipal.memberKind !== 'SHOP_OWNER'")
    expect(update).toContain('"permissionVersion" = "permissionVersion" + 1')
    expect(update).toContain('"sessionVersion" = "sessionVersion" + 1')
    expect(update).toContain('UPDATE "AuthSession" session')
    expect(update).toContain('"roleVersionApplied" = ${nextVersion}')
    expect(update).toContain("existing.kind === SHOP_STAFF_ROLE_KIND.BUILT_IN")
  })

  it('does not join role metadata into the live authorization hot path', () => {
    const auth = read('src/lib/api-auth.ts')
    const access = read('src/lib/server/shop-access.ts')
    expect(auth).not.toContain('ShopStaffRole')
    expect(auth).not.toContain('staffRole:')
    expect(access).not.toContain('ShopStaffRole')
    expect(access).not.toContain('staffRole:')
  })
})
