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
  ['src/app/api/customers/[id]/route.ts', 'CUSTOMER_VIEW', 'CUSTOMER_MANAGE'],
  ['src/app/api/customers/by-phone/route.ts', 'CUSTOMER_VIEW'],
  ['src/app/api/nasiya/route.ts', 'NASIYA_VIEW'],
  ['src/app/api/nasiya/[id]/route.ts', 'NASIYA_VIEW', 'NASIYA_MANAGE'],
  ['src/app/api/nasiya/[id]/reminder/route.ts', 'NASIYA_MANAGE'],
  ['src/app/api/nasiya/[id]/payment/route.ts', 'PAYMENT_RECEIVE'],
  ['src/app/api/nasiya/import/route.ts', 'IMPORT_DATA'],
  ['src/app/api/olib-sotdim/route.ts', 'OLIB_VIEW', 'OLIB_MANAGE'],
  ['src/app/api/olib-sotdim/[id]/pay/route.ts', 'PAYMENT_RECEIVE'],
  ['src/app/api/sales/[id]/route.ts', 'CASH_SALE_MANAGE'],
  ['src/app/api/sales/[id]/payment/route.ts', 'PAYMENT_RECEIVE'],
  ['src/app/api/uploads/device/route.ts', 'INVENTORY_MANAGE', 'INVENTORY_VIEW'],
  ['src/app/api/uploads/passport/route.ts', 'NASIYA_CREATE', 'NASIYA_VIEW'],
  ['src/app/api/import/customers/route.ts', 'IMPORT_DATA'],
  ['src/app/api/export/[entity]/route.ts', 'EXPORT_DATA'],
  ['src/app/api/logs/route.ts', 'LOG_VIEW'],
  ['src/app/api/logs/[id]/link/route.ts', 'LOG_VIEW'],
  ['src/app/api/stats/shop/route.ts', 'REPORT_VIEW'],
  ['src/app/api/stats/due-overdue/route.ts', 'PAYMENT_RECEIVE'],
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
        expect(source).toContain(`requireShopPermission('${permission}')`)
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
})
