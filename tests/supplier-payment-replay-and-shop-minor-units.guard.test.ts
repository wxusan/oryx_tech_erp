import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('supplier payment lost-success replay', () => {
  const compatibilityRoute = read('src/app/api/olib-sotdim/[id]/pay/route.ts')
  const paymentRoute = read('src/app/api/supplier-payables/[id]/payments/route.ts')
  const client = read('src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx')

  it('requires a bounded durable key and gives the compatibility UI one logical command', () => {
    expect(compatibilityRoute).toContain('idempotencyKey.length < 8')
    expect(compatibilityRoute).toContain('idempotencyKey.length > 120')
    expect(compatibilityRoute).toContain('submittedIdempotencyKey === null')
    expect(compatibilityRoute).toContain('`legacy-full:${id}`')
    expect(compatibilityRoute).not.toContain('payable.ledgerVersion')
    expect(client).toContain('useLogicalCommandIdempotency()')
    expect(client).toContain("'Idempotency-Key': payCommand.keyFor({ supplierPayableId: payFor.id, payload })")
    expect(client).toContain('payCommand.committed()')
    expect(client).toContain('payCommand.rejected(res.status)')
  })

  it.each([
    ['compatibility', compatibilityRoute],
    ['partial/full', paymentRoute],
  ])('replays %s payments before rate limiting or currency context', (_label, source) => {
    const replay = source.indexOf('replayCommittedSupplierPayablePayment(')
    const rateLimit = source.indexOf('checkRateLimitDistributed(')
    const currency = source.indexOf('getShopCurrencyContext(')

    expect(replay).toBeGreaterThan(-1)
    expect(replay).toBeLessThan(rateLimit)
    expect(replay).toBeLessThan(currency)
  })
})

describe('shop subscription payment native precision', () => {
  const route = read('src/app/api/shops/[id]/payment/route.ts')

  it('parses the submitted amount into exact currency minor units', () => {
    expect(route).toContain('moneyMinorUnitsFromAmount(amount, currency)')
    expect(route).toContain('const submittedMinorUnits = submittedAmountMinorUnits(')
    expect(route).toContain('expectedAmountMinorUnits !== packageSubmittedMinorUnits')
  })

  it('binds committed replays by exact stored minor units instead of rounded floating comparison', () => {
    expect(route).toContain('storedAmountMatchesMinorUnits(')
    expect(route).not.toMatch(/sameMoney\(committedReplay\.amount,\s*parsed\.data\.amount/)
    expect(route).not.toMatch(/sameMoney\(existingPayment\.amount,\s*parsed\.data\.amount/)
    expect(route).toContain('if (e.status === 400) return badRequest(e.message)')
  })
})
