import 'server-only'

import { cache } from 'react'
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createFxQuoteDto, type CurrencyCode, type CurrencyContext, type FxQuoteFreshness } from '@/lib/currency'
import { timeRequestPhase } from '@/lib/server/request-context'

const CBU_USD_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/'
const RATE_TTL_MS = 12 * 60 * 60 * 1000
const MAX_FALLBACK_RATE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const CBU_TIMEOUT_MS = 2_000
export const MIN_USD_UZS_RATE = 1_000
export const MAX_USD_UZS_RATE = 100_000

interface CbuRate {
  Ccy?: string
  Rate?: string
  Date?: string
}

export class CurrencyRateUnavailableError extends Error {
  constructor() {
    super('USD kursi mavjud emas')
  }
}

export const getShopCurrencyContext = cache(async function getShopCurrencyContext(shopId: string): Promise<CurrencyContext> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { preferredCurrency: true },
  })
  const currency = (shop?.preferredCurrency ?? 'UZS') as CurrencyCode
  // The preferred currency controls presentation, not which contract
  // currencies may appear. A UZS-preferred shop can still have USD-native
  // debt, so every context carries the best governed USD/UZS rate available.
  const snapshot = await getStoredUsdUzsRateSnapshot()
  return snapshot
    ? currencyContextFromSnapshot(currency, snapshot)
    : unavailableCurrencyContext(currency)
})

export const getSuperAdminCurrencyContext = cache(async function getSuperAdminCurrencyContext(superAdminId: string): Promise<CurrencyContext> {
  const admin = await prisma.superAdmin.findUnique({
    where: { id: superAdminId },
    select: { preferredCurrency: true },
  })
  const currency = (admin?.preferredCurrency ?? 'UZS') as CurrencyCode
  const snapshot = await getStoredUsdUzsRateSnapshot()
  return snapshot
    ? currencyContextFromSnapshot(currency, snapshot)
    : unavailableCurrencyContext(currency)
})

export async function getUsdUzsRate(): Promise<number> {
  return (await getUsdUzsRateSnapshot()).rate
}

export interface UsdUzsRateSnapshot {
  rate: number
  source: string
  effectiveAt: Date | null
  fetchedAt: Date
  freshness: Exclude<FxQuoteFreshness, 'UNAVAILABLE'>
}

/**
 * Read-only presentation path: return a governed stored quote immediately and
 * refresh after the response. It never waits on the CBU network. Financial
 * mutations that actually require conversion must use getUsdUzsRateSnapshot.
 */
export async function getStoredUsdUzsRateSnapshot(): Promise<UsdUzsRateSnapshot | null> {
  const latestCbu = await latestStoredUsdRate('CBU')
  const cbuAgeMs = latestCbu ? Date.now() - latestCbu.fetchedAt.getTime() : Number.POSITIVE_INFINITY
  if (latestCbu && isOperationalUsdUzsRate(latestCbu.rate) && cbuAgeMs <= RATE_TTL_MS) {
    return {
      rate: Number(latestCbu.rate),
      source: latestCbu.source,
      effectiveAt: latestCbu.effectiveDate,
      fetchedAt: latestCbu.fetchedAt,
      freshness: 'FRESH',
    }
  }

  const fallback = latestCbu && isOperationalUsdUzsRate(latestCbu.rate) && cbuAgeMs <= MAX_FALLBACK_RATE_AGE_MS
    ? latestCbu
    : await latestStoredUsdRate()
  scheduleUsdUzsRateRefresh()
  if (
    !fallback
    || !isOperationalUsdUzsRate(fallback.rate)
    || Date.now() - fallback.fetchedAt.getTime() > MAX_FALLBACK_RATE_AGE_MS
  ) {
    return null
  }
  return {
    rate: Number(fallback.rate),
    source: fallback.source,
    effectiveAt: fallback.effectiveDate,
    fetchedAt: fallback.fetchedAt,
    freshness: 'FALLBACK',
  }
}

export async function getUsdUzsRateSnapshot(): Promise<UsdUzsRateSnapshot> {
  const latestCbu = await latestStoredUsdRate('CBU')
  if (latestCbu && isOperationalUsdUzsRate(latestCbu.rate) && Date.now() - latestCbu.fetchedAt.getTime() <= RATE_TTL_MS) {
    return {
      rate: Number(latestCbu.rate),
      source: latestCbu.source,
      effectiveAt: latestCbu.effectiveDate,
      fetchedAt: latestCbu.fetchedAt,
      freshness: 'FRESH',
    }
  }

  const fallback = latestCbu &&
    isOperationalUsdUzsRate(latestCbu.rate) &&
    Date.now() - latestCbu.fetchedAt.getTime() <= MAX_FALLBACK_RATE_AGE_MS
    ? latestCbu
    : await latestStoredUsdRate()

  // A list route should never wait for the CBU network when a governed stored
  // quote is available. Return it immediately and refresh after the response.
  if (
    fallback &&
    isOperationalUsdUzsRate(fallback.rate) &&
    Date.now() - fallback.fetchedAt.getTime() <= MAX_FALLBACK_RATE_AGE_MS
  ) {
    scheduleUsdUzsRateRefresh()
    return {
      rate: Number(fallback.rate),
      source: fallback.source,
      effectiveAt: fallback.effectiveDate,
      fetchedAt: fallback.fetchedAt,
      freshness: 'FALLBACK',
    }
  }

  try {
    const rate = await timeRequestPhase('currency-refresh', () => refreshUsdUzsRate())
    const refreshed = await latestStoredUsdRate('CBU')
    return {
      rate,
      source: refreshed?.source ?? 'CBU',
      effectiveAt: refreshed?.effectiveDate ?? null,
      fetchedAt: refreshed?.fetchedAt ?? new Date(),
      freshness: 'FRESH',
    }
  } catch (err) {
    await logRateFailure(err)
    const latest = await latestStoredUsdRate()
    if (
      latest &&
      isOperationalUsdUzsRate(latest.rate) &&
      Date.now() - latest.fetchedAt.getTime() <= MAX_FALLBACK_RATE_AGE_MS
    ) return {
      rate: Number(latest.rate),
      source: latest.source,
      effectiveAt: latest.effectiveDate,
      fetchedAt: latest.fetchedAt,
      freshness: 'FALLBACK',
    }
    throw new CurrencyRateUnavailableError()
  }
}

export async function refreshUsdUzsRate(): Promise<number> {
  const response = await fetch(CBU_USD_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(CBU_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`CBU rate fetch failed: ${response.status}`)

  const json = (await response.json()) as CbuRate[]
  const item = json.find((row) => row.Ccy === 'USD') ?? json[0]
  const rate = Number(String(item?.Rate ?? '').replace(',', '.'))
  if (!isOperationalUsdUzsRate(rate)) throw new Error('CBU USD rate response is outside the approved range')
  const effectiveDate = parseCbuDate(item?.Date)
  if (!effectiveDate) throw new Error('CBU USD rate response has no valid effective date')
  const providerReference = `CBU:USD:${effectiveDate.toISOString().slice(0, 10)}:${rate.toFixed(4)}`

  await prisma.currencyRate.create({
    data: {
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      rate,
      source: 'CBU',
      fetchedAt: new Date(),
      effectiveDate,
      providerReference,
      recordedById: null,
      recordedByType: null,
      evidenceVersion: 2,
      evidenceStatus: 'CAPTURED',
    },
  })

  return rate
}

let refreshInFlight: Promise<void> | null = null

function scheduleUsdUzsRateRefresh() {
  const refresh = async () => {
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = refreshUsdUzsRate()
      .then(() => undefined)
      .catch(logRateFailure)
      .finally(() => { refreshInFlight = null })
    return refreshInFlight
  }

  try {
    after(refresh)
  } catch {
    // Direct service tests do not have a Next request lifecycle.
    void refresh()
  }
}

export function isOperationalUsdUzsRate(value: unknown): boolean {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < MIN_USD_UZS_RATE || rate > MAX_USD_UZS_RATE) return false
  const scaled = rate * 10_000
  return Number.isSafeInteger(Math.round(scaled))
    && Math.abs(scaled - Math.round(scaled)) <= 1e-6
}

async function latestStoredUsdRate(source?: 'CBU' | 'MANUAL') {
  return prisma.currencyRate.findFirst({
    // A stored row is eligible for a new financial mutation only when its
    // provider is governed and its effective instant is known. Legacy rows
    // without that minimum provenance remain readable audit history, but must
    // never be copied into a new v2 receipt and rejected later by the DB.
    where: {
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      source: source ?? { in: ['CBU', 'MANUAL'] },
      effectiveDate: { not: null },
      // Filter eligibility in SQL. Otherwise one newer invalid legacy row can
      // mask an older usable quote and make a financial write fail during a
      // temporary CBU outage.
      rate: { gte: MIN_USD_UZS_RATE, lte: MAX_USD_UZS_RATE },
    },
    orderBy: { fetchedAt: 'desc' },
    select: { rate: true, source: true, effectiveDate: true, fetchedAt: true },
  })
}

function currencyContextFromSnapshot(currency: CurrencyCode, snapshot: UsdUzsRateSnapshot): CurrencyContext {
  const fxQuote = createFxQuoteDto({
    rate: snapshot.rate,
    source: snapshot.source,
    effectiveAt: snapshot.effectiveAt?.toISOString() ?? null,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    freshness: snapshot.freshness,
  })
  return {
    currency,
    usdUzsRate: snapshot.rate,
    usdUzsRateSource: snapshot.source,
    usdUzsRateFetchedAt: snapshot.fetchedAt.toISOString(),
    fxQuote,
  }
}

function unavailableCurrencyContext(currency: CurrencyCode): CurrencyContext {
  return {
    currency,
    usdUzsRate: null,
    usdUzsRateSource: null,
    usdUzsRateFetchedAt: null,
    fxQuote: createFxQuoteDto({ rate: null, freshness: 'UNAVAILABLE' }),
  }
}

async function logRateFailure(err: unknown) {
  try {
    await prisma.opsEvent.create({
      data: {
        level: 'WARN',
        event: 'currency.rate_fetch_failed',
        message: 'CBU USD/UZS rate fetch failed; using stored fallback if available',
        status: 'FAILED',
        errorCode: err instanceof Error ? err.name : 'UnknownError',
        metadata: { source: 'CBU' },
      },
    })
  } catch {
    // Currency display must not be taken down by observability failure.
  }
}

function parseCbuDate(value?: string) {
  if (!value) return null
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
  if (!match) return null
  const [, day, month, year] = match
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`)
}
