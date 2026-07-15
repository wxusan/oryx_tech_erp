import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SHOP_PERMISSION_CODES,
  LEGACY_PERMISSION_EXPANSIONS,
  RETIRED_SHOP_PERMISSION_CODES,
} from '@/lib/access-control'

const migrationPath = 'prisma/migrations/202607150001_staff_permissions_v2/migration.sql'
const migration = readFileSync(resolve(process.cwd(), migrationPath), 'utf8')

function catalogInsertCodes() {
  const values = migration.match(/INSERT INTO "PermissionDefinition"[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/)?.[1] ?? ''
  return [...values.matchAll(/\('([A-Z_]+)'/g)].map((match) => match[1])
}

function allMigrationCatalogCodes() {
  const root = resolve(process.cwd(), 'prisma/migrations')
  const sql = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(resolve(root, entry.name, 'migration.sql'), 'utf8'))
    .join('\n')
  const codes = [...sql.matchAll(/INSERT INTO "PermissionDefinition"[\s\S]*?VALUES([\s\S]*?)(?:ON CONFLICT|;)/g)]
    .flatMap((block) => [...block[1].matchAll(/\('([A-Z_]+)'/g)].map((match) => match[1]))
  return new Set(codes)
}

describe('Staff Permissions V2 migration source guard', () => {
  it('keeps every historical SQL catalog permission classified as active or retired', () => {
    const definedAcrossMigrations = allMigrationCatalogCodes()
    for (const code of ACTIVE_SHOP_PERMISSION_CODES) expect(definedAcrossMigrations).toContain(code)
    const classifiedCodes = [...ACTIVE_SHOP_PERMISSION_CODES, ...RETIRED_SHOP_PERMISSION_CODES]
    for (const code of catalogInsertCodes()) expect(classifiedCodes).toContain(code)
  })

  it('contains every documented legacy mapping and no retired target', () => {
    for (const oldCode of RETIRED_SHOP_PERMISSION_CODES) {
      for (const newCode of LEGACY_PERMISSION_EXPANSIONS[oldCode]) {
        expect(migration).toContain(`('${oldCode}', '${newCode}')`)
        expect(RETIRED_SHOP_PERMISSION_CODES).not.toContain(newCode)
      }
    }
  })

  it('is additive, transactional, replay-safe, and does not mutate business rows', () => {
    expect(migration).toMatch(/\nBEGIN;/)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)
    expect(migration).toContain('CREATE TEMP TABLE "_StaffPermissionsV2Materialized"')
    expect(migration).toContain('ON COMMIT DROP')
    expect(migration).toContain('ON CONFLICT ("shopAdminId", "permissionCode") DO NOTHING')
    expect(migration).toContain('FROM "_StaffPermissionsV2Materialized" materialized')
    expect(migration).not.toMatch(/\bTRUNCATE\b/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i)
    for (const table of ['Device', 'Sale', 'SalePayment', 'Nasiya', 'NasiyaPayment', 'Customer', 'ShopPayment']) {
      expect(migration).not.toMatch(new RegExp(`UPDATE\\s+"${table}"`, 'i'))
    }
  })

  it('does not cross disabled package domains for import or mapped grants', () => {
    expect(migration).toContain('feature_line."featureCode" = target."featureCode"')
    expect(migration).toContain("mapping.\"newCode\" <> 'IMPORT_CUSTOMERS' OR customer_feature.\"enabled\" = TRUE")
    expect(migration).toContain("mapping.\"newCode\" <> 'IMPORT_OLD_NASIYA' OR nasiya_feature.\"enabled\" = TRUE")
  })

  it('revokes affected sessions and advances authorization versions only for materialized members', () => {
    expect(migration).toContain('UPDATE "AuthSession" session')
    expect(migration).toContain('session."revokedAt" IS NULL')
    expect(migration).toContain('"permissionVersion" = member."permissionVersion" + 1')
    expect(migration).toContain('SET "authorizationVersion" = "authorizationVersion" + 1')
    expect(migration).toContain('UPDATE "ShopAdmin" member')
    expect(migration).toContain('THEN FALSE')
  })
})

describe('Staff Permissions V2 live-boundary source guard', () => {
  it('keeps Telegram eligibility separate and off by default', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const contract = readFileSync(resolve(process.cwd(), 'src/lib/shop-staff-contract.ts'), 'utf8')
    const staffUi = readFileSync(resolve(process.cwd(), 'src/components/shop/staff-management.tsx'), 'utf8')
    const shopAdminModel = schema.slice(schema.indexOf('model ShopAdmin {'), schema.indexOf('model ShopMemberPermission {'))
    expect(shopAdminModel).toMatch(/telegramNotificationsEnabled\s+Boolean\s+@default\(false\)/)
    expect(contract).toContain('telegramNotificationsEnabled: z.boolean().default(false)')
    expect(staffUi).toContain('Telegram xabarlari')
    expect(staffUi).toContain('telegramNotificationsEnabled: false')
  })

  it('rebuilds live authorization inside every serializable staff mutation', () => {
    const createRoute = readFileSync(resolve(process.cwd(), 'src/app/api/shop/staff/route.ts'), 'utf8')
    const updateRoute = readFileSync(resolve(process.cwd(), 'src/app/api/shop/staff/[id]/route.ts'), 'utf8')
    const access = readFileSync(resolve(process.cwd(), 'src/lib/server/shop-access.ts'), 'utf8')
    expect(access).toContain('export async function getLiveShopPrincipalForMutation(')
    expect(access).toContain("subscriptionDue: { gte: subscriptionCutoff }")
    expect(createRoute).toContain("principalHasPermission(livePrincipal, 'STAFF_CREATE')")
    expect(updateRoute).toContain('for (const [included, permission] of requiredPermissions)')
    expect(updateRoute).toContain("principalHasPermission(livePrincipal, 'STAFF_DELETE')")
    expect(updateRoute).toContain("throw Object.assign(new Error('AUTHORIZATION_CHANGED')")
  })

  it('keeps presets as package-filtered form helpers and never runtime roles', () => {
    const staffUi = readFileSync(resolve(process.cwd(), 'src/components/shop/staff-management.tsx'), 'utf8')
    expect(staffUi).toContain('const staffPermissionPresets:')
    for (const label of ['Kassir', 'Omborchi', 'Nasiya undiruvchi', 'Nazoratchi', 'Hisobchi']) {
      expect(staffUi).toContain(`label: '${label}'`)
    }
    expect(staffUi).toContain('permissionRequiredFeatures(permission.code).every')
    expect(staffUi).toContain('window.confirm(`${sensitiveAdditions.length} ta muhim ruxsatni yoqishni tasdiqlaysizmi?`)')
    const accessControl = readFileSync(resolve(process.cwd(), 'src/lib/access-control.ts'), 'utf8')
    expect(accessControl).not.toContain('staffPermissionPresets')
  })

  it('prevents the signed-in owner credentials from autofilling the new-staff form', () => {
    const staffUi = readFileSync(resolve(process.cwd(), 'src/components/shop/staff-management.tsx'), 'utf8')
    expect(staffUi).toContain('autoComplete="off" noValidate')
    expect(staffUi).toContain('<Input autoComplete="off" disabled={Boolean(editing) && !isOwner}')
    expect(staffUi).toContain('<Input autoComplete="new-password"')
  })

  it('uses capability-scoped staff roster projections', () => {
    const projection = readFileSync(resolve(process.cwd(), 'src/lib/server/shop-staff-projection.ts'), 'utf8')
    const listRoute = readFileSync(resolve(process.cwd(), 'src/app/api/shop/staff/route.ts'), 'utf8')
    expect(listRoute).toContain('if (!principalNeedsStaffTargets(principal)) return ok([])')
    expect(projection).toContain("principalHasPermission(principal, 'STAFF_EDIT_PROFILE')")
    expect(projection).toContain("principalHasPermission(principal, 'STAFF_PERMISSION_MANAGE')")
    expect(projection).toContain('permissionCodes: revealPermissions')
    expect(projection).toContain('telegramNotificationsEnabled: revealNotifications')
    expect(projection).toContain('permissionRequiredFeatures(code).every')
  })

  it('does not resubmit package-disabled Telegram eligibility during unrelated staff edits', () => {
    const staffUi = readFileSync(resolve(process.cwd(), 'src/components/shop/staff-management.tsx'), 'utf8')
    expect(staffUi).toContain("canManageNotifications && enabledFeatures.has('TELEGRAM')")
    expect(staffUi).toContain("disabled={!enabledFeatures.has('TELEGRAM')}")
    expect(staffUi).toContain("member.telegramNotificationsEnabled && enabledFeatures.has('TELEGRAM')")
  })

  it('limits staff login changes to the shop owner and revokes the affected session', () => {
    const contract = readFileSync(resolve(process.cwd(), 'src/lib/shop-staff-contract.ts'), 'utf8')
    const staffUi = readFileSync(resolve(process.cwd(), 'src/components/shop/staff-management.tsx'), 'utf8')
    const updateRoute = readFileSync(resolve(process.cwd(), 'src/app/api/shop/staff/[id]/route.ts'), 'utf8')
    expect(contract).toContain('login: loginSchema.optional()')
    expect(staffUi).toContain('disabled={Boolean(editing) && !isOwner}')
    expect(staffUi).toContain('if (loginChanged) Object.assign(updateBody, { login: form.login.trim() })')
    expect(updateRoute).toContain("parsed.data.login !== undefined && principal.memberKind !== 'SHOP_OWNER'")
    expect(updateRoute).toContain("parsed.data.login !== undefined && livePrincipal.memberKind !== 'SHOP_OWNER'")
    expect(updateRoute).toContain("where: { login: parsed.data.login }")
    expect(updateRoute).toContain('passwordHash !== undefined || loginChanged || permissionSnapshotChanged')
    expect(updateRoute).toContain('login: target.login')
    expect(updateRoute).toContain('login: parsed.data.login')
  })

  it('keeps sale return and nasiya cancellation independently authorized', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/devices/[id]/return/route.ts'), 'utf8')
    expect(route).toContain("requireShopAnyPermission(['SALE_RETURN_REFUND', 'NASIYA_CANCEL'])")
    expect(route).toContain("const requiredPermission = sale ? 'SALE_RETURN_REFUND' : 'NASIYA_CANCEL'")
    expect(route).toContain('principalHasPermission(guarded.principal, requiredPermission)')
  })

  it('filters sync and navigation from exact active capabilities without retired aliases', () => {
    const sync = readFileSync(resolve(process.cwd(), 'src/app/api/sync/route.ts'), 'utf8')
    const navigation = readFileSync(resolve(process.cwd(), 'src/app/(shop)/shop-layout-client.tsx'), 'utf8')
    for (const retired of RETIRED_SHOP_PERMISSION_CODES) {
      expect(sync).not.toMatch(new RegExp(`['"]${retired}['"]`))
      expect(navigation).not.toMatch(new RegExp(`['"]${retired}['"]`))
    }
    expect(sync).toContain("allow(['SALE_PAYMENT_RECEIVE', 'NASIYA_PAYMENT_RECEIVE', 'SUPPLIER_PAYMENT_MARK_PAID'], ['payments'])")
    expect(sync).toContain("allow(['LOG_VIEW'], ['logs'])")
  })
})
