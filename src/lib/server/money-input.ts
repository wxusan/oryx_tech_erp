import 'server-only'

import {
  normalizeMoneyInput,
  type CurrencyCode,
  type CurrencyContext,
} from '@/lib/currency'
import {
  getUsdUzsRateSnapshot,
  isOperationalUsdUzsRate,
} from '@/lib/server/currency'

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
export type MoneyInputConverter = (amount: number) => MoneyInputResult

export async function moneyInputToUzs(
  amount: number,
  inputCurrency: CurrencyCode,
) {
  const quote = inputCurrency === 'USD' ? await getUsdUzsRateSnapshot() : null
  return {
    ...normalizeMoneyInput(amount, inputCurrency, quote?.rate ?? null),
    exchangeRateSource: quote?.source ?? null,
    exchangeRateEffectiveAt: quote?.effectiveAt ?? null,
    exchangeRateFetchedAt: quote?.fetchedAt ?? null,
  }
}

/**
 * Build a receipt snapshot when the parent contract is already known.
 *
 * Paying a USD contract with USD tender does not perform an FX conversion.
 * A governed stored quote may still be copied into the receipt for its legacy
 * UZS reporting mirror, but this path must never wait for a current provider
 * quote. If no eligible stored quote is immediately available, the immutable
 * contract-creation quote supplies only that reporting mirror and the receipt
 * truthfully records that no payment-time quote was captured.
 */
export async function moneyInputToUzsForContract(input: {
  amount: number
  inputCurrency: CurrencyCode
  contractCurrency: CurrencyCode
  contractExchangeRateAtCreation?: number | string | { toString(): string } | null
  currencyContext: CurrencyContext
}): Promise<MoneyInputResult> {
  if (input.inputCurrency !== 'USD' || input.contractCurrency !== 'USD') {
    return moneyInputToUzs(input.amount, input.inputCurrency)
  }

  const storedQuote = input.currencyContext.fxQuote
  const storedRate = storedQuote?.rate == null ? null : Number(storedQuote.rate)
  const storedEffectiveAt = parseQuoteDate(storedQuote?.effectiveAt)
  const storedFetchedAt = parseQuoteDate(storedQuote?.fetchedAt)
  const hasGovernedStoredQuote = (
    isOperationalUsdUzsRate(storedRate)
    && (storedQuote?.source === 'CBU' || storedQuote?.source === 'MANUAL')
    && storedEffectiveAt != null
    && storedFetchedAt != null
  )

  if (hasGovernedStoredQuote) {
    return {
      ...normalizeMoneyInput(input.amount, 'USD', storedRate),
      exchangeRateSource: storedQuote.source,
      exchangeRateEffectiveAt: storedEffectiveAt,
      exchangeRateFetchedAt: storedFetchedAt,
    }
  }

  const contractCreationRate = Number(input.contractExchangeRateAtCreation)
  if (!isOperationalUsdUzsRate(contractCreationRate)) {
    throw new Error('USD shartnoma uchun muzlatilgan kurs mavjud emas')
  }
  return {
    ...normalizeMoneyInput(input.amount, 'USD', contractCreationRate),
    // The creation quote proves the legacy UZS mirror, but it is not a
    // payment-time FX quote and must not be presented as one.
    exchangeRateUsed: null,
    exchangeRateSource: 'UNAVAILABLE_SAME_CURRENCY',
    exchangeRateEffectiveAt: null,
    exchangeRateFetchedAt: null,
  }
}

/** Fetch one rate snapshot and reuse it for every amount in one operation. */
export async function createMoneyInputConverter(inputCurrency: CurrencyCode) {
  const quote = inputCurrency === 'USD' ? await getUsdUzsRateSnapshot() : null
  return (amount: number): MoneyInputResult => ({
    ...normalizeMoneyInput(amount, inputCurrency, quote?.rate ?? null),
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

function parseQuoteDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
