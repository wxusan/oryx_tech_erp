import { describe, expect, it } from 'vitest'
import {
  archiveShopStaffRoleSchema,
  createShopStaffRoleSchema,
  normalizedRoleName,
  rolePermissionCodesWithLogs,
  updateShopStaffRoleSchema,
} from '@/lib/shop-staff-role-contract'
import {
  SHOP_STAFF_ROLE_PRESETS,
  normalizeShopStaffRoleName,
} from '@/lib/staff-role-presets'

describe('shop staff role contract', () => {
  it('ships five stable built-ins with unique exact permission sets', () => {
    expect(SHOP_STAFF_ROLE_PRESETS.map((role) => role.name)).toEqual([
      'Kassir',
      'Omborchi',
      'Nasiya undiruvchi',
      'Nazoratchi',
      'Hisobchi',
    ])
    expect(new Set(SHOP_STAFF_ROLE_PRESETS.map((role) => role.key)).size).toBe(5)
    expect(new Set(SHOP_STAFF_ROLE_PRESETS.map((role) => [...role.permissionCodes].sort().join(','))).size).toBe(5)
  })

  it('normalizes Unicode, whitespace, and Uzbek casing for tenant uniqueness', () => {
    expect(normalizeShopStaffRoleName('  SHOGIRD   YORDAMCHI  ')).toBe('shogird yordamchi')
    expect(normalizedRoleName('Ｓｈｏｇｉｒｔ')).toBe('shogirt')
  })

  it('accepts Shogirt but rejects bidi/control spoofing, duplicate grants, and generic LOG_VIEW', () => {
    expect(createShopStaffRoleSchema.parse({ name: 'Shogirt' }).name).toBe('Shogirt')
    expect(createShopStaffRoleSchema.safeParse({ name: 'Sh\u202eogirt' }).success).toBe(false)
    expect(createShopStaffRoleSchema.safeParse({ name: 'Shogirt', permissionCodes: ['SALE_VIEW', 'SALE_VIEW'] }).success).toBe(false)
    expect(createShopStaffRoleSchema.safeParse({ name: 'Shogirt', permissionCodes: ['LOG_VIEW'] }).success).toBe(false)
    expect(createShopStaffRoleSchema.safeParse({ name: 'Shogirt', logsViewEnabled: true }).success).toBe(true)
  })

  it('requires optimistic versions and audit reasons for edit/archive', () => {
    expect(updateShopStaffRoleSchema.safeParse({ version: 1, note: 'Ruxsat yangilandi', name: 'Usta' }).success).toBe(true)
    expect(updateShopStaffRoleSchema.safeParse({ version: 0, note: 'Ruxsat yangilandi', name: 'Usta' }).success).toBe(false)
    expect(updateShopStaffRoleSchema.safeParse({ version: 1, note: 'yoq', name: 'Usta' }).success).toBe(false)
    expect(archiveShopStaffRoleSchema.safeParse({ version: 2, note: 'Endi ishlatilmaydi' }).success).toBe(true)
  })

  it('stores log access through its dedicated owner toggle', () => {
    expect(rolePermissionCodesWithLogs(['SALE_VIEW'], false)).toEqual(['SALE_VIEW'])
    expect(rolePermissionCodesWithLogs(['SALE_VIEW'], true)).toEqual(['SALE_VIEW', 'LOG_VIEW'])
  })
})
