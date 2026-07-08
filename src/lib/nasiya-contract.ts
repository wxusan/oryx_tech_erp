/**
 * Native contract-currency accounting helpers for Nasiya.
 *
 * A nasiya's debt/schedule ledger now has TWO parallel representations:
 *   - `contract*` fields (this file's concern) — the deal's own currency
 *     (`contractCurrency`), decided once at creation, immutable forever.
 *     This is the SOURCE OF TRUTH for debt, schedule, allocation, and
 *     completion math.
 *   - The pre-existing UZS fields (`totalAmount`, `finalNasiyaAmount`,
 *     `remainingAmount`, schedule `expectedAmount`/`paidAmount`, etc.) — kept
 *     exactly as before, as a compatibility snapshot every existing
 *     report/profit/Telegram-creation-message call site keeps reading
 *     unchanged.
 *
 * Centralizing the currency math here (instead of scattering `if
 * (contractCurrency === 'USD')` checks across routes/UI) keeps the two
 * ledgers consistent. See docs/currency-accounting-model.md.
 */

import { convertUsdToUzs, convertUzsToUsd, type CurrencyCode } from '@/lib/currency'
import { scheduleEffectiveDueTime, type OverdueScheduleInput } from '@/lib/nasiya-utils'

/** UZS contracts tolerate 500 so'm of rounding dust; USD contracts (2 decimal places) tolerate 1 cent. */
const UZS_COMPLETION_TOLERANCE = 500
const USD_COMPLETION_TOLERANCE = 0.01

export function getCompletionToleranceForCurrency(currency: CurrencyCode): number {
  return currency === 'USD' ? USD_COMPLETION_TOLERANCE : UZS_COMPLETION_TOLERANCE
}

/**
 * Outstanding (unpaid) balance of a schedule in its OWN contract currency,
 * never negative, snapped to 0 within that currency's tolerance. Mirrors
 * `scheduleOutstanding` in nasiya-utils.ts (which stays UZS-only, untouched,
 * for the legacy ledger) — this is the contract-currency-aware counterpart
 * used by the payment route's new native allocation loop.
 */
export function contractScheduleOutstanding(expectedAmount: number, paidAmount: number, currency: CurrencyCode): number {
  const raw = Math.max(0, expectedAmount - paidAmount)
  return raw <= getCompletionToleranceForCurrency(currency) ? 0 : raw
}

/**
 * A "current outstanding balance" report aggregate (dashboard expectedThisMonth/
 * overdueMoney/upcomingPayments) must be computed from each nasiya's own
 * contract-currency remaining balance, converted to UZS using TODAY's rate —
 * never by summing the legacy UZS snapshot (frozen at each nasiya's own
 * creation rate) and converting the total once. Those two are NOT equivalent
 * once any nasiya is USD-native: the legacy snapshot's implicit "rate" is
 * whatever the rate was at that nasiya's creation, so re-deriving through
 * today's rate on the summed total silently drifts the USD-native nasiya's
 * true balance. See docs/currency-accounting-model.md.
 */
export function contractOutstandingAsUzs(
  contractExpectedAmount: unknown,
  contractPaidAmount: unknown,
  contractCurrency: CurrencyCode,
  usdUzsRate: number | null,
): number {
  const raw = contractScheduleOutstanding(Number(contractExpectedAmount), Number(contractPaidAmount), contractCurrency)
  if (contractCurrency === 'UZS') return raw
  if (!usdUzsRate) return raw
  return convertUsdToUzs(raw, usdUzsRate)
}

/**
 * Currency-aware counterpart of `isScheduleOverdue` in nasiya-utils.ts (which
 * stays UZS-only, untouched, for callers still reading the legacy ledger).
 * Feeding contract-currency amounts (e.g. USD cents) through the UZS-only
 * function would misjudge a schedule as settled purely because its balance
 * is smaller than the 500 so'm tolerance — this uses the currency-aware
 * tolerance instead. `schedule.expectedAmount/paidAmount` here are expected
 * to already be the CALLER's contract-currency figures (not the legacy UZS
 * ones) — see docs/currency-accounting-model.md.
 */
export function isContractScheduleOverdue(schedule: OverdueScheduleInput, currency: CurrencyCode, now: Date = new Date()): boolean {
  if (schedule.status === 'PAID') return false
  if (contractScheduleOutstanding(schedule.expectedAmount, schedule.paidAmount, currency) <= 0) return false
  return scheduleEffectiveDueTime(schedule) < now.getTime()
}

interface ContractNasiyaLike {
  contractCurrency: CurrencyCode
  contractFinalAmount: number | string
  contractRemainingAmount: number | string
  contractPaidAmount: number | string
}

export function getContractCurrency(nasiya: { contractCurrency: CurrencyCode }): CurrencyCode {
  return nasiya.contractCurrency
}

export function getContractFinalAmount(nasiya: ContractNasiyaLike): number {
  return Number(nasiya.contractFinalAmount)
}

export function getContractRemainingAmount(nasiya: ContractNasiyaLike): number {
  return Number(nasiya.contractRemainingAmount)
}

export function getContractPaidAmount(nasiya: ContractNasiyaLike): number {
  return Number(nasiya.contractPaidAmount)
}

interface ContractScheduleLike {
  contractExpectedAmount: number | string
  contractPaidAmount: number | string
}

export function getScheduleContractExpectedAmount(schedule: ContractScheduleLike): number {
  return Number(schedule.contractExpectedAmount)
}

export function getScheduleContractPaidAmount(schedule: ContractScheduleLike): number {
  return Number(schedule.contractPaidAmount)
}

/**
 * Convert a payment (already known to be `paymentCurrency`) into the deal's
 * `contractCurrency` — the figure actually applied to schedule/debt math.
 * Same-currency payments pass through unchanged (no rounding, no rate
 * needed). Cross-currency payments require `rate` (the USD/UZS rate at
 * payment time — the caller fetches this once and passes it in, so a single
 * payment never mixes two different rates across its derived figures).
 */
export function convertPaymentToContractCurrency(
  amount: number,
  paymentCurrency: CurrencyCode,
  contractCurrency: CurrencyCode,
  rate: number | null,
): number {
  if (paymentCurrency === contractCurrency) return amount
  if (!rate || rate <= 0) throw new Error("USD kursi mavjud emas")
  if (paymentCurrency === 'USD' && contractCurrency === 'UZS') {
    return convertUsdToUzs(amount, rate)
  }
  // paymentCurrency === 'UZS' && contractCurrency === 'USD'
  return Math.round(convertUzsToUsd(amount, rate) * 100) / 100
}

/** Format an amount that is already denominated in `currency` — never converts. */
export function formatContractMoney(amount: number, currency: CurrencyCode): string {
  return currency === 'USD' ? `$${amount.toFixed(2)}` : `${Math.round(amount).toLocaleString('ru-RU')} so'm`
}

/**
 * Format an amount that is ALREADY in `amountCurrency` units for display in
 * `displayCurrency` terms — used for LIVE views (payment score reason,
 * reminders, dashboard) where the contract currency and the shop's chosen
 * display currency may differ. Converts using `rate` (typically today's
 * rate for a live view) — never used for a frozen historical payment record,
 * which always shows its own native amount instead (see
 * `paymentAmountDisplay` in the nasiya detail page).
 */
export function formatDisplayMoneyFromContract(
  amount: number,
  amountCurrency: CurrencyCode,
  displayCurrency: CurrencyCode,
  rate?: number | null,
): string {
  if (amountCurrency === displayCurrency) return formatContractMoney(amount, amountCurrency)
  if (!rate || rate <= 0) return `${formatContractMoney(amount, amountCurrency)} (kurs mavjud emas)`
  if (amountCurrency === 'USD') return formatContractMoney(convertUsdToUzs(amount, rate), 'UZS')
  return formatContractMoney(Math.round(convertUzsToUsd(amount, rate) * 100) / 100, 'USD')
}

/**
 * Native contract-currency amount, plus an optional "(~display equivalent)"
 * when the shop's chosen display currency differs — for reminders/messages
 * where the native figure must lead (it's the actual contract debt) but a
 * display-currency hint is still useful context. Mirrors the two-part style
 * of `formatMoneyWithBase` in currency.ts, generalized beyond a UZS base.
 * Falls back to just the native figure when no rate is available.
 */
export function formatContractMoneyWithDisplay(
  amount: number,
  contractCurrency: CurrencyCode,
  displayCurrency: CurrencyCode,
  rate?: number | null,
): string {
  const native = formatContractMoney(amount, contractCurrency)
  if (contractCurrency === displayCurrency || !rate || rate <= 0) return native
  return `${native} (~${formatDisplayMoneyFromContract(amount, contractCurrency, displayCurrency, rate)})`
}
