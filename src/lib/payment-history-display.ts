import { formatMoneyDto, type FxQuoteDto, type MoneyDto } from '@/lib/currency'
import { exchangeRateSourceLabel } from '@/lib/presentation-labels'

export interface NasiyaPaymentDisplayRecord {
  id: string
  paymentMethod: string | null
  paidAt: string
  note: string | null
  nasiyaScheduleId: string | null
  /** UZS reporting snapshot retained for older records/reports. */
  recordedUzs: MoneyDto
  /** What the customer actually handed over, in the original payment currency. */
  input: MoneyDto | null
  /** What was frozen into the contract ledger. */
  applied: MoneyDto | null
  /** Payment-time quote only; today's rate is never used for history. */
  paymentFxQuote: FxQuoteDto | null
  paymentBreakdown?: { method: string; amount: MoneyDto }[] | null
}

export interface HistoricalPaymentDisplay {
  primary: string
  secondary: string | null
}

/**
 * Historical payment presentation is deliberately native-first. It never
 * recomputes a past receipt through today's rate, so changing a shop setting
 * cannot alter the amount a customer appears to have paid.
 */
export function paymentAmountDisplay(payment: NasiyaPaymentDisplayRecord): HistoricalPaymentDisplay {
  const primaryMoney = payment.input ?? payment.applied ?? payment.recordedUzs
  const primary = formatMoneyDto(primaryMoney)
  const applied = payment.applied && payment.applied.currency !== primaryMoney.currency
    ? `Shartnomaga: ${formatMoneyDto(payment.applied)}`
    : null
  const rate = payment.paymentFxQuote?.rate
  const quote = payment.paymentFxQuote
  const quoteDate = quote?.effectiveAt ?? quote?.fetchedAt ?? null
  const rateDetail = rate
    ? [
        `Kurs: 1 USD = ${rate} so'm`,
        exchangeRateSourceLabel(quote?.source),
        quoteDate ? new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'medium' }).format(new Date(quoteDate)) : null,
      ].filter(Boolean).join(' · ')
    : null
  return {
    primary,
    secondary: [applied, rateDetail].filter(Boolean).join(' · ') || null,
  }
}
