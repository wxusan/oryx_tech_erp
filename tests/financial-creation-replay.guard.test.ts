import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('financial creation retry ordering', () => {
  it('replays a committed cash sale before rate-limit and FX dependencies', () => {
    const route = read('src/app/api/devices/[id]/sell/route.ts')
    const replay = route.indexOf('const committedReplay = await prisma.sale.findUnique')
    const rateLimit = route.indexOf("rateLimitKey('device-sell'")
    const fx = route.indexOf('await createMoneyInputConverter')

    expect(replay).toBeGreaterThan(-1)
    expect(replay).toBeLessThan(rateLimit)
    expect(replay).toBeLessThan(fx)
    expect(route).toContain('sale-create:${shopId}:${idempotencyKey}')
    expect(route).toContain('pg_advisory_xact_lock')
  })

  it('replays a committed Olib command before upload-reference and FX dependencies', () => {
    const route = read('src/app/api/olib-sotdim/route.ts')
    const replay = route.indexOf(
      'const committedReplay = await prisma.olibSotdimOperation.findUnique',
    )
    const rateLimit = route.indexOf("rateLimitKey('olib-sotdim-create'")
    const uploadReference = route.indexOf('resolvePrivateUploadReference', replay)
    const fx = route.indexOf('await createMoneyInputConverter', replay)

    expect(replay).toBeGreaterThan(-1)
    expect(replay).toBeLessThan(rateLimit)
    expect(replay).toBeLessThan(uploadReference)
    expect(replay).toBeLessThan(fx)
    expect(route).toContain('olib-sotdim-create:${shopId}:${idempotencyKey}')
    expect(route).toContain('pg_advisory_xact_lock')
  })
})
