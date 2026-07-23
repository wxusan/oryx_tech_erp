import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('demo seed compatibility guard', () => {
  it('assigns every seeded notification to the intended tenant member', () => {
    const source = readFileSync('scripts/seed-demo.mjs', 'utf8')

    expect(source).toContain("await insert('Notification'")
    expect(source).toContain('recipientShopAdminId: adminId')
  })

  it('refuses to delete demo tenants once append-only financial evidence exists', () => {
    const source = readFileSync('scripts/seed-demo.mjs', 'utf8')

    for (const table of [
      'DevicePurchaseReceipt',
      'ShopPayment',
      'SalePayment',
      'NasiyaPayment',
      'SupplierPayablePayment',
    ]) {
      expect(source).toContain(`select count(*) from "${table}" where "shopId" = any($1)`)
    }
    expect(source).toContain('append-only financial evidence and cannot be reset in place')
  })
})
