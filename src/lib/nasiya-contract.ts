/**
 * Native contract-currency accounting helpers for Nasiya, Sale, and
 * SupplierPayable.
 *
 * Each of these now has TWO parallel representations:
 *   - `contract*` fields (this file's concern) — the deal's own currency
 *     (`contractCurrency`), decided once at creation, immutable forever.
 *     This is the SOURCE OF TRUTH for debt (and, for Nasiya, schedule/
 *     allocation/completion) math.
 *   - The pre-existing UZS fields (`totalAmount`, `finalNasiyaAmount`,
 *     `salePrice`, `amount`, etc.) — kept exactly as before, as a
 *     compatibility snapshot every existing report/profit/Telegram-creation-
 *     message call site keeps reading unchanged.
 *
 * Centralizing the currency math here (instead of scattering `if
 * (contractCurrency === 'USD')` checks across routes/UI) keeps the two
 * ledgers consistent. See docs/currency-accounting-model.md.
 */

import { convertUsdToUzs, convertUzsToUsd, formatUserFacingMoney, type CurrencyCode, type CurrencyContext } from '@/lib/currency'
import { scheduleEffectiveDueTime, type OverdueScheduleInput } from '@/lib/nasiya-utils'
import { isBeforeTashkentToday } from '@/lib/timezone'

/** UZS contracts tolerate 500 so'm of rounding dust; USD contracts (2 decimal places) tolerate 1 cent. */
const UZS_COMPLETION_TOLERANCE = 500
const USD_COMPLETION_TOLERANCE = 0.01

export function getCompletionToleranceForCurrency(currency: CurrencyCode): number {
  return currency === 'USD' ? USD_COMPLETION_TOLERANCE : UZS_COMPLETION_TOLERANCE
}

/**
 * Round a raw contract-currency amount to its smallest real unit — whole
 * so'm for UZS, cents for USD. Accepts `number | string` because every
 * caller may be reading straight from an API response: a Prisma `Decimal`
 * column serializes to a JSON STRING over the network (see
 * `convertUsdToUzs`/`convertUzsToUsd` in `currency.ts`, which established
 * this exact pattern), so `Number(value)` here is required, not optional —
 * skipping it does not (usually) throw immediately, but every OTHER
 * function in this file below builds on this one and calls `.toFixed()` on
 * its result, which DOES throw for a raw string.
 */
export function roundContractMoney(value: number | string, currency: CurrencyCode): number {
  const n = Number(value)
  return currency === 'USD' ? Math.round(n * 100) / 100 : Math.round(n)
}

/**
 * True when an amount is too small to be treated as a real payment/allocation
 * in the contract's own currency. This is intentionally a STRICT comparison:
 * $0.009 / 499 so'm are dust, while $0.01 / 500 so'm remain meaningful.
 */
export function isContractCurrencyDust(amount: number | string, currency: CurrencyCode): boolean {
  const n = Math.abs(Number(amount))
  if (!Number.isFinite(n)) return true
  return n < getCompletionToleranceForCurrency(currency)
}

/**
 * Outstanding (unpaid) balance of a schedule in its OWN contract currency,
 * never negative, snapped to 0 only when it is strictly below that currency's
 * tolerance. Mirrors
 * `scheduleOutstanding` in nasiya-utils.ts (which stays UZS-only, untouched,
 * for the legacy ledger) — this is the contract-currency-aware counterpart
 * used by the payment route's new native allocation loop. Accepts
 * `number | string` for the same Decimal-serializes-to-a-string-over-JSON
 * reason as `roundContractMoney` above.
 */
export function contractScheduleOutstanding(expectedAmount: number | string, paidAmount: number | string, currency: CurrencyCode): number {
  // Contract amounts are stored at their currency's smallest real unit. Round
  // the subtraction too: IEEE-754 otherwise turns $100 - $99.99 into
  // 0.010000000000005116 and makes the tolerance boundary non-deterministic.
  const raw = Math.max(0, roundContractMoney(Number(expectedAmount) - Number(paidAmount), currency))
  // Strict by design: $0.009 / 499 so'm are dust; $0.01 / 500 so'm are
  // meaningful debt. This matches isContractCurrencyDust and prevents a
  // visible cent/500-so'm balance from being silently forgiven.
  return raw < getCompletionToleranceForCurrency(currency) ? 0 : raw
}

/**
 * Convert a single contract-currency amount into UZS using a given rate
 * (typically TODAY's rate, for a "current state" report aggregate — never
 * for a frozen historical record, which must keep its own creation/payment-
 * time rate instead). UZS passes through unchanged. Returns the raw USD
 * number un-converted if no rate is available, rather than throwing — a
 * documented, honest degradation (see docs/currency-accounting-model.md)
 * instead of a hard failure of the whole aggregate.
 */
export function convertContractAmountToUzs(
  amount: number | string,
  contractCurrency: CurrencyCode,
  usdUzsRate: number | string | null,
): number {
  const n = Number(amount)
  if (contractCurrency === 'UZS') return n
  if (!usdUzsRate) return n
  return convertUsdToUzs(n, usdUzsRate)
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
  usdUzsRate: number | string | null,
): number {
  const raw = contractScheduleOutstanding(Number(contractExpectedAmount), Number(contractPaidAmount), contractCurrency)
  return convertContractAmountToUzs(raw, contractCurrency, usdUzsRate)
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
  if (contractScheduleOutstanding(schedule.expectedAmount, schedule.paidAmount, currency) <= 0) return false
  return isBeforeTashkentToday(new Date(scheduleEffectiveDueTime(schedule)), now)
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
  amount: number | string,
  paymentCurrency: CurrencyCode,
  contractCurrency: CurrencyCode,
  rate: number | string | null,
): number {
  const n = Number(amount)
  const r = rate == null ? null : Number(rate)
  if (paymentCurrency === contractCurrency) return n
  if (!r || r <= 0) throw new Error('USD kursi mavjud emas')
  if (paymentCurrency === 'USD' && contractCurrency === 'UZS') {
    return convertUsdToUzs(n, r)
  }
  // paymentCurrency === 'UZS' && contractCurrency === 'USD'
  return Math.round(convertUzsToUsd(n, r) * 100) / 100
}

/**
 * Format an amount that is already denominated in `currency` — never
 * converts. Accepts `number | string`: a Prisma `Decimal` column (e.g.
 * `Sale.contractSalePrice`, `SalePayment.appliedAmountInContractCurrency`,
 * `Device.purchaseInputAmount`) serializes to a JSON STRING once it crosses
 * an API response into the browser (`NextResponse.json()` → `fetch().json()`),
 * exactly like `Device.purchasePrice` already did (see the regression test
 * and comment in `tests/currency.test.ts`). Calling `.toFixed()` on that raw
 * string throws `TypeError: amount.toFixed is not a function` for any
 * USD-denominated value — this crashed the device detail page in production
 * whenever a sale/purchase/payment was USD-native. `Number(amount)` here is
 * the fix, mirroring the same pattern already used by
 * `convertUsdToUzs`/`convertUzsToUsd` in `currency.ts`.
 */
export function formatContractMoney(amount: number | string, currency: CurrencyCode): string {
  const n = Number(amount)
  // Missing/corrupt data should look obviously incomplete, never "$NaN" /
  // "NaN so'm" and never a crash. A missing/invalid `currency` (anything
  // other than the literal 'USD') already safely falls back to the UZS
  // branch via the ternary below.
  if (!Number.isFinite(n)) return '—'
  return currency === 'USD' ? `$${n.toFixed(2)}` : `${Math.round(n).toLocaleString('ru-RU')} so'm`
}

/**
 * Format an amount that is ALREADY in `amountCurrency` units for display in
 * `displayCurrency` terms — used for LIVE views (payment score reason,
 * reminders, dashboard) where the contract currency and the shop's chosen
 * display currency may differ. Converts using `rate` (typically today's
 * rate for a live view) — never used for a frozen historical payment record,
 * which always shows its own native amount instead (see
 * `paymentAmountDisplay` in the nasiya detail page). Accepts `number | string`
 * for the same reason as `formatContractMoney` above.
 */
export function formatDisplayMoneyFromContract(
  amount: number | string,
  amountCurrency: CurrencyCode,
  displayCurrency: CurrencyCode,
  rate?: number | string | null,
): string {
  return formatUserFacingMoney({
    amount,
    amountCurrency,
    displayCurrency,
    rate,
  })
}

/**
 * Margin between a contract-currency amount (e.g. a sale price) and a
 * UZS-only cost that has no native-currency concept of its own (e.g.
 * Device.purchasePrice, which stays UZS-only by design — see
 * docs/currency-accounting-model.md). For a UZS contract this is a plain
 * subtraction. For a USD contract, the UZS cost is converted using the
 * FROZEN creation rate — never today's rate — since that is the only
 * well-defined conversion available (there is no genuine "USD purchase
 * price" to read); this keeps the result stable and non-inventing, and
 * mathematically equals dividing the already-frozen legacy UZS profit
 * snapshot by the same creation rate. Returns null when a USD contract has
 * no creation rate to convert with (should not happen for a real USD
 * contract, but avoids inventing one).
 */
export function computeContractCurrencyMargin(
  contractAmount: number | string,
  costUzs: number | string,
  contractCurrency: CurrencyCode,
  contractExchangeRateAtCreation: number | string | null,
): number | null {
  const amount = Number(contractAmount)
  const cost = Number(costUzs)
  // Missing/corrupt data — never attempt a conversion (convertUzsToUsd would
  // throw on a non-finite cost); no margin can be honestly computed.
  if (!Number.isFinite(amount) || !Number.isFinite(cost)) return null
  if (contractCurrency === 'UZS') return amount - cost
  if (!contractExchangeRateAtCreation) return null
  const costInContractCurrency = Math.round(convertUzsToUsd(cost, contractExchangeRateAtCreation) * 100) / 100
  return Math.round((amount - costInContractCurrency) * 100) / 100
}

/** Minimal shape of a device's own purchase-currency context (see the `purchase*` fields on Device). */
export interface PurchaseCostLike {
  purchaseCurrency: CurrencyCode
  purchaseInputAmount: number | string
  purchaseAmountUzsSnapshot: number | string
}

/**
 * Sale-margin variant of `computeContractCurrencyMargin` that is aware of the
 * DEVICE's own purchase currency (not just a UZS-only cost). When the sale's
 * contractCurrency matches the device's purchaseCurrency, the margin is a
 * plain native subtraction — no FX conversion at all, so it can never
 * double-count an exchange difference between the (possibly different)
 * purchase-time and sale-time rates. Only when the two currencies genuinely
 * differ does this fall back to converting the purchase's frozen UZS
 * snapshot into the sale's contract currency via the SALE's own frozen
 * creation rate (identical behavior to `computeContractCurrencyMargin`,
 * which remains in use wherever a purchase-currency context isn't
 * available). See docs/currency-accounting-model.md.
 */
export function computeSaleContractMargin(
  contractAmount: number | string,
  contractCurrency: CurrencyCode,
  contractExchangeRateAtCreation: number | string | null,
  purchase: PurchaseCostLike,
): number | null {
  if (purchase.purchaseCurrency === contractCurrency) {
    return Math.round((Number(contractAmount) - Number(purchase.purchaseInputAmount)) * 100) / 100
  }
  return computeContractCurrencyMargin(contractAmount, purchase.purchaseAmountUzsSnapshot, contractCurrency, contractExchangeRateAtCreation)
}

/**
 * Format a contract-currency amount for a user-facing surface. The selected
 * shop display currency is the only currency shown; if conversion is required
 * but no rate is available, returns an explicit dash instead of leaking a
 * second/native currency into the UI.
 */
export function formatContractMoneyWithDisplay(
  amount: number | string,
  contractCurrency: CurrencyCode,
  displayCurrency: CurrencyCode,
  rate?: number | string | null,
): string {
  return formatDisplayMoneyFromContract(amount, contractCurrency, displayCurrency, rate)
}

/** Minimal shape a SalePayment row needs for `salePaymentAmountDisplay`. */
export interface SalePaymentLike {
  amount: number | string
  paymentInputAmount: number | string | null
  paymentInputCurrency: CurrencyCode | null
  paymentExchangeRate: number | string | null
  appliedAmountInContractCurrency: number | string | null
}

/**
 * Payment history must show what actually happened at payment time, not a
 * live reconversion at today's rate/shop currency — the Sale counterpart of
 * `paymentAmountDisplay` in the nasiya detail page. `paymentInputAmount/
 * Currency/ExchangeRate` preserve what the customer actually entered;
 * `appliedAmountInContractCurrency` is what was actually applied to THIS
 * sale's own contract-currency debt (native — $500, not always so'm).
 * `payment.amount` stays the UZS compatibility snapshot, used only as a
 * fallback for payments recorded before this was tracked (never invents a
 * historical rate). See docs/currency-accounting-model.md.
 */
export function salePaymentAmountDisplay(
  payment: SalePaymentLike,
  contractCurrency: CurrencyCode,
  displayCurrency: CurrencyContext,
): string {
  if (payment.paymentInputCurrency != null && payment.paymentInputAmount != null) {
    return formatUserFacingMoney({
      amount: payment.paymentInputAmount,
      amountCurrency: payment.paymentInputCurrency,
      displayCurrency: displayCurrency.currency,
      rate: payment.paymentExchangeRate ?? displayCurrency.usdUzsRate,
    })
  }
  // Older payment recorded before payment-time currency was tracked — same
  // fallback behavior as before this fix (today's display currency).
  return formatDisplayMoneyFromContract(payment.amount, 'UZS', displayCurrency.currency, displayCurrency.usdUzsRate)
}
