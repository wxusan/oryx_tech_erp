import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('P0 refund cap guard', () => {
  const src = read('src/app/api/devices/[id]/return/route.ts')

  it('caps the contract-currency refund to immutable receipt rows before returning stock', () => {
    expect(src).toContain("sale.payments.map((payment) => paymentSource('SALE', payment))")
    expect(src).not.toContain("paymentSource('NASIYA'")
    expect(src).toContain('resolveAppliedContractAmount(source, contractCurrency, frozenRate)')
    expect(src).toContain('contractRefundAmount > contractReceiptsAtReturn')
    expect(src).toContain('Qaytariladigan summa mijozdan amalda olingan summadan oshmasligi kerak.')
    expect(src.indexOf('contractRefundAmount > contractReceiptsAtReturn')).toBeLessThan(src.indexOf('const guardedReturn = await tx.device.updateMany'))
  })

  it('allocates the refund back to its source receipts without editing or deleting them', () => {
    expect(src).toContain('allocateReturnRefund({')
    expect(src).toContain('tx.returnRefundAllocation.createMany')
    expect(src).toContain('deviceReturnId: returnRecord.id')
    expect(src).not.toMatch(/tx\.(salePayment|nasiyaPayment)\.(update|updateMany|delete|deleteMany)\b/)
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
    expect(ui).toContain("'Idempotency-Key': paymentCommand.keyFor(payload)")
  })
})

describe('P0 nasiya deferral idempotency guard', () => {
  const route = read('src/app/api/nasiya/[id]/defer/route.ts')
  const paymentRoute = read('src/app/api/nasiya/[id]/payment/route.ts')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/202607130008_nasiya_resolution_deferral/migration.sql')
  const ui = read('src/components/shop/nasiya-defer-modal.tsx')

  it('records deferrals in a durable idempotency ledger without creating a payment row', () => {
    expect(route).toContain('idempotencyKey.length < 8')
    expect(route).toContain('idempotencyKey.length > 120')
    expect(route).toContain('tx.nasiyaDeferral.findUnique')
    expect(route).toContain('tx.nasiyaDeferral.create')
    expect(route).toContain('duplicate: true')
    expect(schema).toContain('model NasiyaDeferral')
    expect(schema).toContain('@@unique([shopId, idempotencyKey])')
    expect(migration).toContain('"originalDueDate"')
    expect(migration).toContain('"NasiyaDeferral_immutable"')
    expect(ui).toContain("'Idempotency-Key': command.keyFor(payload)")
    expect(route).toContain('sameInstant(existing.newDueDate, newDueDate)')
    expect(route).toContain('sameOptionalText(existing.note, reason)')
    expect(route).not.toContain('nasiyaPayment.create')
    expect(paymentRoute).not.toContain('nasiyaDeferral.create')
  })

  it('replays a matching final payment before COMPLETED rejection and conflicts on changed durable payload', () => {
    const replayLookup = paymentRoute.indexOf('const existingPayment = await tx.nasiyaPayment.findUnique')
    const completedGuard = paymentRoute.indexOf("if (currentLedger.status === 'COMPLETED')")
    expect(replayLookup).toBeGreaterThan(-1)
    expect(completedGuard).toBeGreaterThan(replayLookup)
    expect(paymentRoute).toContain('const currentLedger = reconcileNasiyaLedger({')
    expect(paymentRoute).not.toContain("if (nasiya.status === 'COMPLETED')")
    expect(paymentRoute).toContain('matchesExistingPaymentPayload(existingPayment')
    const matcherStart = paymentRoute.indexOf('function matchesExistingPaymentPayload(')
    const matcherBlock = paymentRoute.slice(matcherStart, paymentRoute.indexOf('export async function POST', matcherStart))
    expect(matcherStart).toBeGreaterThan(-1)
    expect(matcherBlock).toContain('existing.nasiyaScheduleId')
    expect(matcherBlock).toContain('existing.paymentInputAmount ?? existing.amount')
    expect(matcherBlock).toContain('existing.paymentInputCurrency')
    expect(matcherBlock).toContain('existing.paymentMethod')
    expect(matcherBlock).toContain('canonicalPaymentBreakdown(existing.paymentBreakdown')
    expect(matcherBlock).toContain('sameInstant(existing.paidAt, submitted.paidAt)')
    expect(matcherBlock).toContain('sameOptionalText(existing.note, submitted.note)')
    expect(paymentRoute).toContain('duplicate: true')
    expect(paymentRoute).toContain("Idempotency-Key boshqa yoki o'zgartirilgan nasiya to'lovi uchun ishlatilgan")
  })
})
