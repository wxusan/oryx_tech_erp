import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buildLogSearchWhere,
  resolveLogLabelSearchCodes,
} from '@/lib/server/log-search'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('localized log-label contiguous search', () => {
  it('maps a rendered contextual label to its exact action and target pair', () => {
    expect(resolveLogLabelSearchCodes("Qurilma qo'shildi")).toEqual({
      actions: [],
      targetTypes: [],
      actionTargetPairs: [{ action: 'CREATE', targetType: 'Device' }],
    })
  })

  it('does not broaden a contextual label match to every CREATE or Device log', () => {
    const serialized = JSON.stringify(buildLogSearchWhere('Qurilma qo‘shildi'))

    expect(serialized).toContain('{"action":"CREATE","targetType":"Device"}')
    expect(serialized).not.toContain('"action":{"in":["CREATE"]}')
    expect(serialized).not.toContain('"targetType":{"in":["Device"]}')
  })

  it('maps a visible target label while retaining the raw-field predicates', () => {
    const codes = resolveLogLabelSearchCodes('qUrIlMa')
    const serialized = JSON.stringify(buildLogSearchWhere('qUrIlMa'))

    expect(codes.targetTypes).toContain('Device')
    expect(serialized).toContain('"targetType":{"in":["Device"]}')
    expect(serialized).toContain('"action":{"contains":"qUrIlMa","mode":"insensitive"}')
    expect(serialized).toContain('"note":{"contains":"qUrIlMa","mode":"insensitive"}')
  })

  it('requires one contiguous label substring instead of fuzzy token fragments', () => {
    expect(resolveLogLabelSearchCodes('Qurilma qo shildi').actionTargetPairs).toEqual([])
    expect(resolveLogLabelSearchCodes('Qurilma qshildi').actionTargetPairs).toEqual([])
  })

  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['\\', '\\\\'],
  ])('treats wildcard-looking %s as literal raw-field text', (query, escaped) => {
    const serialized = JSON.stringify(buildLogSearchWhere(query))

    expect(serialized).toContain(JSON.stringify(escaped).slice(1, -1))
    expect(resolveLogLabelSearchCodes(query)).toEqual({
      actions: [],
      targetTypes: [],
      actionTargetPairs: [],
    })
  })

  it('returns no predicate for an empty or whitespace-only query', () => {
    expect(buildLogSearchWhere('')).toEqual({})
    expect(buildLogSearchWhere('   ')).toEqual({})
  })
})

describe('log list paths share the same search contract and preserve scope', () => {
  const apiRoute = read('src/app/api/logs/route.ts')
  const shopLists = read('src/lib/server/shop-lists.ts')

  it('uses buildLogSearchWhere in both the API and shop bootstrap paths', () => {
    for (const source of [apiRoute, shopLists]) {
      expect(source).toContain("import { buildLogSearchWhere } from '@/lib/server/log-search'")
      expect(source).toContain('const searchWhere = buildLogSearchWhere(')
    }
  })

  it('keeps shop-facing log results tenant-scoped and bounded', () => {
    expect(shopLists).toContain('const take = Math.max(1, Math.min(100, query.take ?? 10))')
    expect(shopLists).toContain('const where: Prisma.LogWhereInput = {')
    expect(shopLists).toContain('shopId,')
    expect(shopLists).toContain("actorType: 'SHOP_ADMIN' as const")

    expect(apiRoute).toContain("shopId && shopId !== 'all' ? { shopId } : {}")
    expect(apiRoute).toContain('Math.trunc(Math.min(Math.max(requestedTake, 1), 100))')
  })
})
