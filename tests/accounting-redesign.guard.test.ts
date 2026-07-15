import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('complete accounting redesign release guard', () => {
  it('persists zero-paid sales without a fake payment or method and makes creation idempotent', () => {
    const schema = read('prisma/schema.prisma')
    const route = read('src/app/api/devices/[id]/sell/route.ts')
    const ui = read('src/app/(shop)/shop/sotuv/new/page.tsx')

    expect(schema).toMatch(/paymentMethod\s+PaymentMethod\?/)
    expect(schema).toContain('creationIdempotencyKey')
    expect(schema).toContain('@@unique([shopId, creationIdempotencyKey])')
    expect(route).toContain('if (paid > 0)')
    expect(route).toContain('paymentMethod: paid > 0 ? paymentMethod : null')
    expect(route).toContain('creationCommandHash: commandHash')
    expect(ui).toContain("paymentMode === 'LATER' ? 0")
    expect(ui).toContain("paymentMode === 'LATER' ? undefined : payMethod")
    expect(ui).toContain("'Idempotency-Key': saleCommand.keyFor(payload)")

    const olibRoute = read('src/app/api/olib-sotdim/route.ts')
    const olibUi = read('src/app/(shop)/shop/olib-sotdim/new/page.tsx')
    expect(olibRoute).toContain('creationIdempotencyKey: idempotencyKey')
    expect(olibRoute).toContain('creationCommandHash: commandHash')
    expect(olibUi).toContain("'Idempotency-Key': saleCommand.keyFor(payload)")
  })

  it('shows the four authoritative monthly cards and retires the write-off card', () => {
    const stats = read('src/app/(shop)/shop/hisobot/hisobot-client.tsx')
    for (const label of [
      'Bu oy tushgan pul',
      'Sof tushum',
      'Bu oy to&apos;lanishi kerak',
      'Bu oy haqiqiy foyda',
      'Nasiya foizi — tushgan',
      'Nasiya foizi — kutilayotgan',
    ]) expect(stats).toContain(label)
    expect(stats).not.toContain('Hisobdan chiqarilgan qarz')
    expect(stats).toContain('To&apos;lanmagan bekor qilingan qarz pul qaytarilishi hisoblanmaydi')
  })

  it('makes Super Admin currency preference persistent and historical receipts snapshot-based', () => {
    const schema = read('prisma/schema.prisma')
    const layout = read('src/app/(admin)/admin-layout-client.tsx')
    const profile = read('src/app/api/admin/profile/route.ts')
    const payment = read('src/app/api/shops/[id]/payment/route.ts')
    const exportRoute = read('src/app/api/admin/payments/route.ts')
    const statsRoute = read('src/app/api/stats/admin/route.ts')

    expect(schema).toContain('preferredCurrency  CurrencyCode')
    expect(layout).toContain("(['UZS', 'USD'] as const)")
    expect(profile).toContain('preferredCurrency: z.enum')
    expect(payment).toContain('amountUzsSnapshot: snapshots.amountUzsSnapshot')
    expect(payment).toContain('amountUsdSnapshot: snapshots.amountUsdSnapshot')
    expect(exportRoute).toContain("'historicalDisplayUzs', 'historicalDisplayUsd'")
    expect(exportRoute).toContain('reporting: adminReportingContext(currency)')
    expect(statsRoute).toContain('reporting: adminReportingContext(currency)')
  })

  it('uses an additive evidence-preserving migration and disables new write-off grants', () => {
    const migration = read('prisma/migrations/202607150004_complete_accounting_redesign/migration.sql')
    expect(migration).toContain('ADD COLUMN "preferredCurrency"')
    expect(migration).toContain('ADD COLUMN "amountUzsSnapshot"')
    expect(migration).toContain('candidate."fetchedAt" <= payment."paidAt"')
    expect(migration).toContain("ELSE 'PARTIAL'::\"AccountingReconstructionStatus\"")
    expect(migration).toContain("WHERE \"code\" = 'NASIYA_WRITE_OFF'")
    expect(migration).not.toContain('DELETE FROM "NasiyaResolutionEvent"')
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)
  })
})
