import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const matrix = [
  ['src/app/api/devices/route.ts', 'INVENTORY_VIEW', 'INVENTORY_MANAGE'],
  ['src/app/api/devices/[id]/route.ts', 'INVENTORY_VIEW', 'INVENTORY_MANAGE'],
  ['src/app/api/devices/[id]/sell/route.ts', 'CASH_SALE_CREATE'],
  ['src/app/api/devices/[id]/nasiya/route.ts', 'NASIYA_CREATE'],
  ['src/app/api/devices/[id]/return/route.ts', 'RETURN_MANAGE'],
  ['src/app/api/devices/[id]/restock/route.ts', 'RETURN_MANAGE'],
  ['src/app/api/customers/route.ts', 'CUSTOMER_VIEW'],
  ['src/app/api/customers/search/route.ts', 'CUSTOMER_VIEW'],
  ['src/app/api/customers/picker/route.ts', 'CUSTOMER_VIEW'],
  ['src/app/api/customers/[id]/route.ts', 'CUSTOMER_VIEW', 'CUSTOMER_MANAGE'],
  ['src/app/api/customers/[id]/profile/route.ts', 'CUSTOMER_VIEW'],
  ['src/app/api/customers/[id]/passport/image/route.ts', 'CUSTOMER_VIEW', 'NASIYA_VIEW'],
  ['src/app/api/customers/[id]/passport/reveal/route.ts', 'CUSTOMER_PII_REVEAL'],
  ['src/app/api/customers/by-phone/route.ts', 'CUSTOMER_VIEW'],
  ['src/app/api/nasiya/route.ts', 'NASIYA_VIEW'],
  ['src/app/api/nasiya/[id]/route.ts', 'NASIYA_VIEW', 'NASIYA_MANAGE'],
  ['src/app/api/nasiya/[id]/defer/route.ts', 'NASIYA_MANAGE'],
  ['src/app/api/nasiya/[id]/resolution/route.ts', 'WRITEOFF_MANAGE'],
  ['src/app/api/nasiya/[id]/reminder/route.ts', 'NASIYA_MANAGE'],
  ['src/app/api/nasiya/[id]/payment/route.ts', 'PAYMENT_RECEIVE'],
  ['src/app/api/nasiya/import/route.ts', 'IMPORT_DATA'],
  ['src/app/api/olib-sotdim/route.ts', 'OLIB_VIEW', 'OLIB_MANAGE'],
  ['src/app/api/olib-sotdim/[id]/pay/route.ts', 'PAYMENT_RECEIVE'],
  ['src/app/api/sales/[id]/route.ts', 'CASH_SALE_MANAGE'],
  ['src/app/api/sales/[id]/payment/route.ts', 'PAYMENT_RECEIVE'],
  ['src/app/api/uploads/device/route.ts', 'INVENTORY_MANAGE', 'OLIB_MANAGE', 'INVENTORY_VIEW'],
  ['src/app/api/uploads/passport/route.ts', 'NASIYA_CREATE', 'CUSTOMER_MANAGE', 'IMPORT_DATA', 'NASIYA_VIEW'],
  ['src/app/api/import/customers/route.ts', 'IMPORT_DATA'],
  ['src/app/api/export/[entity]/route.ts', 'EXPORT_DATA'],
  ['src/app/api/logs/route.ts', 'LOG_VIEW'],
  ['src/app/api/logs/[id]/link/route.ts', 'LOG_VIEW'],
  ['src/app/api/stats/shop/route.ts', 'REPORT_VIEW'],
  ['src/app/api/reports/shop/route.ts', 'REPORT_VIEW'],
  ['src/app/api/shop/profile/route.ts', 'SETTINGS_MANAGE'],
  ['src/app/api/shop/staff/route.ts', 'MEMBER_MANAGE'],
  ['src/app/api/shop/staff/[id]/route.ts', 'MEMBER_MANAGE'],
] as const

const explicitFeatureMatrix = [
  ['src/app/api/sales/[id]/payment/route.ts', 'PAYMENT_RECEIVE', 'CASH_SALES'],
  ['src/app/api/nasiya/[id]/payment/route.ts', 'PAYMENT_RECEIVE', 'NASIYA'],
  ['src/app/api/nasiya/[id]/defer/route.ts', 'NASIYA_MANAGE', 'NASIYA'],
  ['src/app/api/nasiya/[id]/resolution/route.ts', 'WRITEOFF_MANAGE', 'NASIYA'],
  ['src/app/api/nasiya/import/route.ts', 'IMPORT_DATA', 'NASIYA'],
  ['src/app/api/import/customers/route.ts', 'IMPORT_DATA', 'CUSTOMER_CRM'],
  ['src/app/api/olib-sotdim/[id]/pay/route.ts', 'PAYMENT_RECEIVE', 'OLIB_SOTDIM'],
  ['src/app/api/reports/shop/route.ts', 'REPORT_VIEW', 'REPORTS'],
] as const

const uiMatrix = [
  ['src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx', 'INVENTORY_MANAGE', 'EXPORT_DATA'],
  ['src/app/(shop)/shop/qurilmalar/[id]/page.tsx', 'INVENTORY_VIEW', 'INVENTORY_MANAGE', 'CASH_SALE_CREATE', 'CASH_SALE_MANAGE', 'NASIYA_CREATE', 'PAYMENT_RECEIVE', 'RETURN_MANAGE'],
  ['src/app/(shop)/shop/qurilmalar/new/page.tsx', 'INVENTORY_MANAGE'],
  ['src/app/(shop)/shop/sotuv/new/page.tsx', 'CASH_SALE_CREATE'],
  ['src/app/(shop)/shop/mijozlar/customers-client.tsx', 'CUSTOMER_MANAGE', 'EXPORT_DATA'],
  ['src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx', 'NASIYA_CREATE', 'IMPORT_DATA', 'EXPORT_DATA', 'PAYMENT_RECEIVE'],
  ['src/app/(shop)/shop/nasiyalar/[id]/page.tsx', 'NASIYA_VIEW', 'NASIYA_MANAGE', 'PAYMENT_RECEIVE'],
  ['src/app/(shop)/shop/nasiyalar/new/page.tsx', 'NASIYA_CREATE'],
  ['src/app/(shop)/shop/nasiyalar/import/page.tsx', 'IMPORT_DATA'],
  ['src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx', 'OLIB_MANAGE', 'PAYMENT_RECEIVE'],
  ['src/app/(shop)/shop/olib-sotdim/new/page.tsx', 'OLIB_MANAGE'],
] as const

describe('shop real-route RBAC matrix guard', () => {
  for (const [file, ...permissions] of matrix) {
    it(`${file} declares every required live permission guard`, () => {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain('requireApiSession()')
      for (const permission of permissions) {
        const directGuard = new RegExp(
          `require(?:ShopPermission(?:AndFeature|AndAnyFeature)?|CurrentShopPermission)\\(['"]${permission}['"]`,
        )
        const anyPermissionGuard = new RegExp(
          `requireShopAnyPermission\\(\\[[\\s\\S]*?['\"]${permission}['\"][\\s\\S]*?\\]\\)`,
        )
        expect(
          directGuard.test(source) || anyPermissionGuard.test(source),
          `${file} must authorize ${permission} through a live permission guard`,
        ).toBe(true)
      }
    })
  }

  for (const [file, ...permissions] of uiMatrix) {
    it(`${file} mirrors server permissions in visible controls`, () => {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('useShopAccess')
      for (const permission of permissions) expect(source).toContain(`'${permission}'`)
    })
  }

  for (const [file, permission, feature] of explicitFeatureMatrix) {
    it(`${file} binds ${permission} to the ${feature} shop entitlement`, () => {
      const source = readFileSync(file, 'utf8')
      expect(source).toMatch(new RegExp(
        `requireShopPermissionAndFeature\\(\\s*['"]${permission}['"]\\s*,\\s*['"]${feature}['"]\\s*\\)`,
      ))
    })
  }

  it('binds every export entity to its own module as well as the export entitlement', () => {
    const source = readFileSync('src/app/api/export/[entity]/route.ts', 'utf8')
    for (const [entity, feature] of [
      ['devices', 'INVENTORY'],
      ['customers', 'CUSTOMER_CRM'],
      ['sales', 'CASH_SALES'],
      ['nasiya', 'NASIYA'],
      ['returns', 'INVENTORY'],
      ['report', 'REPORTS'],
    ] as const) {
      expect(source).toContain(`${entity}: '${feature}'`)
    }
    expect(source).toContain("requireShopPermissionAndFeature('EXPORT_DATA', feature)")
    expect(source).toContain("requireShopPermissionAndFeature('REPORT_VIEW', 'REPORTS')")
  })
})
