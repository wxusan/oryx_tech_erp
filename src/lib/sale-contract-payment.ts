/**
 * Contract-authoritative sale payment settlement.
 *
 * Sale's legacy UZS `amountPaid` / `remainingAmount` are compatibility
 * snapshots. FX movement can make them disagree with the sale's native
 * contract balance, so they must never accept or reject a debt payment.
 * This module is deliberately pure so the payment route's most important
 * accounting decision is directly regression-testable without a database.
 */

import { contractScheduleOutstanding, roundContractMoney } from '@/lib/nasiya-contract'
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
 * Every overpayment is rejected. The operator must enter the exact amount to
 * apply; the system never silently keeps change or creates an unexplained
 * customer credit.
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
  if (rawOverpayment > 0) {
    return {
      accepted: false,
      reason: 'OVERPAYMENT',
      appliedAmountInContractCurrency: 0,
      newContractAmountPaid: currentAmountPaid,
      newContractRemainingAmount: currentOutstanding,
      isFullyPaid: false,
    }
  }

  const appliedAmountInContractCurrency = roundContractMoney(requestedApplied, currency)
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
