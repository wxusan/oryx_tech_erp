import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('P1 money/report clarity guard', () => {
  it('cash-flow stats include returned/cancelled parent payments but expose explicit gross/net fields', () => {
    const src = read('src/lib/server/shop-stats.ts')
    const salePaymentAgg = src.slice(src.indexOf('prisma.salePayment.aggregate'), src.indexOf('prisma.nasiya.findMany'))
    const nasiyaPaymentAgg = src.slice(src.indexOf('prisma.nasiyaPayment.aggregate'), src.indexOf('prisma.nasiya.count'))

    expect(salePaymentAgg).not.toContain('sale: { deletedAt: null }')
    expect(nasiyaPaymentAgg).not.toContain("nasiya: { deletedAt: null, status: { not: 'CANCELLED' } }")
    // The gross/net field NAMES live in the pure formula layer (extracted to
    // src/lib/shop-stats-formulas.ts so the arithmetic is unit-testable —
    // see tests/shop-stats-formulas.test.ts); shop-stats.ts itself is now
    // just the Prisma query + thin pass-through wrapper.
    const formulas = read('src/lib/shop-stats-formulas.ts')
    expect(formulas).toContain('grossCashInThisMonth')
    expect(formulas).toContain('netCashFlowThisMonth')
  })

  it('dashboard/report labels distinguish gross turnover, net cash, refunds and sales profit', () => {
    const dashboard = read('src/app/(shop)/shop/dashboard/dashboard-client.tsx')
    const report = read('src/app/(shop)/shop/hisobot/hisobot-client.tsx')

    // "Umumiy aylanma" = gross turnover, "Sof tushum" = net cash after refunds,
    // "Sotuv foydasi" = sale price minus purchase cost (not full net profit).
    expect(dashboard).toContain('Umumiy aylanma')
    expect(dashboard).toContain('Sof tushum')
    expect(dashboard).toContain('Sotuv foydasi')
    expect(report).toContain('Umumiy aylanma')
    expect(report).toContain('Sof tushum')
    expect(report).toContain('Qaytarilgan summa')
    expect(report).toContain('Sotuv foydasi')
  })
})

describe('P1 nasiya preview consistency guard', () => {
  it('new nasiya preview imports shared server calculation and schedule helpers', () => {
    const src = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')

    expect(src).toContain('calculateNasiyaAmounts')
    expect(src).toContain('generatePaymentSchedule')
    expect(src).not.toContain('finalNasiyaAmount / m')
  })
})

describe('P1 imported old nasiya duplicate guard', () => {
  it('blocks exact duplicate imports beyond IMEI', () => {
    const src = read('src/app/api/nasiya/import/route.ts')

    expect(src).toContain('const duplicateImport = await prisma.nasiya.findFirst')
    expect(src).toContain('isImported: true')
    expect(src).toContain('remainingAtImport: Math.round(remainingDebtInput.amountUzs)')
    expect(src).toContain('monthlyPayment: Math.round(monthlyPaymentInput.amountUzs)')
    expect(src).toContain("Bu mijoz va qurilma uchun shunga o'xshash eski nasiya")
  })
})

describe('P1 device image write restriction guard', () => {
  it('stores private upload keys and rejects cross-shop image keys', () => {
    const validations = read('src/lib/validations.ts')
    const route = read('src/app/api/devices/route.ts')
    const ui = read('src/app/(shop)/shop/qurilmalar/new/page.tsx')

    expect(validations).toContain('deviceImageKeySchema')
    expect(validations).toContain('shops\\/[^/]+\\/devices')
    expect(route).toContain('!url.startsWith(`shops/${resolvedShopId}/devices/`)')
    expect(ui).toContain('return json.data.key as string')
  })
})
