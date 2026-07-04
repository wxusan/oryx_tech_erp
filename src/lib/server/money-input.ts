import 'server-only'

import { normalizeMoneyInput, type CurrencyCode } from '@/lib/currency'
import { getUsdUzsRate } from '@/lib/server/currency'

export async function moneyInputToUzs(
  amount: number,
  inputCurrency: CurrencyCode | undefined,
) {
  const currency = inputCurrency ?? 'UZS'
  const rate = currency === 'USD' ? await getUsdUzsRate() : null
  return normalizeMoneyInput(amount, currency, rate)
}

export function moneyInputMeta(result: Awaited<ReturnType<typeof moneyInputToUzs>>) {
  return {
    inputCurrency: result.inputCurrency,
    exchangeRateUsed: result.exchangeRateUsed,
  }
}
