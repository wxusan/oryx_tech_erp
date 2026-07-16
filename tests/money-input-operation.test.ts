import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUsdUzsRateSnapshotMock } = vi.hoisted(() => ({ getUsdUzsRateSnapshotMock: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/currency', () => ({ getUsdUzsRateSnapshot: getUsdUzsRateSnapshotMock }))

import { createMoneyInputConverter } from '@/lib/server/money-input'

describe('operation-scoped money conversion', () => {
  beforeEach(() => getUsdUzsRateSnapshotMock.mockReset())

  it('fetches one USD rate and freezes it across every amount in the operation', async () => {
    getUsdUzsRateSnapshotMock.mockResolvedValueOnce({
      rate: 12_500,
      source: 'CBU',
      effectiveAt: new Date('2026-07-16T00:00:00.000Z'),
      fetchedAt: new Date('2026-07-16T00:00:01.000Z'),
      freshness: 'FRESH',
    })
    const convert = await createMoneyInputConverter('USD')
    const purchase = convert(500)
    const sale = convert(800)
    const paid = convert(300)

    expect(getUsdUzsRateSnapshotMock).toHaveBeenCalledOnce()
    expect([purchase.exchangeRateUsed, sale.exchangeRateUsed, paid.exchangeRateUsed]).toEqual([12_500, 12_500, 12_500])
    expect([purchase.amountUzs, sale.amountUzs, paid.amountUzs]).toEqual([6_250_000, 10_000_000, 3_750_000])
  })
})
