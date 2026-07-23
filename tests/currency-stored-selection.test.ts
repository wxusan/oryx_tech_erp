import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currencyRateFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    currencyRate: { findFirst: mocks.currencyRateFindFirst },
  },
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})

import { getStoredUsdUzsRateSnapshot } from '@/lib/server/currency'

type StoredRate = {
  rate: number
  source: string
  effectiveDate: Date | null
  fetchedAt: Date
}

describe('stored USD/UZS quote selection', () => {
  beforeEach(() => {
    mocks.currencyRateFindFirst.mockReset()
  })

  it('filters newer invalid legacy rows in the query so they cannot mask an older valid quote', async () => {
    const now = new Date()
    const rows: StoredRate[] = [
      {
        rate: 12_900,
        source: 'CBU',
        effectiveDate: null,
        fetchedAt: new Date(now.getTime() - 1_000),
      },
      {
        rate: 999_999,
        source: 'CBU',
        effectiveDate: new Date(now.getTime() - 10_000),
        fetchedAt: new Date(now.getTime() - 2_000),
      },
      {
        rate: 12_650.25,
        source: 'CBU',
        effectiveDate: new Date(now.getTime() - 20_000),
        fetchedAt: new Date(now.getTime() - 3_000),
      },
    ]

    mocks.currencyRateFindFirst.mockImplementation(async (query: {
      where: {
        source: string | { in: string[] }
        effectiveDate: { not: null }
        rate: { gte: number; lte: number }
      }
    }) => {
      const acceptedSources = typeof query.where.source === 'string'
        ? [query.where.source]
        : query.where.source.in
      return rows
        .filter((row) => acceptedSources.includes(row.source))
        .filter((row) => query.where.effectiveDate.not === null && row.effectiveDate !== null)
        .filter((row) => row.rate >= query.where.rate.gte && row.rate <= query.where.rate.lte)
        .sort((left, right) => right.fetchedAt.getTime() - left.fetchedAt.getTime())[0] ?? null
    })

    const snapshot = await getStoredUsdUzsRateSnapshot()

    expect(snapshot).toMatchObject({
      rate: 12_650.25,
      source: 'CBU',
      freshness: 'FRESH',
    })
    expect(mocks.currencyRateFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        source: 'CBU',
        effectiveDate: { not: null },
        rate: { gte: 1_000, lte: 100_000 },
      }),
      orderBy: { fetchedAt: 'desc' },
    }))
  })
})
