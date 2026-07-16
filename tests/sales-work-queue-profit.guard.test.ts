import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('sales work queue profit', () => {
  const route = read('src/app/api/devices/route.ts')
  const queue = read('src/app/(shop)/shop/sotuvlar/sales-work-queue.tsx')

  it('calculates the native contract margin server-side and returns it only to owners', () => {
    expect(route).toContain('computeSaleContractMargin(')
    expect(route).toContain('...(includeOwnerFinancials ? { contractProfit } : {})')
    expect(route).toContain('purchaseAmountUzsSnapshot: Number(row.purchaseAmountUzsSnapshot)')
  })

  it('shows an owner-only green Foyda column in the sales table', () => {
    expect(queue).toContain("const showProfit = memberKind === 'SHOP_OWNER'")
    expect(queue).toContain('>Foyda</th>')
    expect(queue).toContain('text-emerald-600')
    expect(queue).toContain('sale.contractProfit == null')
  })
})
