export type CurrencyCode = 'UZS' | 'USD'

export interface CurrencyContext {
  currency: CurrencyCode
  usdUzsRate: number | null
}

export const BASE_CURRENCY: CurrencyCode = 'UZS'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === 'UZS' || value === 'USD'
}

// Amounts may arrive as strings — Prisma Decimal columns serialize to a string
// over JSON (e.g. device.purchasePrice from /api/devices). Coerce like
// formatMoneyByCurrency already does; the conversion math is unchanged.
export function convertUsdToUzs(amountUsd: number | string, rate: number): number {
  const usd = Number(amountUsd)
  assertMoney(usd, 'USD amount')
  assertRate(rate)
  return Math.round(usd * rate)
}

export function convertUzsToUsd(amountUzs: number | string, rate: number): number {
  const uzs = Number(amountUzs)
  assertMoney(uzs, 'UZS amount')
  assertRate(rate)
  return uzs / rate
}

export function normalizeMoneyInput(
  amount: number,
  currency: CurrencyCode,
  rate: number | null | undefined,
): { amountUzs: number; inputCurrency: CurrencyCode; exchangeRateUsed: number | null } {
  if (currency === 'UZS') {
    assertMoney(amount, 'UZS amount')
    return { amountUzs: Math.round(amount), inputCurrency: 'UZS', exchangeRateUsed: null }
  }
  if (!rate) throw new Error('USD kursi mavjud emas')
  return { amountUzs: convertUsdToUzs(amount, rate), inputCurrency: 'USD', exchangeRateUsed: rate }
}

export function formatMoneyByCurrency(
  amountUzs: number | string | null | undefined,
  currency: CurrencyCode,
  rate?: number | null,
): string {
  const value = Number(amountUzs ?? 0)
  if (currency === 'USD') {
    if (!rate || rate <= 0) return `${formatUzs(value)} (USD kursi mavjud emas)`
    return formatUsd(convertUzsToUsd(value, rate))
  }
  return formatUzs(value)
}

export function formatMoneyWithBase(
  amountUzs: number | string | null | undefined,
  currency: CurrencyCode,
  rate?: number | null,
): string {
  const value = Number(amountUzs ?? 0)
  if (currency !== 'USD') return formatUzs(value)
  if (!rate || rate <= 0) return `${formatUzs(value)} (USD kursi mavjud emas)`
  return `${formatUsd(convertUzsToUsd(value, rate))} (~${formatUzs(value)})`
}

export function currencyLabel(currency: CurrencyCode) {
  return currency === 'USD' ? 'USD' : "so'm"
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
