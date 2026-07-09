/**
 * Contract-authoritative sale payment settlement.
 *
 * Sale's legacy UZS `amountPaid` / `remainingAmount` are compatibility
 * snapshots. FX movement can make them disagree with the sale's native
 * contract balance, so they must never accept or reject a debt payment.
 * This module is deliberately pure so the payment route's most important
 * accounting decision is directly regression-testable without a database.
 */

import { contractScheduleOutstanding, isContractCurrencyDust, roundContractMoney } from '@/lib/nasiya-contract'
import type { CurrencyCode } from '@/lib/currency'

export interface SaleContractPaymentInput {
  contractCurrency: CurrencyCode
  contractSalePrice: number | string
  contractAmountPaid: number | string
  /** Authoritative balance used for the acceptance decision. */
  contractRemainingAmount: number | string
  /** Payment converted at its payment-time rate before this helper is called. */
  appliedAmountInContractCurrency: number | string
}

export type SaleContractPaymentResult =
  | {
      accepted: true
      appliedAmountInContractCurrency: number
      newContractAmountPaid: number
      newContractRemainingAmount: number
      isFullyPaid: boolean
    }
  | {
      accepted: false
      reason: 'ALREADY_SETTLED' | 'OVERPAYMENT' | 'INVALID_AMOUNT'
      appliedAmountInContractCurrency: 0
      newContractAmountPaid: number
      newContractRemainingAmount: number
      isFullyPaid: boolean
    }

/**
 * Applies a single converted payment to a Sale's native ledger.
 *
 * A real overpayment is rejected. An excess strictly below the currency's
 * dust threshold is accepted but not credited beyond the outstanding debt;
 * the original customer-entered amount remains preserved on SalePayment by
 * the caller. Exactly $0.01 / 500 so'm remain meaningful and therefore are
 * not silently forgiven.
 */
export function applySalePaymentToContractLedger(input: SaleContractPaymentInput): SaleContractPaymentResult {
  const currency = input.contractCurrency
  const salePrice = Number(input.contractSalePrice)
  const amountPaid = Number(input.contractAmountPaid)
  const remaining = Number(input.contractRemainingAmount)
  const requestedApplied = Number(input.appliedAmountInContractCurrency)

  const currentOutstanding = contractScheduleOutstanding(remaining, 0, currency)
  const currentAmountPaid = Number.isFinite(amountPaid) ? amountPaid : 0
  if (!Number.isFinite(requestedApplied) || requestedApplied <= 0 || !Number.isFinite(salePrice) || salePrice < 0) {
    return {
      accepted: false,
      reason: 'INVALID_AMOUNT',
      appliedAmountInContractCurrency: 0,
      newContractAmountPaid: currentAmountPaid,
      newContractRemainingAmount: currentOutstanding,
      isFullyPaid: currentOutstanding <= 0,
    }
  }

  if (currentOutstanding <= 0) {
    return {
      accepted: false,
      reason: 'ALREADY_SETTLED',
      appliedAmountInContractCurrency: 0,
      newContractAmountPaid: currentAmountPaid,
      newContractRemainingAmount: 0,
      isFullyPaid: true,
    }
  }

  const rawOverpayment = requestedApplied - currentOutstanding
  if (rawOverpayment > 0 && !isContractCurrencyDust(rawOverpayment, currency)) {
    return {
      accepted: false,
      reason: 'OVERPAYMENT',
      appliedAmountInContractCurrency: 0,
      newContractAmountPaid: currentAmountPaid,
      newContractRemainingAmount: currentOutstanding,
      isFullyPaid: false,
    }
  }

  // Do not credit dust past the true balance. The payment record retains the
  // exact input value/rate, while this value means exactly "applied to debt".
  const appliedAmountInContractCurrency = roundContractMoney(Math.min(requestedApplied, currentOutstanding), currency)
  const newContractRemainingAmount = contractScheduleOutstanding(currentOutstanding, appliedAmountInContractCurrency, currency)
  const isFullyPaid = newContractRemainingAmount <= 0
  const newContractAmountPaid = isFullyPaid
    ? roundContractMoney(salePrice, currency)
    : roundContractMoney(currentAmountPaid + appliedAmountInContractCurrency, currency)

  return {
    accepted: true,
    appliedAmountInContractCurrency,
    newContractAmountPaid,
    newContractRemainingAmount,
    isFullyPaid,
  }
}
