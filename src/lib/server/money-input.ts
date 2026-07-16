import 'server-only'

import { normalizeMoneyInput, type CurrencyCode } from '@/lib/currency'
import { getUsdUzsRateSnapshot } from '@/lib/server/currency'

/**
 * A conversion is a small immutable receipt snapshot, not just a number.
 * Existing callers can keep using `amountUzs`/`exchangeRateUsed`; new
 * financial writes also retain the governed provider and timestamps.
 */
export type MoneyInputResult = ReturnType<typeof normalizeMoneyInput> & {
  exchangeRateSource: string | null
  exchangeRateEffectiveAt: Date | null
  exchangeRateFetchedAt: Date | null
}

export async function moneyInputToUzs(
  amount: number,
  inputCurrency: CurrencyCode | undefined,
) {
  const currency = inputCurrency ?? 'UZS'
  const quote = currency === 'USD' ? await getUsdUzsRateSnapshot() : null
  return {
    ...normalizeMoneyInput(amount, currency, quote?.rate ?? null),
    exchangeRateSource: quote?.source ?? null,
    exchangeRateEffectiveAt: quote?.effectiveAt ?? null,
    exchangeRateFetchedAt: quote?.fetchedAt ?? null,
  }
}

/** Fetch one rate snapshot and reuse it for every amount in one operation. */
export async function createMoneyInputConverter(inputCurrency: CurrencyCode | undefined) {
  const currency = inputCurrency ?? 'UZS'
  const quote = currency === 'USD' ? await getUsdUzsRateSnapshot() : null
  return (amount: number): MoneyInputResult => ({
    ...normalizeMoneyInput(amount, currency, quote?.rate ?? null),
    exchangeRateSource: quote?.source ?? null,
    exchangeRateEffectiveAt: quote?.effectiveAt ?? null,
    exchangeRateFetchedAt: quote?.fetchedAt ?? null,
  })
}

export function moneyInputMeta(result: Awaited<ReturnType<typeof moneyInputToUzs>>) {
  return {
    inputCurrency: result.inputCurrency,
    exchangeRateUsed: result.exchangeRateUsed,
    exchangeRateSource: result.exchangeRateSource,
    exchangeRateEffectiveAt: result.exchangeRateEffectiveAt?.toISOString() ?? null,
    exchangeRateFetchedAt: result.exchangeRateFetchedAt?.toISOString() ?? null,
  }
}
