import {
  convertUsdToUzs,
  convertUzsToUsd,
  formatPartitionedMoney,
  formatUserFacingMoney,
  type CurrencyCode,
  type CurrencyContext,
} from '@/lib/currency'

export interface NativeAdminMoney {
  uzs: number
  usd: number
}

export interface AdminReportingContext {
  selectedDisplayCurrency: CurrencyCode
  conversion: {
    usdUzsRate: number | null
    source: string | null
    fetchedAt: string | null
    status: 'AVAILABLE' | 'UNAVAILABLE'
  }
}

export interface HistoricalAdminMoney {
  native: NativeAdminMoney
  snapshots: NativeAdminMoney
  complete: Record<CurrencyCode, boolean>
  count: number
}

export interface ShopPaymentAggregateGroup {
  currency: CurrencyCode
  _sum: {
    amount: unknown
    amountUzsSnapshot: unknown
    amountUsdSnapshot: unknown
  }
  _count: {
    id: number
    amountUzsSnapshot: number
    amountUsdSnapshot: number
  }
}

const number = (value: unknown) => Number(value ?? 0)

export function adminReportingContext(currency: CurrencyContext): AdminReportingContext {
  return {
    selectedDisplayCurrency: currency.currency,
    conversion: {
      usdUzsRate: currency.usdUzsRate,
      source: currency.usdUzsRateSource ?? null,
      fetchedAt: currency.usdUzsRateFetchedAt ?? null,
      status: currency.usdUzsRate ? 'AVAILABLE' : 'UNAVAILABLE',
    },
  }
}

export function summarizeShopPaymentGroups(groups: readonly ShopPaymentAggregateGroup[]): HistoricalAdminMoney {
  const result: HistoricalAdminMoney = {
    native: { uzs: 0, usd: 0 },
    snapshots: { uzs: 0, usd: 0 },
    complete: { UZS: true, USD: true },
    count: 0,
  }

  for (const group of groups) {
    const count = Number(group._count.id ?? 0)
    result.count += count
    if (group.currency === 'USD') result.native.usd += number(group._sum.amount)
    else result.native.uzs += number(group._sum.amount)
    result.snapshots.uzs += number(group._sum.amountUzsSnapshot)
    result.snapshots.usd += number(group._sum.amountUsdSnapshot)
    if (Number(group._count.amountUzsSnapshot ?? 0) !== count) result.complete.UZS = false
    if (Number(group._count.amountUsdSnapshot ?? 0) !== count) result.complete.USD = false
  }

  return result
}

export function buildShopPaymentSnapshots(amount: number, currency: CurrencyCode, rate: number | null) {
  const amountUzsSnapshot = currency === 'UZS'
    ? Math.round(amount)
    : rate
      ? convertUsdToUzs(amount, rate)
      : null
  const amountUsdSnapshot = currency === 'USD'
    ? Math.round(amount * 100) / 100
    : rate
      ? Math.round(convertUzsToUsd(amount, rate) * 100) / 100
      : null

  return {
    exchangeRateAtPayment: rate,
    amountUzsSnapshot,
    amountUsdSnapshot,
    currencyReconstructionStatus: amountUzsSnapshot !== null && amountUsdSnapshot !== null
      ? 'COMPLETE' as const
      : 'PARTIAL' as const,
  }
}

export function historicalAdminMoneyValue(value: HistoricalAdminMoney, displayCurrency: CurrencyCode) {
  if (!value.complete[displayCurrency]) return null
  return displayCurrency === 'USD' ? value.snapshots.usd : value.snapshots.uzs
}

export function expectedAdminMoneyValue(value: NativeAdminMoney, currency: CurrencyContext) {
  if (currency.currency === 'UZS') {
    if (value.usd === 0) return value.uzs
    if (!currency.usdUzsRate) return null
    return value.uzs + convertUsdToUzs(value.usd, currency.usdUzsRate)
  }
  if (value.uzs === 0) return value.usd
  if (!currency.usdUzsRate) return null
  return value.usd + convertUzsToUsd(value.uzs, currency.usdUzsRate)
}

export function formatNativeAdminMoney(value: NativeAdminMoney) {
  const parts = [
    value.uzs !== 0
      ? formatUserFacingMoney({ amount: value.uzs, amountCurrency: 'UZS', displayCurrency: 'UZS' })
      : null,
    value.usd !== 0
      ? formatUserFacingMoney({ amount: value.usd, amountCurrency: 'USD', displayCurrency: 'USD' })
      : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' + ') : formatUserFacingMoney({ amount: 0, amountCurrency: 'UZS', displayCurrency: 'UZS' })
}

export function formatHistoricalAdminMoney(value: HistoricalAdminMoney, currency: CurrencyContext) {
  const displayValue = historicalAdminMoneyValue(value, currency.currency)
  if (displayValue === null) return formatNativeAdminMoney(value.native)
  return formatUserFacingMoney({
    amount: displayValue,
    amountCurrency: currency.currency,
    displayCurrency: currency.currency,
  })
}

export function formatExpectedAdminMoney(value: NativeAdminMoney, currency: CurrencyContext) {
  return formatPartitionedMoney({
    amountUzs: value.uzs,
    amountUsd: value.usd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
}

export function formatAdminPaymentRow(
  payment: {
    amount: number | string
    currency: CurrencyCode
    amountUzsSnapshot?: number | string | null
    amountUsdSnapshot?: number | string | null
  },
  currency: CurrencyContext,
) {
  const snapshot = currency.currency === 'USD' ? payment.amountUsdSnapshot : payment.amountUzsSnapshot
  if (snapshot !== null && snapshot !== undefined) {
    return formatUserFacingMoney({
      amount: snapshot,
      amountCurrency: currency.currency,
      displayCurrency: currency.currency,
    })
  }
  return formatUserFacingMoney({
    amount: payment.amount,
    amountCurrency: payment.currency,
    displayCurrency: payment.currency,
  })
}
