import 'server-only'

import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { createFxQuoteDto, type CurrencyCode, type CurrencyContext, type FxQuoteFreshness } from '@/lib/currency'

const CBU_USD_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/'
const RATE_TTL_MS = 12 * 60 * 60 * 1000
const MAX_FALLBACK_RATE_AGE_MS = 7 * 24 * 60 * 60 * 1000
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
  try {
    const snapshot = await getUsdUzsRateSnapshot()
    return currencyContextFromSnapshot(currency, snapshot)
  } catch {
    return unavailableCurrencyContext(currency)
  }
})

export const getSuperAdminCurrencyContext = cache(async function getSuperAdminCurrencyContext(superAdminId: string): Promise<CurrencyContext> {
  const admin = await prisma.superAdmin.findUnique({
    where: { id: superAdminId },
    select: { preferredCurrency: true },
  })
  const currency = (admin?.preferredCurrency ?? 'UZS') as CurrencyCode
  try {
    const snapshot = await getUsdUzsRateSnapshot()
    return currencyContextFromSnapshot(currency, snapshot)
  } catch {
    return unavailableCurrencyContext(currency)
  }
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

  try {
    const rate = await refreshUsdUzsRate()
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
  })
  if (!response.ok) throw new Error(`CBU rate fetch failed: ${response.status}`)

  const json = (await response.json()) as CbuRate[]
  const item = json.find((row) => row.Ccy === 'USD') ?? json[0]
  const rate = Number(String(item?.Rate ?? '').replace(',', '.'))
  if (!isOperationalUsdUzsRate(rate)) throw new Error('CBU USD rate response is outside the approved range')

  await prisma.currencyRate.create({
    data: {
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      rate,
      source: 'CBU',
      fetchedAt: new Date(),
      effectiveDate: parseCbuDate(item?.Date),
    },
  })

  return rate
}

export function isOperationalUsdUzsRate(value: unknown): boolean {
  const rate = Number(value)
  return Number.isFinite(rate) && rate >= MIN_USD_UZS_RATE && rate <= MAX_USD_UZS_RATE
}

async function latestStoredUsdRate(source?: 'CBU' | 'MANUAL') {
  return prisma.currencyRate.findFirst({
    where: { baseCurrency: 'USD', quoteCurrency: 'UZS', ...(source ? { source } : {}) },
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
