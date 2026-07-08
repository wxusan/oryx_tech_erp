# Currency accounting model

This supersedes the earlier "payment-display-only" version of this document
(commit `919f9cc`). That pass fixed historical payment *display* but left
the debt/schedule *ledger* itself UZS-only. This document describes the full
native contract-currency model built on top of it, in 11 phases (Nasiya
first — full treatment; Sale/Olib-sotdim — minimal, additive; reports/import
audited and fixed where genuinely broken).

## 1. Three currencies, three different jobs

**Contract currency** — the currency the deal was actually agreed in.
Decided once at creation, stored as `contractCurrency` on the row, **immutable
forever**. A `$1000` nasiya stays a `$1000` nasiya no matter how many times
the shop's display toggle changes or the exchange rate moves.

**Payment currency** — whatever the customer hands over at the moment of a
specific payment. Independent of contract currency: a USD contract can be
paid in so'm, a UZS contract can be paid in dollars, freely, payment by
payment. Preserved verbatim (`paymentInputAmount`/`paymentInputCurrency`/
`paymentExchangeRate`), never recomputed later.

**Display currency** — `Shop.preferredCurrency`, a pure view setting. Changing
it re-renders every screen through today's rate; it never rewrites a stored
deal, schedule, payment, or report figure. See §4.

## 2. Architecture: dual ledger, one frozen conversion factor

Every contract (Nasiya, Sale, SupplierPayable) carries **two** representations:

- **`contract*` fields** — native currency, source of truth for debt,
  schedule, allocation, and completion math (Nasiya only has real
  schedule/allocation; Sale/SupplierPayable are simpler single-balance
  ledgers).
- **Legacy UZS fields** (`totalAmount`, `finalNasiyaAmount`,
  `remainingAmount`, `salePrice`, `amount`, schedule `expectedAmount`/
  `paidAmount`, etc.) — kept exactly as before, updated in lockstep at every
  mutation using the ONE rate frozen at creation (`contractExchangeRateAtCreation`
  — null for UZS contracts, since no conversion is needed). Every existing
  report/profit/Telegram-creation-message call site keeps reading these
  fields **unchanged**.

For a UZS contract the two ledgers are numerically identical (rate is
irrelevant). For a USD contract, the legacy fields are a frozen
creation-rate snapshot — useful for backward-compatible reporting, but never
authoritative for debt math and never reconverted through *today's* rate for
"current state" display (that specific bug — reconverting a frozen snapshot
through a later rate — is exactly what Phases 6 and 9 found and fixed; see
§10 and §11).

## 3. Schema fields (all additive, no renames/drops)

**Nasiya**: `contractCurrency`, `contractExchangeRateAtCreation`,
`contractTotalAmount`, `contractDownPayment`, `contractBaseRemainingAmount`,
`contractInterestAmount`, `contractFinalAmount`, `contractMonthlyPayment`,
`contractRemainingAmount`, `contractPaidAmount`.

**NasiyaSchedule**: `contractCurrency` (copied from parent, immutable),
`contractExpectedAmount`, `contractPaidAmount`, `contractRemainingAmount`.

**NasiyaPayment**: `appliedAmountInContractCurrency` (the existing `amount`
field already served as the UZS-applied snapshot from the prior pass — no
change needed there).

**Sale**: same shape as Nasiya minus the schedule (`contractCurrency`,
`contractExchangeRateAtCreation`, `contractSalePrice`, `contractAmountPaid`,
`contractRemainingAmount`).

**SalePayment**: `appliedAmountInContractCurrency`.

**SupplierPayable**: `contractCurrency`, `contractExchangeRateAtCreation`,
`contractAmount` (no allocation fields needed — see §13).

`Nasiya.creationCurrency`/`creationExchangeRate` and `Sale.creationCurrency`/
`creationExchangeRate` (added in the prior pass, informational-only) are
**untouched** — confirmed via grep that nothing reads them besides the
creation routes that write them, so they stay as harmless, redundant
historical context rather than being renamed.

Centralized helpers live in `src/lib/nasiya-contract.ts` (not
nasiya-specific despite the filename — also used by Sale/SupplierPayable):
`getCompletionToleranceForCurrency`, `contractScheduleOutstanding`,
`isContractScheduleOverdue`, `convertPaymentToContractCurrency`,
`roundContractMoney`, `formatContractMoney`, `formatDisplayMoneyFromContract`,
`formatContractMoneyWithDisplay`, `contractOutstandingAsUzs`.

## 4. Display currency never rewrites contracts

Switching `Shop.preferredCurrency` only changes which formatter/rate a page
uses to render already-stored numbers. It was already correct for the
UZS-only ledger; the dual-ledger design keeps it correct now that
`contractCurrency` is real: `contractCurrency` is written once at creation
and never read from `preferredCurrency` again. A shop can flip its display
currency any number of times — every nasiya, schedule, payment, and report
figure derived from `contract*` fields stays exactly what it was.

## 5. How payments convert into contract currency

At payment time (`convertPaymentToContractCurrency` in
`src/lib/nasiya-contract.ts`):

```
if paymentCurrency == contractCurrency:
  appliedAmountInContractCurrency = paymentInputAmount   # no conversion
else:
  appliedAmountInContractCurrency = convert(paymentInputAmount, rate)
```

The rate is fetched **once** per payment (reusing the already-fetched rate
when the payment itself is USD; fetching fresh only for the one remaining
case — a UZS payment against a USD contract) and used for both the contract
figure and the legacy UZS snapshot, so a single payment can never end up with
two different implied rates.

## 6. Schedules

Nasiya schedules are the only real per-installment structure in this system
(Sale/SupplierPayable are single-balance). Each `NasiyaSchedule` row carries
`contractExpectedAmount`/`contractPaidAmount` (native currency, source of
truth) alongside the legacy `expectedAmount`/`paidAmount` (UZS snapshot,
unchanged). The payment route allocates `appliedAmountInContractCurrency`
across schedules using the exact same oldest-unpaid-first sort as before —
only the currency the numbers are denominated in changed, not the ordering
logic.

## 7. Overpayments

Unchanged allocation algorithm, now proportionally correct in whichever
currency the contract is in. Worked example (ticket's Example C): a $200/month
USD contract, customer pays 3,125,000 so'm at rate 12,500 →
`appliedAmountInContractCurrency = $250` → month 1 absorbs $200 (closed),
month 2 gets $50 prepaid, $150 still owed on month 2. See §16 for the UZS-
overpaid-in-USD mirror (Example D).

## 8. Completion + currency-aware tolerance

A nasiya is marked `COMPLETED` when `contractRemainingAmount <= 0` or every
schedule's `contractScheduleOutstanding` is within tolerance —
**never** the legacy UZS remainder. Tolerance is currency-aware
(`getCompletionToleranceForCurrency`): 500 so'm for UZS contracts, **$0.01**
for USD contracts. Using the UZS-sized tolerance on a USD contract would
silently forgive a genuine dollar of debt (500 ≤ 500 in UZS terms is fine;
$500 of USD debt obviously is not "rounding dust"); the reverse — using
cent-tolerance on UZS — would fail to snap off legitimate so'm rounding
dust. Both ledgers snap to exactly 0 together once complete.

## 9. Historical payment display

Unchanged from the prior pass, now generalized: `paymentAmountDisplay` (nasiya
detail page) shows the payment's own native amount, and — only when payment
currency differs from **contract** currency (not display currency) — the
applied contract-currency figure plus the rate used, e.g.
`"$160.00 → 2 000 000 so'm · kurs: 12 500"`. This is frozen at payment time
and never recalculated, regardless of later rate/display changes.

## 10. A confirmed bug this project found and fixed: double-conversion drift

Several surfaces displayed a nasiya's "current state" (remaining debt,
totals, schedule balances) by reading the **legacy UZS snapshot** (frozen at
creation rate) and reconverting it through **today's** rate for the shop's
display currency. For a UZS-native nasiya this is harmless (no conversion
happens either way). For a USD-native nasiya it silently drifts: a contract
truly worth $600 today, created when the rate was 12,500 (legacy snapshot
7,500,000 so'm), shown today at rate 13,500 via the legacy field, renders as
$555.56 — wrong. The fix (Phases 5, 6, and 9): every "live" figure now reads
the **contract-currency field** and converts through today's rate exactly
once (`formatDisplayMoneyFromContract`/`formatContractMoneyWithDisplay`), on
the nasiya detail page, the payment modal, the nasiyalar list, the payment
score reason text, cron reminder messages, and the dashboard's live
aggregates (`expectedThisMonth`, `overdueMoney`, `upcomingPayments` — via
`contractOutstandingAsUzs`, converting each row before summing rather than
summing frozen snapshots and converting the total once).

## 11. Reports/dashboard

- **Creation-time aggregates** (`accrualRevenueThisMonth`, sold-device
  profit) keep summing the legacy UZS snapshot fields, unchanged — each is
  a frozen historical fact, and summing many frozen UZS facts from
  different dates is ordinary, correct accounting (no reconversion
  involved).
- **Live aggregates** (`expectedThisMonth`, `overdueMoney`,
  `upcomingPayments`) now convert each nasiya's own contract-currency
  balance through today's rate before summing — see §10.
- Sale's aggregates are unaffected by this pass (Sale has no schedule and
  its legacy `remainingAmount` stays accurate via its own dual-ledger — see
  §13).

## 12. Telegram

- **Reminders** (`nasiyaDueTodayMessage`/`nasiyaOverdueMessage`/
  `nasiyaEarlyReminderMessage`): amount is the schedule's own contract-currency
  balance, formatted natively with an optional `(~display equivalent)` hint
  (`formatContractMoneyWithDisplay`) — native leads because it's the real debt.
- **Payment confirmation** (`nasiyaPaymentMessage`): allocation breakdown and
  applied/remaining figures are in contract currency; the "paid vs. applied"
  two-line breakdown triggers when payment currency differs from
  **contract** currency (not display currency).
- **Completion** (`nasiyaCompletedMessage`): now shows the contract-currency
  total, fixing the same double-conversion-drift bug (§10) — this message
  fires whenever the last payment happens, potentially long after creation,
  so it was just as exposed to rate drift as the dashboard.
- **Creation messages** (`nasiyaCreatedMessage`, `nasiyaImportedMessage`)
  are unaffected on purpose: they're generated in the same request that
  freezes the creation rate, so there is no time for the rate to have moved
  — no drift is possible there.
- Sale/Olib-sotdim Telegram messages are unaffected in this pass (§13).

## 13. Olib-sotdim / SupplierPayable

Confirmed by reading `/api/olib-sotdim/[id]/pay`: paying a supplier payable
is a **binary PENDING→PAID status flip with no partial-payment amount
input** — there is no allocation logic to make currency-aware. `SupplierPayable`
gets `contractCurrency`/`contractAmount`/`contractExchangeRateAtCreation` at
creation only, populated the same way as Nasiya/Sale. Supplier debt and
customer debt remain entirely separate ledgers, as before.

Sale itself also got the schema-only treatment: `contractCurrency`/
`contractSalePrice`/`contractAmountPaid`/`contractRemainingAmount`,
populated at creation (both the normal sell route and olib-sotdim) and
dual-written on every sale payment — but **not** wired into Sale's
detail/list pages or Telegram messages in this pass (deliberately deferred,
see §15). This is safe because Sale's legacy ledger stays accurate via its
own lockstep, exactly like Nasiya's.

One incidental fix while touching this: the olib-sotdim route never set
`Sale.creationCurrency`/`creationExchangeRate` at all (unlike the normal
sell route) — now it does, for consistency between the two sale-creation
paths.

## 14. Import behavior

New manual imports (`POST /api/nasiya/import`) now store `contractCurrency`
and the full contract ledger, computed from the raw import-form input in
whatever currency the form specifies (`inputCurrency`, already present in
the schema but previously dropped after UZS conversion — a real, if minor,
gap now fixed). `generateImportSchedule` gained a `currency` param (cent
precision for USD) and an explicit `monthCountOverride`, used to force the
contract-currency schedule mirror to the exact same instalment count as the
legacy schedule — their independently-rounded debt/monthly ratios could
otherwise occasionally disagree by one row. Pre-existing imported nasiyas
are covered by the migration backfill (§15) — never a guessed historical
rate.

## 15. Migration behavior for old data

Every migration in this project is additive `ADD COLUMN` only — no
drops or renames. For every pre-existing row (Nasiya, NasiyaSchedule,
NasiyaPayment, Sale, SalePayment, SupplierPayable):

- `contractCurrency = 'UZS'` (never invents a USD contract for old data).
- `contract*` amount fields = a direct 1:1 copy of the corresponding legacy
  UZS field (since every old row is implicitly UZS-native already).
- `contractExchangeRateAtCreation` stays `NULL` (no rate to invent for a
  UZS contract — it's simply irrelevant).
- `appliedAmountInContractCurrency` on payments = the existing `amount`
  (both UZS, since contractCurrency is UZS for these rows).

## 16. Worked examples

**A — USD contract paid in UZS.** Contract: $1000 total, $200/month.
Customer pays 2,500,000 so'm at rate 12,500 → `appliedAmountInContractCurrency
= $200`, schedule month 1 fully paid. Rate later moves to 13,500 — the
payment still shows "2,500,000 so'm → $200.00 · kurs: 12,500" forever; the
contract's remaining balance stays exactly what it was in dollar terms.

**B — UZS contract paid in USD.** Contract: 12,000,000 so'm total,
2,000,000/month. Customer pays $160 at rate 12,500 →
`appliedAmountInContractCurrency = 2,000,000 so'm`, month 1 fully paid.
Payment history always shows "$160.00 → 2,000,000 so'm · kurs: 12,500".

**C — USD contract, overpayment paid in UZS.** $200/month contract.
Customer pays 3,125,000 so'm at rate 12,500 → applied $250. Month 1: $200
(closed). Month 2: $50 prepaid, $150 still owed.

**D — UZS contract, overpayment paid in USD.** 2,000,000/month contract.
Customer pays $200 at rate 12,500 → applied 2,500,000 so'm. Month 1:
2,000,000 (closed). Month 2: 500,000 prepaid, 1,500,000 still owed.

## 17. What was deliberately deferred (not silently dropped)

- **Sale/Olib-sotdim display layer** (detail pages, lists, Telegram
  messages) — schema + creation/payment population is done and correct
  (§13), but the surfaces still render the legacy UZS ledger. Safe today
  (Sale's dual-ledger stays in lockstep exactly like Nasiya's), but a
  Sale-side mirror of Nasiya's Phases 5/6/9 display fixes would be needed
  before a shop routinely creates USD-native cash sales and expects the
  same "no double-conversion drift" guarantee on the sale detail page.
- **No independent currency selector** in creation forms or the payment
  modal, distinct from the shop's global `preferredCurrency` toggle. The
  existing toggle already provides full flexibility once `contractCurrency`
  is frozen per-deal (create a USD deal while displaying USD, then switch
  display to UZS before recording a payment — that alone produces "USD
  contract paid in UZS"). Adding a second selector was assessed as
  unnecessary risk to existing, tested UI wiring for a capability the app
  already has.
- **Device.purchasePrice** stays UZS-only — out of scope per the original
  spec (never listed as a field needing contract-currency treatment).
