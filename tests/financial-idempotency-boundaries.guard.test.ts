import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('financial mutation idempotency boundaries', () => {
  const routes = [
    'src/app/api/shops/[id]/payment/route.ts',
    'src/app/api/sales/[id]/payment/route.ts',
    'src/app/api/nasiya/[id]/payment/route.ts',
    'src/app/api/supplier-payables/[id]/payments/route.ts',
  ]

  it.each(routes)('%s rejects final keys outside 8–120 before database work', (path) => {
    const source = read(path)
    const lowerBound = source.indexOf('idempotencyKey.length < 8')
    const upperBound = source.indexOf('idempotencyKey.length > 120')
    const firstDatabaseWork = Math.min(
      ...['prisma.', 'resolveActiveShopId(', 'recordSupplierPayablePayment(']
        .map((marker) => source.indexOf(marker))
        .filter((index) => index >= 0),
    )

    expect(lowerBound).toBeGreaterThan(0)
    expect(upperBound).toBeGreaterThan(lowerBound)
    expect(lowerBound).toBeLessThan(firstDatabaseWork)
    expect(source).toContain('8–120')
  })

  it('validates the prefixed settlement-payment key itself before database work', () => {
    const source = read('src/app/api/nasiya/[id]/settlement/route.ts')
    const derived = source.indexOf('const paymentIdempotencyKey =')
    const upperBound = source.indexOf('paymentIdempotencyKey.length > 120')
    const firstDatabaseWork = source.indexOf('resolveActiveShopId(', derived)

    expect(derived).toBeGreaterThan(0)
    expect(upperBound).toBeGreaterThan(derived)
    expect(upperBound).toBeLessThan(firstDatabaseWork)
    expect(source).toContain('idempotencyKey: paymentIdempotencyKey')
  })

  it.each([
    ['src/app/api/nasiya/[id]/resolution/route.ts', 'nasiyaResolutionEvent', 'getUsdUzsRate('],
    ['src/app/api/nasiya/[id]/defer/route.ts', 'nasiyaDeferral', "rateLimitKey('nasiya-defer'"],
    ['src/app/api/devices/[id]/return/route.ts', 'deviceReturn', 'getShopCurrencyContext('],
    ['src/app/api/nasiya/[id]/return/route.ts', 'deviceReturn', "rateLimitKey('nasiya-return'"],
  ])('%s resolves an actor-bound committed replay before mutable dependencies', (path, model, dependency) => {
    const source = read(path)
    const replay = source.indexOf(`const committedReplay = await prisma.${model}.findUnique`)
    const actorBinding = source.indexOf('session.user.id', replay)
    const mutableDependency = source.indexOf(dependency, replay)

    expect(replay).toBeGreaterThan(0)
    expect(actorBinding).toBeGreaterThan(replay)
    expect(mutableDependency).toBeGreaterThan(actorBinding)
  })

  it.each([
    'src/app/api/nasiya/[id]/resolution/route.ts',
    'src/app/api/nasiya/[id]/defer/route.ts',
    'src/app/api/devices/[id]/return/route.ts',
    'src/app/api/nasiya/[id]/return/route.ts',
  ])('%s rejects keys outside 8–120', (path) => {
    const source = read(path)
    expect(source).toContain('idempotencyKey.length < 8')
    expect(source).toContain('idempotencyKey.length > 120')
  })
})
