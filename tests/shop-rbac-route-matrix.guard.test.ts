import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RETIRED_SHOP_PERMISSION_CODES } from '@/lib/access-control'

const routeMatrix = [
  ['src/app/api/devices/route.ts', 'INVENTORY_VIEW', 'DEVICE_CREATE', 'DEVICE_PURCHASE_ON_CREDIT', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK', 'SALE_VIEW', 'SALE_CREATE', 'SALE_EDIT', 'SALE_REMINDER_MANAGE', 'SALE_RETURN_REFUND', 'NASIYA_CREATE'],
  ['src/app/api/devices/[id]/route.ts', 'INVENTORY_VIEW', 'DEVICE_CREATE', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK', 'SALE_VIEW', 'SALE_CREATE', 'SALE_EDIT', 'SALE_PAYMENT_RECEIVE', 'SALE_REMINDER_MANAGE', 'SALE_RETURN_REFUND', 'NASIYA_CREATE', 'SUPPLIER_PAYABLE_VIEW'],
  ['src/app/api/devices/[id]/sell/route.ts', 'SALE_CREATE'],
  ['src/app/api/devices/[id]/nasiya/route.ts', 'NASIYA_CREATE'],
  ['src/app/api/devices/[id]/return/route.ts', 'SALE_RETURN_REFUND'],
  ['src/app/api/devices/[id]/restock/route.ts', 'DEVICE_RESTOCK'],
  ['src/app/api/customers/route.ts', 'CUSTOMER_VIEW', 'CUSTOMER_CREATE'],
  ['src/app/api/customers/search/route.ts', 'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_EDIT', 'CUSTOMER_PASSPORT_PHOTO_VIEW', 'CUSTOMER_PASSPORT_REVEAL', 'CUSTOMER_PASSPORT_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'],
  ['src/app/api/customers/[id]/route.ts', 'CUSTOMER_VIEW', 'CUSTOMER_EDIT', 'CUSTOMER_PASSPORT_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'],
  ['src/app/api/customers/[id]/passport/image/route.ts', 'CUSTOMER_PASSPORT_PHOTO_VIEW'],
  ['src/app/api/customers/[id]/passport/reveal/route.ts', 'CUSTOMER_PASSPORT_REVEAL'],
  ['src/app/api/nasiya/route.ts', 'NASIYA_VIEW', 'NASIYA_EDIT', 'NASIYA_REMINDER_MANAGE', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'],
  ['src/app/api/nasiya/[id]/route.ts', 'NASIYA_VIEW', 'NASIYA_CREATE', 'NASIYA_EDIT', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER', 'NASIYA_REMINDER_MANAGE', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'],
  ['src/app/api/nasiya/[id]/payment/route.ts', 'NASIYA_PAYMENT_RECEIVE'],
  ['src/app/api/nasiya/[id]/defer/route.ts', 'NASIYA_DEFER'],
  ['src/app/api/nasiya/[id]/reminder/route.ts', 'NASIYA_REMINDER_MANAGE'],
  ['src/app/api/nasiya/[id]/resolution/route.ts', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'],
  ['src/app/api/nasiya/import/route.ts', 'IMPORT_OLD_NASIYA'],
  ['src/app/api/olib-sotdim/route.ts', 'OLIB_VIEW', 'OLIB_CREATE', 'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'],
  ['src/app/api/olib-sotdim/[id]/pay/route.ts', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'],
  ['src/app/api/supplier-payables/[id]/payments/route.ts', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'],
  ['src/app/api/debts/query/route.ts', 'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID', 'RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE'],
  ['src/app/api/sales/[id]/route.ts', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'],
  ['src/app/api/sales/[id]/payment/route.ts', 'SALE_PAYMENT_RECEIVE'],
  ['src/app/api/uploads/device/route.ts', 'DEVICE_CREATE', 'DEVICE_EDIT', 'OLIB_CREATE'],
  ['src/app/api/uploads/passport/route.ts', 'NASIYA_CREATE', 'CUSTOMER_PASSPORT_MANAGE', 'IMPORT_OLD_NASIYA', 'NASIYA_VIEW'],
  ['src/app/api/import/customers/route.ts', 'IMPORT_CUSTOMERS'],
  ['src/app/api/logs/route.ts', 'LOG_VIEW'],
  ['src/app/api/logs/[id]/link/route.ts', 'LOG_VIEW'],
  ['src/app/api/stats/shop/route.ts', 'DASHBOARD_OPERATIONAL_VIEW', 'DASHBOARD_FINANCIAL_VIEW', 'REPORT_VIEW'],
  ['src/app/api/reports/shop/route.ts', 'REPORT_VIEW'],
  ['src/app/api/shop/profile/route.ts', 'SHOP_PROFILE_EDIT', 'SHOP_CURRENCY_MANAGE', 'SHOP_TELEGRAM_MANAGE'],
  ['src/app/api/shop/staff/route.ts', 'STAFF_VIEW', 'STAFF_CREATE', 'STAFF_EDIT_PROFILE', 'STAFF_RESET_PASSWORD', 'STAFF_STATUS_MANAGE', 'STAFF_DELETE', 'STAFF_PERMISSION_MANAGE', 'STAFF_NOTIFICATION_MANAGE'],
  ['src/app/api/shop/staff/[id]/route.ts', 'STAFF_EDIT_PROFILE', 'STAFF_RESET_PASSWORD', 'STAFF_STATUS_MANAGE', 'STAFF_DELETE', 'STAFF_PERMISSION_MANAGE', 'STAFF_NOTIFICATION_MANAGE'],
  ['src/app/api/shop/staff/roles/route.ts', 'STAFF_VIEW', 'STAFF_CREATE', 'STAFF_EDIT_PROFILE', 'STAFF_PERMISSION_MANAGE'],
  ['src/app/api/shop/staff/roles/[roleId]/route.ts', 'STAFF_PERMISSION_MANAGE'],
] as const

const featureMatrix = [
  ['src/app/api/sales/[id]/payment/route.ts', 'SALE_PAYMENT_RECEIVE', 'CASH_SALES'],
  ['src/app/api/nasiya/[id]/payment/route.ts', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA'],
  ['src/app/api/nasiya/[id]/defer/route.ts', 'NASIYA_DEFER', 'NASIYA'],
  ['src/app/api/nasiya/import/route.ts', 'IMPORT_OLD_NASIYA', 'NASIYA'],
  ['src/app/api/import/customers/route.ts', 'IMPORT_CUSTOMERS', 'CUSTOMER_CRM'],
  ['src/app/api/reports/shop/route.ts', 'REPORT_VIEW', 'REPORTS'],
] as const

const uiMatrix = [
  ['src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx', 'DEVICE_CREATE', 'EXPORT_DEVICES'],
  ['src/app/(shop)/shop/qurilmalar/[id]/page.tsx', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK', 'SALE_CREATE', 'SALE_EDIT', 'SALE_PAYMENT_RECEIVE', 'SALE_REMINDER_MANAGE', 'SALE_RETURN_REFUND', 'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD'],
  ['src/app/(shop)/shop/qurilmalar/new/page.tsx', 'DEVICE_CREATE', 'DEVICE_PURCHASE_ON_CREDIT'],
  ['src/app/(shop)/shop/sotuv/new/page.tsx', 'SALE_CREATE'],
  ['src/app/(shop)/shop/mijozlar/customers-client.tsx', 'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_EDIT', 'CUSTOMER_PASSPORT_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'],
  ['src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx', 'NASIYA_CREATE', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'],
  ['src/app/(shop)/shop/nasiyalar/[id]/page.tsx', 'NASIYA_EDIT', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER', 'NASIYA_REMINDER_MANAGE', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'],
  ['src/app/(shop)/shop/nasiyalar/import/page.tsx', 'IMPORT_OLD_NASIYA'],
  ['src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx', 'OLIB_CREATE', 'SUPPLIER_PAYMENT_MARK_PAID'],
  ['src/app/(shop)/shop/olib-sotdim/new/page.tsx', 'OLIB_CREATE'],
  ['src/app/(shop)/shop/import/import-center.tsx', 'IMPORT_CUSTOMERS', 'IMPORT_OLD_NASIYA'],
  ['src/app/(shop)/shop/eksport/export-center.tsx', 'EXPORT_DEVICES', 'EXPORT_CUSTOMERS', 'EXPORT_SALES', 'EXPORT_NASIYA', 'EXPORT_OLIB', 'EXPORT_RETURNS', 'EXPORT_LOGS', 'EXPORT_REPORTS'],
  ['src/components/shop/staff-management.tsx', 'STAFF_CREATE', 'STAFF_EDIT_PROFILE', 'STAFF_RESET_PASSWORD', 'STAFF_STATUS_MANAGE', 'STAFF_DELETE', 'STAFF_PERMISSION_MANAGE', 'STAFF_NOTIFICATION_MANAGE'],
  ['src/app/(shop)/shop/settings/settings-client.tsx', 'SHOP_PROFILE_EDIT', 'SHOP_CURRENCY_MANAGE', 'SHOP_TELEGRAM_MANAGE'],
] as const

const liveGuardPattern = /require(?:ShopPermission|ShopAnyPermission|ShopPermissionAndFeature|CurrentShopPermission|CurrentShopAnyPermission)\s*\(/

describe('shop exact-capability route matrix', () => {
  for (const [file, ...permissions] of routeMatrix) {
    it(`${file} declares its V2 capability boundary`, () => {
      const source = readFileSync(file, 'utf8')
      expect(source).toMatch(liveGuardPattern)
      for (const permission of permissions) {
        expect(source, `${file} must declare ${permission}`).toContain(`'${permission}'`)
      }
      for (const retired of RETIRED_SHOP_PERMISSION_CODES) {
        expect(source, `${file} must not use retired ${retired}`).not.toMatch(new RegExp(`['"]${retired}['"]`))
      }
    })
  }

  for (const [file, ...permissions] of uiMatrix) {
    it(`${file} mirrors exact server permissions in visible controls`, () => {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('useShopAccess')
      for (const permission of permissions) expect(source).toContain(`'${permission}'`)
    })
  }

  for (const [file, permission, feature] of featureMatrix) {
    it(`${file} binds ${permission} to the ${feature} package feature`, () => {
      expect(readFileSync(file, 'utf8')).toMatch(new RegExp(
        `requireShopPermissionAndFeature\\(\\s*['"]${permission}['"]\\s*,\\s*['"]${feature}['"]\\s*\\)`,
      ))
    })
  }

  it('maps each export entity to one independent capability', () => {
    const source = readFileSync('src/app/api/export/[entity]/route.ts', 'utf8')
    for (const [entity, permission] of [
      ['devices', 'EXPORT_DEVICES'],
      ['customers', 'EXPORT_CUSTOMERS'],
      ['sales', 'EXPORT_SALES'],
      ['nasiya', 'EXPORT_NASIYA'],
      ['olib', 'EXPORT_OLIB'],
      ['returns', 'EXPORT_RETURNS'],
      ['logs', 'EXPORT_LOGS'],
      ['report', 'EXPORT_REPORTS'],
    ] as const) {
      expect(source).toContain(`${entity}: '${permission}'`)
    }
    expect(source).toContain('const guarded = await requireShopPermission(permission)')
    expect(source).not.toMatch(new RegExp("['\"]EXPORT_DATA['\"]"))
  })
})
