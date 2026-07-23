import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUsdUzsRateSnapshotMock } = vi.hoisted(() => ({ getUsdUzsRateSnapshotMock: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/currency', () => ({
  getUsdUzsRateSnapshot: getUsdUzsRateSnapshotMock,
  isOperationalUsdUzsRate: (value: unknown) => {
    const rate = Number(value)
    return Number.isFinite(rate) && rate >= 1_000 && rate <= 100_000
  },
}))

import {
  createMoneyInputConverter,
  moneyInputToUzsForContract,
} from '@/lib/server/money-input'

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

  it('uses the frozen contract quote only as a reporting fallback for USD-to-USD', async () => {
    const result = await moneyInputToUzsForContract({
      amount: 25,
      inputCurrency: 'USD',
      contractCurrency: 'USD',
      contractExchangeRateAtCreation: '12500.0000',
      currencyContext: {
        currency: 'UZS',
        usdUzsRate: null,
        fxQuote: {
          baseCurrency: 'USD',
          quoteCurrency: 'UZS',
          rate: null,
          rateMinorUnits: null,
          source: null,
          effectiveAt: null,
          fetchedAt: null,
          freshness: 'UNAVAILABLE',
        },
      },
    })

    expect(getUsdUzsRateSnapshotMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      amountUzs: 312_500,
      inputCurrency: 'USD',
      exchangeRateUsed: null,
      exchangeRateSource: 'UNAVAILABLE_SAME_CURRENCY',
      exchangeRateEffectiveAt: null,
      exchangeRateFetchedAt: null,
    })
  })

  it('copies an immediately available governed quote without calling the provider path', async () => {
    const result = await moneyInputToUzsForContract({
      amount: 25,
      inputCurrency: 'USD',
      contractCurrency: 'USD',
      contractExchangeRateAtCreation: 12_000,
      currencyContext: {
        currency: 'UZS',
        usdUzsRate: 12_500,
        fxQuote: {
          baseCurrency: 'USD',
          quoteCurrency: 'UZS',
          rate: '12500.0000',
          rateMinorUnits: 125_000_000,
          source: 'CBU',
          effectiveAt: '2026-07-22T00:00:00.000Z',
          fetchedAt: '2026-07-22T00:00:01.000Z',
          freshness: 'FRESH',
        },
      },
    })

    expect(getUsdUzsRateSnapshotMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      amountUzs: 312_500,
      exchangeRateUsed: 12_500,
      exchangeRateSource: 'CBU',
      exchangeRateEffectiveAt: new Date('2026-07-22T00:00:00.000Z'),
      exchangeRateFetchedAt: new Date('2026-07-22T00:00:01.000Z'),
    })
  })
})
