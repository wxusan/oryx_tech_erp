import { formatMoneyByCurrency, formatUserFacingMoney, type CurrencyContext } from '@/lib/currency'

export interface NasiyaPaymentDisplayRecord {
  id: string
  amount: number
  paymentMethod: string | null
  paidAt: string
  note: string | null
  nasiyaScheduleId: string | null
  paymentInputAmount: number | null
  paymentInputCurrency: 'UZS' | 'USD' | null
  paymentExchangeRate: number | null
  appliedAmountInContractCurrency: number | null
  paymentBreakdown?: { method: string; amount: number }[] | null
}
/** Render historical payments with the payment-time rate, never today's rate. */
export function paymentAmountDisplay(
  payment: NasiyaPaymentDisplayRecord,
  _contractCurrency: 'UZS' | 'USD',
  currency: CurrencyContext,
) {
  if (payment.paymentInputCurrency != null && payment.paymentInputAmount != null) {
    return formatUserFacingMoney({
      amount: payment.paymentInputAmount,
      amountCurrency: payment.paymentInputCurrency,
      displayCurrency: currency.currency,
      rate: payment.paymentExchangeRate ?? currency.usdUzsRate,
    })
  }
  return formatMoneyByCurrency(payment.amount, currency.currency, currency.usdUzsRate)
}
