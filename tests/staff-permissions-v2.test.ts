import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SHOP_PERMISSION_CODES,
  LEGACY_PERMISSION_EXPANSIONS,
  RETIRED_SHOP_PERMISSION_CODES,
  SHOP_FEATURE_CODES,
  SHOP_PERMISSION_CATALOG,
  expandShopPermissionCodes,
  permissionDefinition,
  permissionRequiredFeatures,
  principalCan,
  type ActiveShopPermissionCode,
  type ShopPrincipalAccess,
} from '@/lib/access-control'
import {
  createShopStaffSchema,
  legacyStaffPermissionCodes,
  NASIYA_ARCHIVE_PERMISSION_BUNDLE,
  STAFF_LOGS_PERMISSION,
  updateShopStaffSchema,
  withNasiyaArchivePermissionBundle,
} from '@/lib/shop-staff-contract'
import {
  projectShopStaff,
  type ShopStaffProjectionRow,
} from '@/lib/server/shop-staff-projection'
import type { ShopPrincipal } from '@/lib/server/shop-access'

const allFeatures = new Set(SHOP_FEATURE_CODES)

function staffWithOnly(permission: ActiveShopPermissionCode): ShopPrincipalAccess {
  return {
    memberKind: 'SHOP_STAFF',
    legacyFullAccess: false,
    enabledFeatures: allFeatures,
    grantedPermissions: new Set([permission]),
  }
}

describe('Staff Permissions V2 behavioral authorization kernel', () => {
  it('has exactly 58 unique active capabilities with complete operational metadata', () => {
    expect(ACTIVE_SHOP_PERMISSION_CODES).toHaveLength(58)
    expect(new Set(ACTIVE_SHOP_PERMISSION_CODES).size).toBe(58)

    for (const code of ACTIVE_SHOP_PERMISSION_CODES) {
      const definition = permissionDefinition(code)
      expect(definition.code).toBe(code)
      expect(definition.retired, code).toBe(false)
      expect(definition.ownerOnly, code).toBe(false)
      expect(definition.label.trim(), code).not.toBe('')
      expect(definition.description.trim(), code).not.toBe('')
      expect(definition.group, code).toBeTruthy()
      expect(definition.risk, code).toBeTruthy()
    }
  })

  it.each(ACTIVE_SHOP_PERMISSION_CODES)('%s grants itself and no unrelated capability', (code) => {
    const principal = staffWithOnly(code)
    expect(principalCan(principal, code)).toBe(true)

    for (const unrelated of ACTIVE_SHOP_PERMISSION_CODES) {
      if (unrelated === code) continue
      expect(principalCan(principal, unrelated), `${code} must not imply ${unrelated}`).toBe(false)
    }
    for (const retired of RETIRED_SHOP_PERMISSION_CODES) {
      expect(principalCan(principal, retired), `${code} must not revive ${retired}`).toBe(false)
    }
  })

  it('intersects every capability with all of its required package features', () => {
    for (const code of ACTIVE_SHOP_PERMISSION_CODES) {
      for (const requiredFeature of permissionRequiredFeatures(code)) {
        const principal = staffWithOnly(code)
        principal.enabledFeatures = new Set(
          SHOP_FEATURE_CODES.filter((feature) => feature !== requiredFeature),
        )
        expect(principalCan(principal, code), `${code} without ${requiredFeature}`).toBe(false)
      }
    }
    expect(permissionRequiredFeatures('IMPORT_CUSTOMERS')).toEqual(['IMPORTS', 'CUSTOMER_CRM'])
    expect(permissionRequiredFeatures('IMPORT_OLD_NASIYA')).toEqual(['IMPORTS', 'NASIYA'])
  })

  it('defaults new staff to no capabilities, no logs, and no Telegram delivery', () => {
    const parsed = createShopStaffSchema.parse({
      name: 'Yangi xodim',
      phone: '+998901234567',
      login: 'new_staff',
      password: 'safe-password',
    })
    expect(parsed.permissionCodes).toEqual([])
    expect(parsed.logsViewEnabled).toBe(false)
    expect(parsed.telegramNotificationsEnabled).toBe(false)
    expect(parsed.isActive).toBe(true)
    expect(createShopStaffSchema.parse({
      name: 'Nofaol xodim',
      phone: '+998901234568',
      login: 'inactive_staff',
      password: 'safe-password',
      isActive: false,
    }).isActive).toBe(false)
  })

  it('accepts only active generic grants and keeps LOG_VIEW in its dedicated toggle', () => {
    const base = {
      name: 'Yangi xodim',
      phone: '+998901234567',
      login: 'new_staff',
      password: 'safe-password',
    }
    expect(createShopStaffSchema.safeParse({ ...base, permissionCodes: ['SALE_CREATE'] }).success).toBe(true)
    expect(createShopStaffSchema.safeParse({ ...base, permissionCodes: ['CASH_SALE_CREATE'] }).success).toBe(false)
    expect(createShopStaffSchema.safeParse({ ...base, permissionCodes: [STAFF_LOGS_PERMISSION] }).success).toBe(false)
    expect(createShopStaffSchema.safeParse({ ...base, logsViewEnabled: true }).success).toBe(true)
  })

  it('bundles archive and restore into the one staff-facing archive checkbox capability', () => {
    expect(withNasiyaArchivePermissionBundle(['NASIYA_ARCHIVE'])).toEqual(NASIYA_ARCHIVE_PERMISSION_BUNDLE)
    expect(withNasiyaArchivePermissionBundle(['NASIYA_REOPEN'])).toEqual(NASIYA_ARCHIVE_PERMISSION_BUNDLE)
    expect(withNasiyaArchivePermissionBundle(['SALE_CREATE'])).toEqual(['SALE_CREATE'])
  })

  it('gives the shop owner archive and restore access by default', () => {
    const owner: ShopPrincipalAccess = {
      memberKind: 'SHOP_OWNER',
      legacyFullAccess: false,
      enabledFeatures: allFeatures,
      grantedPermissions: new Set(),
    }
    expect(principalCan(owner, 'NASIYA_ARCHIVE')).toBe(true)
    expect(principalCan(owner, 'NASIYA_REOPEN')).toBe(true)
  })

  it('validates a staff login change through the same contract as staff creation', () => {
    const base = { staffId: 'staff-1', note: 'Login typo tuzatildi' }
    expect(updateShopStaffSchema.parse({ ...base, login: 'dilshod_kassir' }).login).toBe('dilshod_kassir')
    expect(updateShopStaffSchema.safeParse({ ...base, login: 'not allowed' }).success).toBe(false)
  })

  it('expands every retired alias only to its documented exact V2 targets', () => {
    for (const retired of RETIRED_SHOP_PERMISSION_CODES) {
      const expanded = expandShopPermissionCodes([retired])
      const expected = [retired, ...LEGACY_PERMISSION_EXPANSIONS[retired]]
      if (expected.includes('SUPPLIER_PAYMENT_RECORD') || expected.includes('SUPPLIER_PAYMENT_MARK_PAID')) {
        expected.push('SUPPLIER_PAYABLE_VIEW')
      }
      expect([...expanded]).toEqual([...new Set(expected)])
      for (const replacement of LEGACY_PERMISSION_EXPANSIONS[retired]) {
        expect(ACTIVE_SHOP_PERMISSION_CODES).toContain(replacement)
      }
    }
  })

  it('materializes legacy full access conservatively and package-bounded', () => {
    const expected = SHOP_PERMISSION_CATALOG
      .filter((item) => !item.retired && item.legacyOperational)
      .map((item) => item.code)
    expect(legacyStaffPermissionCodes(allFeatures)).toEqual(expected)
    expect(expected).toContain('LOG_VIEW')
    expect(expected).not.toContain('SALE_RETURN_REFUND')
    expect(expected).not.toContain('DASHBOARD_FINANCIAL_VIEW')
    expect(expected).not.toContain('REPORT_VIEW')
    expect(expected).not.toContain('STAFF_PERMISSION_MANAGE')

    const withoutNasiya = legacyStaffPermissionCodes(new Set(
      SHOP_FEATURE_CODES.filter((feature) => feature !== 'NASIYA'),
    ))
    expect(withoutNasiya.some((code) => code.startsWith('NASIYA_'))).toBe(false)
  })

  it('projects only grants that are currently available in the shop package', () => {
    const principal: ShopPrincipal = {
      actorId: 'owner-1',
      shopId: 'shop-1',
      memberKind: 'SHOP_OWNER',
      legacyFullAccess: false,
      authorizationVersion: 1,
      permissionVersion: 1,
      enabledFeatures: new Set(
        SHOP_FEATURE_CODES.filter((feature) => feature !== 'INVENTORY'),
      ),
      grantedPermissions: new Set(),
      packageVersionId: 'package-1',
    }
    const row: ShopStaffProjectionRow = {
      id: 'staff-1',
      name: 'Package-scoped staff',
      phone: '+998901234567',
      login: 'package_staff',
      isActive: true,
      telegramId: null,
      telegramVerifiedAt: null,
      telegramNotificationsEnabled: false,
      legacyFullAccess: false,
      permissionVersion: 1,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      permissions: [
        { permissionCode: 'DEVICE_CREATE' },
        { permissionCode: 'SHOP_PROFILE_EDIT' },
      ],
    }

    expect(projectShopStaff(row, principal).permissionCodes).toEqual(['SHOP_PROFILE_EDIT'])
  })
})
