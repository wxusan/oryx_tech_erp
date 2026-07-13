export type CurrencyCode = 'UZS' | 'USD'

export interface CurrencyContext {
  currency: CurrencyCode
  usdUzsRate: number | null
}

export const BASE_CURRENCY: CurrencyCode = 'UZS'
export const MAX_STORABLE_MONEY = 9_999_999_999

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === 'UZS' || value === 'USD'
}

// Amounts (AND rates) may arrive as strings — Prisma Decimal columns
// serialize to a string over JSON (e.g. device.purchasePrice from
// /api/devices, but also Sale.contractExchangeRateAtCreation,
// Device.purchaseExchangeRateAtCreation, CurrencyRate.rate). The `amount`
// parameter was already coerced; `rate` was not, which meant
// `assertRate()` — using the strict, non-coercing `Number.isFinite` — threw
// "USD kursi noto'g'ri" for a perfectly valid rate that just happened to
// still be a string, crashing any caller that passed a raw
// `contractExchangeRateAtCreation`/`purchaseExchangeRateAtCreation` field
// straight through (e.g. the device detail page's profit calculation for a
// USD-native sale of a UZS-purchased device). Coerce both.
export function convertUsdToUzs(amountUsd: number | string, rate: number | string): number {
  const usd = Number(amountUsd)
  const r = Number(rate)
  assertMoney(usd, 'USD amount')
  assertRate(r)
  return Math.round(usd * r)
}

export function convertUzsToUsd(amountUzs: number | string, rate: number | string): number {
  const uzs = Number(amountUzs)
  const r = Number(rate)
  assertMoney(uzs, 'UZS amount')
  assertRate(r)
  return uzs / r
}

export function normalizeMoneyInput(
  amount: number,
  currency: CurrencyCode,
  rate: number | null | undefined,
): {
  amountUzs: number
  inputCurrency: CurrencyCode
  exchangeRateUsed: number | null
} {
  assertMinorUnits(amount, currency)
  if (currency === 'UZS') {
    assertMoney(amount, 'UZS amount')
    return {
      amountUzs: Math.round(amount),
      inputCurrency: 'UZS',
      exchangeRateUsed: null,
    }
  }
  if (!rate) throw new Error('USD kursi mavjud emas')
  return {
    amountUzs: convertUsdToUzs(amount, rate),
    inputCurrency: 'USD',
    exchangeRateUsed: rate,
  }
}

export function hasValidMinorUnits(value: number, currency: CurrencyCode): boolean {
  if (!Number.isFinite(value) || value < 0 || value > MAX_STORABLE_MONEY) return false
  return currency === 'UZS'
    ? Number.isInteger(value)
    : Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
}

export function assertMinorUnits(value: number, currency: CurrencyCode): void {
  if (!Number.isFinite(value) || value < 0) throw new Error('Summa noto\'g\'ri')
  if (value > MAX_STORABLE_MONEY) throw new Error('Summa saqlash chegarasidan oshib ketdi')
  if (!hasValidMinorUnits(value, currency)) {
    throw new Error(currency === 'UZS' ? "UZS summasi butun so'mda kiritilishi kerak" : 'USD summasi ko\'pi bilan 2 kasr xonali bo\'lishi kerak')
  }
}

export function formatMoneyByCurrency(amountUzs: number | string | null | undefined, currency: CurrencyCode, rate?: number | null): string {
  return formatUserFacingMoney({
    amount: amountUzs,
    amountCurrency: 'UZS',
    displayCurrency: currency,
    rate,
  })
}

export function formatMoneyWithBase(amountUzs: number | string | null | undefined, currency: CurrencyCode, rate?: number | null): string {
  const value = Number(amountUzs ?? 0)
  if (currency !== 'USD') return formatUzs(value)
  if (!rate || rate <= 0) return `${formatUzs(value)} (USD kursi mavjud emas)`
  return `${formatUsd(convertUzsToUsd(value, rate))} (~${formatUzs(value)})`
}

export function formatUserFacingMoney({
  amount,
  amountCurrency,
  displayCurrency,
  rate,
}: {
  amount: number | string | null | undefined
  amountCurrency: CurrencyCode
  displayCurrency: CurrencyCode
  rate?: number | string | null
}): string {
  if (amount === null || amount === undefined) return '—'
  const value = Number(amount ?? 0)
  const r = rate == null ? null : Number(rate)

  if (!Number.isFinite(value)) return '—'
  if (amountCurrency === displayCurrency) {
    return displayCurrency === 'USD' ? formatUsd(value) : formatUzs(value)
  }
  if (!r || r <= 0 || !Number.isFinite(r)) return '—'
  if (amountCurrency === 'USD') return formatUzs(convertUsdToUzs(value, r))
  return formatUsd(convertUzsToUsd(value, r))
}

export function currencyLabel(currency: CurrencyCode) {
  return currency === 'USD' ? 'USD' : "so'm"
}

/**
 * Format an aggregate that can contain both UZS and USD without ever adding
 * unlike units. With a valid rate it renders one preferred-currency total;
 * without a rate it honestly renders the two native partitions.
 */
export function formatPartitionedMoney({
  amountUzs,
  amountUsd,
  displayCurrency,
  rate,
}: {
  amountUzs: number | string | null | undefined
  amountUsd: number | string | null | undefined
  displayCurrency: CurrencyCode
  rate?: number | string | null
}): string {
  const uzs = Number(amountUzs ?? 0)
  const usd = Number(amountUsd ?? 0)
  const parsedRate = rate == null ? null : Number(rate)
  if (!Number.isFinite(uzs) || !Number.isFinite(usd)) return '—'
  if (usd === 0) return displayCurrency === 'USD' && parsedRate
    ? formatUsd(convertUzsToUsd(uzs, parsedRate))
    : formatUzs(uzs)
  if (uzs === 0 && displayCurrency === 'USD') return formatUsd(usd)
  if (parsedRate && parsedRate > 0 && Number.isFinite(parsedRate)) {
    const totalUzs = uzs + convertUsdToUzs(usd, parsedRate)
    return displayCurrency === 'USD' ? formatUsd(convertUzsToUsd(totalUzs, parsedRate)) : formatUzs(totalUzs)
  }
  return [uzs !== 0 ? formatUzs(uzs) : null, usd !== 0 ? formatUsd(usd) : null].filter(Boolean).join(' + ')
}

function formatUzs(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} so'm`
}

function formatUsd(value: number) {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function assertMoney(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} noto'g'ri`)
}

function assertRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("USD kursi noto'g'ri")
}
