import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SEARCH_SURFACE_CONTRACT } from '@/lib/field-search-contract'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const FREE_TEXT_SURFACES = [
  {
    id: 'admin-shops',
    ui: 'src/app/(admin)/admin/shops/page.tsx',
    server: 'src/app/api/shops/route.ts',
  },
  {
    id: 'device-list',
    ui: 'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
    server: 'src/lib/server/shop-lists.ts',
  },
  {
    id: 'device-action-queue',
    ui: 'src/app/(shop)/shop/qurilmalar/device-action-queue.tsx',
    server: 'src/app/api/devices/route.ts',
  },
  {
    id: 'device-picker',
    ui: 'src/components/shop/in-stock-device-picker.tsx',
    server: 'src/app/api/devices/route.ts',
  },
  {
    id: 'sales-list',
    ui: 'src/app/(shop)/shop/sotuvlar/sales-work-queue.tsx',
    server: 'src/lib/server/sales-list.ts',
  },
  {
    id: 'return-queue',
    ui: 'src/app/(shop)/shop/qaytarish/return-work-queue.tsx',
    server: 'src/app/api/devices/route.ts',
  },
  {
    id: 'nasiya-list',
    ui: 'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx',
    server: 'src/lib/server/shop-lists.ts',
  },
  {
    id: 'customer-list',
    ui: 'src/app/(shop)/shop/mijozlar/customers-client.tsx',
    server: 'src/lib/server/customer-search.ts',
  },
  {
    id: 'customer-picker',
    ui: 'src/components/shop/customer-combobox.tsx',
    server: 'src/lib/server/customer-search.ts',
  },
  {
    id: 'olib-sotdim-list',
    ui: 'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx',
    server: 'src/app/api/olib-sotdim/route.ts',
  },
  {
    id: 'debt-list',
    ui: 'src/app/(shop)/shop/qarzlar/qarzlar-client.tsx',
    server: 'src/lib/server/debts.ts',
  },
  {
    id: 'audit-log-list',
    ui: 'src/app/(shop)/shop/logs/logs-client.tsx',
    server: 'src/app/api/logs/route.ts',
  },
] as const

describe('maintained free-text search surface inventory', () => {
  it('tracks all 12 user-facing search boxes in the authoritative contract', () => {
    expect(FREE_TEXT_SURFACES).toHaveLength(12)
    const contractIds = new Set(SEARCH_SURFACE_CONTRACT.map(({ id }) => id))

    for (const surface of FREE_TEXT_SURFACES) {
      expect(existsSync(resolve(process.cwd(), surface.ui)), surface.ui).toBe(true)
      expect(existsSync(resolve(process.cwd(), surface.server)), surface.server).toBe(true)
      expect(contractIds.has(surface.id), `${surface.id} is missing from SEARCH_SURFACE_CONTRACT`).toBe(true)
    }
  })

  it('uses the shared semantic highlighter at every free-text result surface', () => {
    for (const surface of FREE_TEXT_SURFACES) {
      const source = read(surface.ui)
      expect(source, `${surface.id} must render committed matches with HighlightedText`)
        .toContain('HighlightedText')
      expect(source, `${surface.id} must distinguish the committed highlight query`)
        .toContain('highlightQuery')
      expect(source, `${surface.id} must suppress placeholder/loading highlights`)
        .toMatch(/isPlaceholderData|resultQuery/)
    }
  })
})

describe('partial additional-phone search document', () => {
  const migrationPath = 'prisma/migrations/202607230002_contiguous_search_phone_document/migration.sql'

  it('declares the derived phoneSearchDigits document without changing exact-phone uniqueness', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toMatch(/phoneSearchDigits\s+String\s+@default\(""\)/)
    expect(schema).toContain('Customer_shopId_normalizedPhone_active_key')
    expect(schema).toContain('@@index([shopId, normalizedPhone])')
  })

  it('backfills and trigger-maintains delimiter-safe primary/additional phone digits', () => {
    expect(existsSync(resolve(process.cwd(), migrationPath)), migrationPath).toBe(true)
    const migration = read(migrationPath)

    expect(migration).toContain('phoneSearchDigits')
    expect(migration).toContain('additionalPhones')
    expect(migration).toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i)
    expect(migration).toMatch(/CREATE\s+TRIGGER/i)
    expect(migration).toMatch(/BEFORE\s+(?:INSERT|UPDATE)/i)
    // Each number must be surrounded by a delimiter, preventing a query from
    // joining the tail of one phone to the head of another.
    expect(migration).toMatch(/\|\s*['"]|['"]\s*\|/)
  })

  it('installs active trigram indexes for the phone document and normalized IMEIs', () => {
    const migration = read(migrationPath)
    expect(migration).toMatch(/phoneSearchDigits[\s\S]*gin_trgm_ops/i)
    expect(migration).toMatch(/normalizedValue[\s\S]*gin_trgm_ops/i)
    expect(migration.match(/WHERE\s+"deletedAt"\s+IS\s+NULL/gi)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('authoritative server predicate coverage', () => {
  it('uses the shared bounded needle and partial phone document in every customer-bearing list', () => {
    for (const path of [
      'src/lib/server/customer-search.ts',
      'src/lib/server/shop-lists.ts',
      'src/lib/server/sales-list.ts',
      'src/app/api/olib-sotdim/route.ts',
      'src/lib/server/debts.ts',
    ]) {
      const source = read(path)
      expect(source, `${path} must share query classification`).toContain('prepareSearchNeedle')
      expect(source, `${path} must search partial additional phones`).toContain('phoneSearchDigits')
      expect(source, `${path} must never retain exact scalar-list semantics`).not.toMatch(
        /additionalPhones\s*:\s*\{\s*has\s*:/,
      )
    }
  })

  it('covers secondary IMEI relations in device, nasiya, olib-sotdim, and debt searches', () => {
    for (const path of [
      'src/lib/server/shop-lists.ts',
      'src/app/api/olib-sotdim/route.ts',
      'src/lib/server/debts.ts',
    ]) {
      const source = read(path)
      expect(source, `${path} must search DeviceImei`).toMatch(/imeis|DeviceImei/)
      expect(source, `${path} must search normalized identifier digits`).toContain('normalizedValue')
    }
  })

  it('keeps wildcard-looking input literal in every hand-written SQL search path', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toContain('escapeLikeSearchValue')
    expect(source).toMatch(/ESCAPE\s+'\\\\'/)
  })

  it('keeps all formerly unbounded GET searches at the shared 100-character limit', () => {
    for (const path of [
      'src/app/api/devices/route.ts',
      'src/app/api/nasiya/route.ts',
      'src/app/api/olib-sotdim/route.ts',
      'src/app/api/logs/route.ts',
    ]) {
      const source = read(path)
      expect(source, `${path} must reject a search over 100 characters`).toContain('exceedsMaxLength')
    }
  })
})

describe('exact identifier and privacy exceptions', () => {
  it('keeps by-phone lookup exact, shop-scoped, and soft-delete scoped', () => {
    const route = read('src/app/api/customers/by-phone/route.ts')
    expect(route).toMatch(/where:\s*\{[^}]*\bnormalizedPhone\b[^}]*\}/)
    expect(route).not.toMatch(/normalizedPhone\s*:\s*\{\s*contains:/)
    expect(route).toContain('shopId')
    expect(route).toContain('deletedAt: null')
  })

  it('keeps passport search exact-HMAC and never changes it into substring search', () => {
    const source = read('src/lib/server/customer-search.ts')
    expect(source).toContain('passportSearchHash')
    expect(source).toMatch(/passportIdentifierHash\s*:\s*passportSearchHash/)
    expect(source).not.toMatch(/passportIdentifierHash\s*:\s*\{\s*contains:/)
  })

  it('keeps customer identifiers out of URLs, query keys, and operational logs', () => {
    const transport = read('src/lib/customer-search-transport.ts')
    const combobox = read('src/components/shop/customer-combobox.tsx')
    const list = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')
    const route = read('src/app/api/customers/search/route.ts')

    expect(transport).toContain("method: 'POST'")
    expect(combobox).toContain('requestRevision: searchRevision')
    expect(combobox).not.toContain('search: debouncedSearch,\n      page')
    expect(list).not.toContain('replaceListUrlState({ q: search')
    expect(route).not.toMatch(/logger\w*\([^)]*input\.search/)
  })
})
