import { describe, expect, it } from 'vitest'
import {
  adminReportingContext,
  buildShopPaymentSnapshots,
  expectedAdminMoneyValue,
  formatHistoricalAdminMoney,
  historicalAdminMoneyValue,
  summarizeShopPaymentGroups,
} from '@/lib/admin-money'

describe('Super Admin currency-safe money', () => {
  it('labels the selected display currency and governed conversion evidence', () => {
    expect(adminReportingContext({
      currency: 'USD',
      usdUzsRate: 12_500,
      usdUzsRateSource: 'CBU',
      usdUzsRateFetchedAt: '2026-07-15T04:00:00.000Z',
    })).toEqual({
      selectedDisplayCurrency: 'USD',
      conversion: {
        usdUzsRate: 12_500,
        source: 'CBU',
        fetchedAt: '2026-07-15T04:00:00.000Z',
        status: 'AVAILABLE',
      },
    })
  })

  it('freezes both display snapshots at payment time', () => {
    expect(buildShopPaymentSnapshots(125_000, 'UZS', 12_500)).toEqual({
      exchangeRateAtPayment: 12_500,
      amountUzsSnapshot: 125_000,
      amountUsdSnapshot: 10,
      currencyReconstructionStatus: 'COMPLETE',
    })
    expect(buildShopPaymentSnapshots(10, 'USD', 12_500)).toEqual({
      exchangeRateAtPayment: 12_500,
      amountUzsSnapshot: 125_000,
      amountUsdSnapshot: 10,
      currencyReconstructionStatus: 'COMPLETE',
    })
  })

  it('keeps native evidence when the cross-currency rate is unavailable', () => {
    expect(buildShopPaymentSnapshots(125_000, 'UZS', null)).toMatchObject({
      amountUzsSnapshot: 125_000,
      amountUsdSnapshot: null,
      currencyReconstructionStatus: 'PARTIAL',
    })
    expect(buildShopPaymentSnapshots(10, 'USD', null)).toMatchObject({
      amountUzsSnapshot: null,
      amountUsdSnapshot: 10,
      currencyReconstructionStatus: 'PARTIAL',
    })
  })

  it('partitions mixed native currency and never adds unlike units', () => {
    const summary = summarizeShopPaymentGroups([
      {
        currency: 'UZS',
        _sum: { amount: 125_000, amountUzsSnapshot: 125_000, amountUsdSnapshot: 10 },
        _count: { id: 1, amountUzsSnapshot: 1, amountUsdSnapshot: 1 },
      },
      {
        currency: 'USD',
        _sum: { amount: 20, amountUzsSnapshot: 250_000, amountUsdSnapshot: 20 },
        _count: { id: 1, amountUzsSnapshot: 1, amountUsdSnapshot: 1 },
      },
    ])

    expect(summary.native).toEqual({ uzs: 125_000, usd: 20 })
    expect(summary.snapshots).toEqual({ uzs: 375_000, usd: 30 })
    expect(historicalAdminMoneyValue(summary, 'UZS')).toBe(375_000)
    expect(historicalAdminMoneyValue(summary, 'USD')).toBe(30)
    expect(formatHistoricalAdminMoney(summary, { currency: 'USD', usdUzsRate: 99_999 })).toBe('$30.00')
  })

  it('does not pretend an incomplete historical conversion is exact', () => {
    const summary = summarizeShopPaymentGroups([{
      currency: 'UZS',
      _sum: { amount: 125_000, amountUzsSnapshot: 125_000, amountUsdSnapshot: null },
      _count: { id: 1, amountUzsSnapshot: 1, amountUsdSnapshot: 0 },
    }])
    expect(summary.complete).toEqual({ UZS: true, USD: false })
    expect(historicalAdminMoneyValue(summary, 'USD')).toBeNull()
    expect(formatHistoricalAdminMoney(summary, { currency: 'USD', usdUzsRate: 12_500 })).toContain("so'm")
  })

  it('uses the governed current rate only for expected obligations', () => {
    expect(expectedAdminMoneyValue({ uzs: 125_000, usd: 10 }, { currency: 'UZS', usdUzsRate: 12_500 })).toBe(250_000)
    expect(expectedAdminMoneyValue({ uzs: 125_000, usd: 10 }, { currency: 'USD', usdUzsRate: 12_500 })).toBe(20)
    expect(expectedAdminMoneyValue({ uzs: 125_000, usd: 10 }, { currency: 'USD', usdUzsRate: null })).toBeNull()
  })
})
