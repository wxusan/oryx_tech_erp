import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('P0 refund cap guard', () => {
  const src = read('src/app/api/devices/[id]/return/route.ts')

  it('caps refunds to money actually collected before marking the device returned', () => {
    expect(src).toContain('const maxRefund = sale')
    expect(src).toContain('tx.nasiyaPayment.aggregate')
    expect(src).toContain('parsed.data.refundAmount > maxRefund')
    expect(src).toContain('Qaytariladigan summa mijozdan olingan summadan oshmasligi kerak')
    expect(src.indexOf('parsed.data.refundAmount > maxRefund')).toBeLessThan(src.indexOf('tx.device.updateMany'))
  })
})

describe('P0 shop subscription idempotency guard', () => {
  const route = read('src/app/api/shops/[id]/payment/route.ts')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/202607030006_audit_hardening_idempotency/migration.sql')
  const ui = read('src/app/(admin)/admin/shops/[id]/page.tsx')

  it('requires and stores a scoped idempotency key', () => {
    expect(route).toContain("req.headers.get('idempotency-key')")
    expect(route).toContain('shopId_idempotencyKey')
    expect(route).toContain('idempotencyKey,')
    expect(schema).toContain('idempotencyKey String?')
    expect(schema).toContain('@@unique([shopId, idempotencyKey])')
    expect(migration).toContain('ShopPayment_shopId_idempotencyKey_key')
    expect(ui).toContain("'Idempotency-Key': idempotencyKey")
  })
})

describe('P0 nasiya deferral idempotency guard', () => {
  const route = read('src/app/api/nasiya/[id]/payment/route.ts')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/202607030006_audit_hardening_idempotency/migration.sql')
  const ui = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('records deferrals in a durable idempotency ledger without creating a payment row', () => {
    expect(route).toContain('(amount > 0 || deferredToNext) && !idempotencyKey')
    expect(route).toContain('tx.nasiyaDeferral.findUnique')
    expect(route).toContain('tx.nasiyaDeferral.create')
    expect(route).toContain('duplicate: true')
    expect(schema).toContain('model NasiyaDeferral')
    expect(schema).toContain('@@unique([shopId, idempotencyKey])')
    expect(migration).toContain('CREATE TABLE "NasiyaDeferral"')
    expect(ui).toContain("'Idempotency-Key': idempotencyKey")
  })
})
