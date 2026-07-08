# Currency accounting model

## 1. Audit result: PARTIAL

Before writing any code, the actual schema and every money-handling route were
read directly (not assumed from memory). Two separate things were checked:

- **Is the debt/schedule ledger stable when a shop switches `preferredCurrency`?**
  **Yes — already correct.** `Nasiya`, `Sale`, `NasiyaSchedule` all store plain
  UZS `Decimal` amounts as the single ledger truth. Switching a shop's display
  currency only changes how those UZS numbers are *formatted* today
  (`formatMoneyByCurrency`); it never rewrites `totalAmount`,
  `finalNasiyaAmount`, `remainingAmount`, schedule `paidAmount`, payment
  allocation, completion detection, or payment score — all of that is computed
  from UZS and untouched by a currency switch.
- **Does payment *history* stay stable when the exchange rate later changes?**
  **No — this was a real, confirmed gap.** `NasiyaPayment`/`SalePayment`
  stored only the applied UZS `amount`. The payment-time conversion
  (`inputAmount`/`inputCurrency`/`exchangeRateUsed`, already computed by
  `moneyInputToUzs()` at every payment site) was spread only into the generic
  `Log.newValue` audit JSON — never onto the payment record itself, and never
  read back for display. The nasiya detail page's "To'lov tarixi" table did
  `fmt(payment.amount /* UZS */, currentShopCurrency, currentRate)` — a live
  reconversion using **today's** rate. A payment shown as "$200" the day it
  was made could read as "$185.18" a month later purely because the rate
  moved, even though nothing about the payment changed. This is exactly the
  bug in the ticket's Examples A and B.

**What was implemented:** the safe, additive fix for the confirmed gap
(payment-time currency/rate capture + stable historical display), described
below. **What was deliberately NOT implemented:** a full "contract native
currency" model where `Nasiya`/`Sale` themselves would be canonically
denominated in a chosen currency (USD amounts stored as USD, not UZS-at-
creation-time-rate). That is a much larger, cross-cutting re-architecture —
every debt/schedule/report/reminder/score computation in this app currently
assumes "amount fields = UZS" — and redefining that is a dedicated project of
its own, not a safe addition. See §14 for what that would require if ever
pursued.

## 2. Contract currency (informational only, does not affect math)

`Nasiya.creationCurrency` / `Nasiya.creationExchangeRate` and
`Sale.creationCurrency` / `Sale.creationExchangeRate` (new nullable columns)
record the shop's display currency and USD/UZS rate **at the moment the deal
was created**. Populated once, at creation, from the same `moneyInputToUzs()`
result already computed for the UZS conversion — no new computation. Purely
informational (e.g. a future "this deal was made in USD" footnote); the debt
ledger (`totalAmount`, `finalNasiyaAmount`, etc.) stays UZS regardless. Null
for every pre-existing row — treated as "unknown / assume UZS" wherever shown.

## 3. Payment currency (drives the historical-display fix)

`NasiyaPayment.paymentInputAmount` / `paymentInputCurrency` /
`paymentExchangeRate`, and the identical three fields on `SalePayment`, record
exactly what the customer entered and at what rate, captured once at payment
time in the same transaction as the payment itself. `amount` (UZS) remains
the sole figure used for debt math, allocation, and completion — these three
fields exist purely for **display**, and are never read by any accounting
computation.

## 4. Display currency

Unchanged: `Shop.preferredCurrency` + the day's rate (`CurrencyRate`,
`getUsdUzsRate()`) — the same "today only" concept as before. This still
correctly governs every *current* balance, card, and report total. It never
governs how a specific past payment is redisplayed once payment-time data is
present (see §10).

## 5. How payment conversion works

Unchanged math, now also persisted: `moneyInputToUzs(amount, inputCurrency)`
converts the user's input to UZS using the current rate (if `inputCurrency`
is USD) — this UZS figure is what's applied to the debt/schedule
(`appliedAmountInContractCurrency`, in this app's terms, since the one
contract currency is UZS). The route now **additionally** persists
`{ inputAmount, inputCurrency, exchangeRateUsed }` onto the payment row
itself, not just the audit log.

## 6. Schedules

Unchanged — `NasiyaSchedule.expectedAmount`/`paidAmount` are UZS, exactly as
before. Allocation (oldest-unpaid-first, overpayment spread across future
schedules — see `docs/nasiya-payment-allocation.md`) operates in UZS and is
untouched by this change.

## 7. Overpayments

Unchanged allocation logic. The example from the ticket ($200 USD contract
paid 3,125,000 so'm at rate 12,500 → $250 applied → month 1 paid $200, month 2
prepaid $50) already works today **in UZS terms**: $200/$250 are themselves
just UZS-at-that-moment's-rate figures being displayed as USD; the schedule
rows split 3,125,000 so'm into 2,500,000 (month 1) + 625,000 (month 2)
exactly as before, unaffected by this change.

## 8. Profile currency switching

No behavior change (this was already correct — see §1). Switching
`preferredCurrency` only changes today's display conversion; it has never
rewritten any stored deal/payment/schedule amount, before or after this fix.

## 9. Historical payment display — the actual fix

The nasiya detail page's "To'lov tarixi" table now renders
`paymentAmountDisplay()` (`src/app/(shop)/shop/nasiyalar/[id]/page.tsx`)
instead of a live `fmt(payment.amount, currentCurrency)`:

- If the payment was made in **USD** (`paymentInputCurrency === 'USD'`):
  shows `$<native amount> → <UZS applied amount> · kurs: <rate>` — e.g.
  `$200.00 → 2 500 000 so'm · kurs: 12 500`. Both numbers are frozen at
  payment time; neither changes if the shop's rate or display currency
  changes afterward.
- If made in **UZS**: shows the native UZS amount plainly (no conversion to
  show).
- If `paymentInputCurrency` is **null** (a payment recorded before this
  fix shipped): falls back to the old behavior — today's display currency —
  identical to what that row already showed before, so old data doesn't
  suddenly look broken or different.

## 10. Reports

Unaffected and unchanged on purpose. Dashboard/`hisobot` totals continue to
convert UZS aggregates to the shop's current display currency for *today's*
view — that's a legitimate, expected live conversion for a running total, not
a rewrite of history. No report aggregates individual historical payment
currency/rate; they all sum the UZS `amount` column, which was always correct
and remains so.

## 11. Migration behavior for old data

Purely additive nullable columns, zero backfill. Every pre-existing
`Nasiya`/`Sale`/`NasiyaPayment`/`SalePayment` row has `creation*`/`payment*`
fields as `NULL`. No fake historical rate is invented — display code treats
`NULL` as "this predates payment-time tracking, show it the way it's always
been shown" (§9), never as "assume UZS" silently mislabeled as historical
fact.

## 12. Telegram

`nasiyaPaymentMessage` / `salePaymentMessage` (`src/lib/telegram-templates.ts`)
accept an optional `paymentInput: { amount, currency }`. When the payment's
native currency differs from the shop's current display currency, the
message shows two lines instead of one:

```
To'langan: $200.00
Shartnomaga qo'llandi: 2 500 000 so'm
```

When they match (no conversion happened), the message is unchanged — a
single `To'langan: <amount>` line. Since Telegram messages are sent
immediately at payment time and never regenerated later, they were never
at risk of the "redisplay with today's rate" bug — this change only adds the
missing paid-vs-applied breakdown, it doesn't fix a stability bug in Telegram
specifically.

## 13. Examples

**USD contract paid in UZS** (ticket Example A): Nasiya jami $1,000 (stored
as UZS at creation-time rate), monthly $200. Customer pays 2,500,000 so'm,
rate 12,500 → `NasiyaPayment.amount = 2,500,000`, `paymentInputAmount =
2,500,000`, `paymentInputCurrency = 'UZS'`, `paymentExchangeRate = null` (no
conversion — paid in UZS, applied in UZS). Payment history always shows
"2 500 000 so'm" regardless of later rate changes.

**UZS contract paid in USD** (ticket Example B): Nasiya jami 12,000,000 so'm,
monthly 2,000,000 so'm. Customer pays $160 at rate 12,500 →
`NasiyaPayment.amount = 2,000,000` (UZS applied), `paymentInputAmount = 160`,
`paymentInputCurrency = 'USD'`, `paymentExchangeRate = 12500`. Payment history
always shows "$160.00 → 2 000 000 so'm · kurs: 12 500", regardless of the
rate today.

## 14. What a full "contract native currency" model would require (deferred)

If ever pursued: `Nasiya`/`Sale` would need a `contractCurrency` field plus
native-currency total/monthly amounts stored *alongside* UZS (or UZS derived
from the native figure at read time using a stored creation rate); every
debt/schedule/allocation computation would need to operate in
`contractCurrency` rather than UZS; `shop-stats.ts`, the payment score, cron
reminders, and sold-device profit would all need auditing for a currency
assumption change. This is a dedicated project, not a safe incremental
addition, and was not attempted here per this ticket's own risk guidance.
