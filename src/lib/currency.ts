export type CurrencyCode = 'UZS' | 'USD'

export interface CurrencyContext {
  currency: CurrencyCode
  usdUzsRate: number | null
  usdUzsRateSource?: string | null
  usdUzsRateFetchedAt?: string | null
  /** A client-safe, fixed-precision quote. `usdUzsRate` remains for older callers. */
  fxQuote?: FxQuoteDto | null
}

export const BASE_CURRENCY: CurrencyCode = 'UZS'
export const MAX_STORABLE_MONEY = 9_999_999_999

/**
 * The only money shape sent by new financial APIs.  UZS uses whole so'm;
 * USD uses cents.  This avoids leaking Prisma Decimal strings into React and
 * makes addition/comparison exact without floating-point rounding.
 */
export interface MoneyDto {
  currency: CurrencyCode
  minorUnits: number
}

/**
 * `FROZEN` is used for a historical payment quote. It was valid for that
 * receipt, but is deliberately not presented as a quote that is fresh today.
 */
export type FxQuoteFreshness = 'FRESH' | 'FALLBACK' | 'UNAVAILABLE' | 'FROZEN'

/**
 * USD/UZS quote represented at a fixed four decimal places.  `rate` is an
 * exact normalized string (for example `12650.2500`); `rateMinorUnits` is
 * supplied for exact server/client conversion helpers.
 */
export interface FxQuoteDto {
  baseCurrency: 'USD'
  quoteCurrency: 'UZS'
  rate: string | null
  rateMinorUnits: number | null
  source: string | null
  effectiveAt: string | null
  fetchedAt: string | null
  freshness: FxQuoteFreshness
}

const USD_MINOR_UNIT_SCALE = 100
const UZS_MINOR_UNIT_SCALE = 1
const FX_RATE_SCALE = 10_000

export function moneyMinorUnitScale(currency: CurrencyCode): number {
  return currency === 'USD' ? USD_MINOR_UNIT_SCALE : UZS_MINOR_UNIT_SCALE
}

function invalidMoney(): never {
  throw new Error("Summa noto'g'ri")
}

/** Parse a stored/input amount without silently accepting unsupported precision. */
export function moneyMinorUnitsFromAmount(value: number | string, currency: CurrencyCode): number {
  const scale = moneyMinorUnitScale(currency)

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > MAX_STORABLE_MONEY) invalidMoney()
    const scaled = value * scale
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-8) {
      throw new Error(currency === 'USD' ? "USD summasi ko'pi bilan 2 kasr xonali bo'lishi kerak" : "UZS summasi butun so'mda kiritilishi kerak")
    }
    return Math.round(scaled)
  }

  const normalized = value.trim()
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) invalidMoney()
  const [wholePart, rawFractionalPart = ''] = normalized.split('.')
  const allowedFractionDigits = currency === 'USD' ? 2 : 0
  // Prisma Decimal may serialize a whole-so'm value as "100.00". It is
  // still exact at the currency's permitted precision, so accept surplus
  // trailing zeroes while rejecting any meaningful unsupported fraction.
  if (
    rawFractionalPart.length > allowedFractionDigits &&
    /[^0]/.test(rawFractionalPart.slice(allowedFractionDigits))
  ) {
    throw new Error(currency === 'USD' ? "USD summasi ko'pi bilan 2 kasr xonali bo'lishi kerak" : "UZS summasi butun so'mda kiritilishi kerak")
  }
  const fractionalPart = rawFractionalPart.slice(0, allowedFractionDigits)
  const whole = Number(wholePart)
  if (!Number.isSafeInteger(whole) || whole > MAX_STORABLE_MONEY) invalidMoney()
  const fraction = fractionalPart.length === 0 ? 0 : Number(fractionalPart.padEnd(currency === 'USD' ? 2 : 0, '0'))
  const minorUnits = whole * scale + fraction
  if (!Number.isSafeInteger(minorUnits) || minorUnits > MAX_STORABLE_MONEY * scale) invalidMoney()
  return minorUnits
}

export function createMoneyDto(currency: CurrencyCode, amount: number | string): MoneyDto {
  return { currency, minorUnits: moneyMinorUnitsFromAmount(amount, currency) }
}

export function assertMoneyDto(value: MoneyDto): MoneyDto {
  if (!isCurrencyCode(value?.currency) || !Number.isSafeInteger(value.minorUnits) || value.minorUnits < 0) invalidMoney()
  const maxMinorUnits = MAX_STORABLE_MONEY * moneyMinorUnitScale(value.currency)
  if (value.minorUnits > maxMinorUnits) invalidMoney()
  return value
}

export function moneyDtoToAmount(value: MoneyDto): number {
  const money = assertMoneyDto(value)
  return money.minorUnits / moneyMinorUnitScale(money.currency)
}

export function addMoneyDto(left: MoneyDto, right: MoneyDto): MoneyDto {
  assertMoneyDto(left)
  assertMoneyDto(right)
  if (left.currency !== right.currency) throw new Error("Turli valyutadagi summalarni qo'shib bo'lmaydi")
  const minorUnits = left.minorUnits + right.minorUnits
  return assertMoneyDto({ currency: left.currency, minorUnits })
}

export function subtractMoneyDto(left: MoneyDto, right: MoneyDto): MoneyDto {
  assertMoneyDto(left)
  assertMoneyDto(right)
  if (left.currency !== right.currency) throw new Error("Turli valyutadagi summalarni ayirib bo'lmaydi")
  if (left.minorUnits < right.minorUnits) throw new Error("Summa manfiy bo'lishi mumkin emas")
  return { currency: left.currency, minorUnits: left.minorUnits - right.minorUnits }
}

export function moneyDtoEquals(left: MoneyDto, right: MoneyDto): boolean {
  return left.currency === right.currency && left.minorUnits === right.minorUnits
}

export function formatMoneyDto(value: MoneyDto): string {
  const amount = moneyDtoToAmount(value)
  return value.currency === 'USD' ? formatUsd(amount) : formatUzs(amount)
}

function rateMinorUnitsFromValue(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw new Error("USD kursi noto'g'ri")
    const scaled = value * FX_RATE_SCALE
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      throw new Error("USD kursi 4 kasr xonali bo'lishi kerak")
    }
    return Math.round(scaled)
  }
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) throw new Error("USD kursi noto'g'ri")
  const [wholePart, fractionPart = ''] = normalized.split('.')
  const whole = Number(wholePart)
  if (!Number.isSafeInteger(whole) || whole <= 0) throw new Error("USD kursi noto'g'ri")
  const minorUnits = whole * FX_RATE_SCALE + Number(fractionPart.padEnd(4, '0'))
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) throw new Error("USD kursi noto'g'ri")
  return minorUnits
}

function formatRateMinorUnits(minorUnits: number): string {
  const whole = Math.floor(minorUnits / FX_RATE_SCALE)
  const fractional = String(minorUnits % FX_RATE_SCALE).padStart(4, '0')
  return `${whole}.${fractional}`
}

export function createFxQuoteDto({
  rate,
  source = null,
  effectiveAt = null,
  fetchedAt = null,
  freshness,
}: {
  rate: number | string | null
  source?: string | null
  effectiveAt?: string | null
  fetchedAt?: string | null
  freshness?: FxQuoteFreshness
}): FxQuoteDto {
  if (rate == null) {
    return {
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      rate: null,
      rateMinorUnits: null,
      source,
      effectiveAt,
      fetchedAt,
      freshness: freshness ?? 'UNAVAILABLE',
    }
  }
  const rateMinorUnits = rateMinorUnitsFromValue(rate)
  return {
    baseCurrency: 'USD',
    quoteCurrency: 'UZS',
    rate: formatRateMinorUnits(rateMinorUnits),
    rateMinorUnits,
    source,
    effectiveAt,
    fetchedAt,
    freshness: freshness ?? 'FRESH',
  }
}

export function fxQuoteRate(value: FxQuoteDto | null | undefined): number | null {
  if (!value || value.rateMinorUnits == null || value.rateMinorUnits <= 0) return null
  return value.rateMinorUnits / FX_RATE_SCALE
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator
}

/** Convert only with an explicit frozen/current quote; never invent a rate. */
export function convertMoneyDto(value: MoneyDto, targetCurrency: CurrencyCode, quote: FxQuoteDto | null | undefined): MoneyDto | null {
  const money = assertMoneyDto(value)
  if (money.currency === targetCurrency) return { ...money }
  if (!quote || quote.baseCurrency !== 'USD' || quote.quoteCurrency !== 'UZS' || !quote.rateMinorUnits || quote.rateMinorUnits <= 0) {
    return null
  }
  const rate = BigInt(quote.rateMinorUnits)
  const source = BigInt(money.minorUnits)
  const converted = money.currency === 'USD'
    ? divideRoundHalfUp(source * rate, BigInt(USD_MINOR_UNIT_SCALE * FX_RATE_SCALE))
    : divideRoundHalfUp(source * BigInt(USD_MINOR_UNIT_SCALE * FX_RATE_SCALE), rate)
  if (converted > BigInt(Number.MAX_SAFE_INTEGER)) invalidMoney()
  return assertMoneyDto({ currency: targetCurrency, minorUnits: Number(converted) })
}

/**
 * Convert a native upper bound into the largest target-currency amount that
 * still converts back to no more than that bound. This matters for editable
 * refund limits: a rounded USD display value must never become one so'm more
 * than the verified native receipts when it is submitted back to the server.
 */
export function convertMoneyDtoAtMost(
  value: MoneyDto,
  targetCurrency: CurrencyCode,
  quote: FxQuoteDto | null | undefined,
): MoneyDto | null {
  const source = assertMoneyDto(value)
  const converted = convertMoneyDto(source, targetCurrency, quote)
  if (!converted || source.currency === targetCurrency) return converted

  let targetMinorUnits = converted.minorUnits
  while (targetMinorUnits > 0) {
    const roundTrip = convertMoneyDto(
      { currency: targetCurrency, minorUnits: targetMinorUnits },
      source.currency,
      quote,
    )
    if (!roundTrip || roundTrip.minorUnits <= source.minorUnits) break
    targetMinorUnits -= 1
  }
  return { currency: targetCurrency, minorUnits: targetMinorUnits }
}

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
  // Every persisted money command goes through the exact minor-unit boundary
  // first. In particular, do not use `amount * rate` here: a USD-cent input
  // and a four-decimal governed rate must produce the same rounded UZS value
  // on every runtime, without IEEE-754 drift.
  const input = createMoneyDto(currency, amount)
  if (currency === 'UZS') {
    return {
      amountUzs: moneyDtoToAmount(input),
      inputCurrency: 'UZS',
      exchangeRateUsed: null,
    }
  }
  if (!rate) throw new Error('USD kursi mavjud emas')
  const quote = createFxQuoteDto({ rate, source: 'INPUT_CONVERSION', freshness: 'FROZEN' })
  const converted = convertMoneyDto(input, 'UZS', quote)
  if (!converted) throw new Error('USD kursi mavjud emas')
  return {
    amountUzs: moneyDtoToAmount(converted),
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
