import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const schema = read('prisma/schema.prisma')
const migration = read(
  'prisma/migrations/202607230003_usd_uzs_evidence_integrity/migration.sql',
)
const route = read('src/app/api/devices/[id]/nasiya/route.ts')
const core = read('src/lib/server/nasiya-contract-core.ts')
const page = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')
const olibRoute = read('src/app/api/olib-sotdim/route.ts')
const preflight = read('scripts/production-release-preflight.mjs')

describe('standalone Nasiya creation command identity', () => {
  it('stores a tenant-unique, validated creation key/hash pair', () => {
    expect(schema).toContain('creationIdempotencyKey             String?')
    expect(schema).toContain('creationCommandHash                String?')
    expect(schema).toContain('@@unique([shopId, creationIdempotencyKey])')
    expect(migration).toContain('ADD COLUMN "creationIdempotencyKey" TEXT')
    expect(migration).toContain('ADD COLUMN "creationCommandHash" TEXT')
    expect(migration).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "Nasiya_shopId_creationIdempotencyKey_key"',
    )
    expect(migration).toContain('"Nasiya_creation_command_pair_check"')
    expect(migration).toContain(
      'length(btrim("creationIdempotencyKey")) BETWEEN 8 AND 120',
    )
    expect(preflight).toContain("name: 'financial_evidence_index_inventory_issues'")
    expect(preflight).toContain("'Nasiya_shopId_importIdempotencyKey_key'")
    expect(preflight).toContain("'Nasiya_shopId_creationIdempotencyKey_key'")
  })

  it('resolves a committed replay before rate, upload, currency, and FX work', () => {
    expect(route).toContain("req.headers.get('idempotency-key')?.trim()")
    expect(route).toContain('idempotencyKey.length < 8 || idempotencyKey.length > 120')
    expect(route).toContain("scope: 'standalone-nasiya'")
    expect(route).toContain('shopId_creationIdempotencyKey')

    const replay = route.indexOf('const committedReplay = await prisma.nasiya.findUnique')
    expect(replay).toBeGreaterThan(-1)
    for (const laterWork of [
      "checkRateLimitDistributed(rateLimitKey('nasiya-create'",
      'getShopCurrencyContext(shopId)',
      'resolvePrivateUploadReference({',
      'prepareNasiyaContract({',
    ]) {
      expect(route.indexOf(laterWork)).toBeGreaterThan(replay)
    }
  })

  it('serializes same-key transactions and persists identity through the core', () => {
    expect(route).toContain('pg_advisory_xact_lock')
    expect(route).toContain('nasiya-create:${shopId}:${idempotencyKey}')
    expect(route.match(/shopId_creationIdempotencyKey/g)?.length).toBeGreaterThanOrEqual(2)
    expect(route).toContain('creationIdempotencyKey: idempotencyKey')
    expect(route).toContain('creationCommandHash: commandHash')
    expect(core).toContain('creationIdempotencyKey: string')
    expect(core).toContain('creationCommandHash: string')
    expect(core).toContain('creationIdempotencyKey: input.creationIdempotencyKey')
    expect(core).toContain('creationCommandHash: input.creationCommandHash')
  })

  it('keeps one logical browser command across ambiguous retries', () => {
    expect(page).toContain("import { useLogicalCommandIdempotency }")
    expect(page).toContain('const nasiyaCommand = useLogicalCommandIdempotency()')
    expect(page).toContain("'Idempotency-Key': nasiyaCommand.keyFor(payload)")
    expect(page).toContain('nasiyaCommand.rejected(res.status)')
    expect(page).toContain('nasiyaCommand.committed()')
  })

  it('domain-separates the Olib child Nasiya key while retaining its command hash', () => {
    expect(olibRoute).toContain(
      "const nasiyaCreationIdempotencyKey = `olib:${createHash('sha256').update(idempotencyKey).digest('hex')}`",
    )
    expect(olibRoute).toContain(
      'creationIdempotencyKey: nasiyaCreationIdempotencyKey',
    )
    expect(olibRoute).toContain('creationCommandHash: commandHash')
  })
})
