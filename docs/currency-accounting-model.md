# Currency accounting model

This supersedes the earlier "payment-display-only" version of this document
(commit `919f9cc`). That pass fixed historical payment _display_ but left
the debt/schedule _ledger_ itself UZS-only. This document describes the full
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

**User-facing display rule** — normal shop-facing UI and Telegram show exactly
one money currency: the selected display currency. Internal accounting may keep
native contract currency, payment input currency, payment-time rates, UZS
snapshots, and USD snapshots, but UI/Telegram must not render mixed strings
like `600 238 so'm (~$50.00)` or `$50.00 (~600 238 so'm)`.

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
authoritative for debt math and never reconverted through _today's_ rate for
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

`paymentAmountDisplay` (nasiya detail page) and `salePaymentAmountDisplay`
(sale history on device detail) show exactly one user-facing currency: the
shop's selected display currency. For tracked payments they start from the
customer's original `paymentInputAmount`/`paymentInputCurrency` and convert
with that row's saved `paymentExchangeRate` when needed. They never use
today's rate for an old payment amount, and they no longer show mixed
`paid → applied · kurs` text in normal UI.

Rows recorded before payment-time fields existed fall back to the legacy UZS
snapshot and the current display conversion rule, because no historical input
currency/rate exists to use.

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

- **Payment-time profit aggregates** freeze the principal/margin/interest
  split on `SalePayment` and `NasiyaPaymentAllocation`. Actual profit uses
  the payment's UZS snapshot and `paidAt`; it never recognizes a future
  Nasiya contract at creation. See
  `docs/accounting/monthly-profit-recognition.md`.
- **Expected-profit aggregates** retain native UZS/USD partitions and include
  only unpaid margin/interest whose effective due date is in the selected
  month. Full contract interest remains reference-only on Nasiya detail.
- **Live aggregates** (`expectedThisMonth`, `overdueMoney`,
  `upcomingPayments`) now convert each nasiya's own contract-currency
  balance through today's rate before summing — see §10.
- **Sale's live aggregates** (`expectedThisMonth`, `overdueMoney`, via
  `unpaidSales`/`overdueSales`) were fixed in the same later pass that added
  §21's `convertContractAmountToUzs` — see §21 for why the legacy
  `remainingAmount` alone was not safe to keep summing for these two
  figures.

## 12. Telegram

- **Reminders** (`nasiyaDueTodayMessage`/`nasiyaOverdueMessage`/
  `nasiyaEarlyReminderMessage`): amount is the schedule's own contract-currency
  balance, formatted into the shop display currency only
  (`formatContractMoneyWithDisplay` now delegates to the one-currency display
  helper).
- **Payment confirmation** (`nasiyaPaymentMessage`): allocation breakdown and
  paid figures are shown in the shop display currency only. The paid input and
  allocation lines use the payment's saved `paymentExchangeRate`; remaining
  debt uses the current display conversion rule.
- **Completion** (`nasiyaCompletedMessage`): now shows the contract-currency
  total converted to the shop display currency, fixing the same
  double-conversion-drift bug (§10) while still obeying the one-currency UI
  rule.
- **Creation messages** (`nasiyaCreatedMessage`, `nasiyaImportedMessage`)
  are unaffected on purpose: they're generated in the same request that
  freezes the creation rate, so there is no time for the rate to have moved
  — no drift is possible there.
- **Supplier payable** reminders and paid-confirmation also fixed — see §13.
- **Sale payment/sold-device messages** (`salePaymentMessage`,
  `deviceSoldMessage`, `olibSotdimCreatedMessage`) — fixed in a follow-up pass,
  see §17.

## 13. Olib-sotdim / SupplierPayable

Confirmed by reading `/api/olib-sotdim/[id]/pay`: paying a supplier payable
is a **binary PENDING→PAID status flip with no partial-payment amount
input** — there is no allocation logic to make currency-aware. `SupplierPayable`
gets `contractCurrency`/`contractAmount`/`contractExchangeRateAtCreation` at
creation only, populated the same way as Nasiya/Sale. Supplier debt and
customer debt remain entirely separate ledgers, as before.

Unlike Sale (below), supplier payable **reminders and the paid-confirmation
Telegram message** were fixed in this pass too, since the cost was low and
the ticket explicitly calls out "supplier payable reminders use contract
currency" as a requirement: `supplierPayableDueTodayMessage`/
`supplierPayableOverdueMessage`/`supplierPayableEarlyReminderMessage`/
`supplierPayablePaidMessage` all now take `contractCurrency` and format via
`formatContractMoneyWithDisplay`, reading `payable.contractAmount` instead of
the legacy `payable.amount`, while showing only the selected display currency.
The same double-conversion-drift bug as §10 applied here too (a payable's
`amount` is frozen at creation rate; a paid confirmation or reminder sent
later, at a different rate, would have misstated a USD-native payable's true
amount).

Sale itself got the schema-only treatment: `contractCurrency`/
`contractSalePrice`/`contractAmountPaid`/`contractRemainingAmount`,
populated at creation (both the normal sell route and olib-sotdim) and
dual-written on every sale payment. A follow-up pass then wired this ledger
into Sale's detail/list pages and Telegram messages — see §17.

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

## 17. Sale display and Telegram behavior (follow-up pass)

A later, narrowly-scoped pass closed the Sale-side display gap flagged in
the original plan (§13/§18 above described it as safe-but-deferred). The
concrete bug this closes: a $500 USD-native sale created at rate 12,500
(legacy snapshot 6,250,000 so'm) previously rendered as `sale.amountUzs /
todayRate` on the qurilmalar list/detail pages and in Telegram — so once the
rate moved to 13,000 it would silently show "$480.76" instead of staying
$500. This mirrors the exact drift bug already fixed for Nasiya in §10.

**Source of truth.** `Sale.contractCurrency`/`contractSalePrice`/
`contractAmountPaid`/`contractRemainingAmount` (frozen at creation, dual-
written on every payment — see §13) are now the only inputs to every
"current state" display. The legacy `salePrice`/`amountPaid`/
`remainingAmount` UZS snapshot is never reconverted through today's rate for
a live view; it's read only as a same-instant fallback when a contract field
is unavailable (see profit, below).

**Pages fixed** (all via `formatDisplayMoneyFromContract`/
`formatContractMoney` from `src/lib/nasiya-contract.ts`, converting the
native contract amount exactly once):

- `src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx` — the "Sotuv narxi"
  and "Farq" (profit) columns.
- `src/app/(shop)/shop/qurilmalar/[id]/page.tsx` (device detail) — "Sotuv
  narxi", "Farq / Foyda",
  "To'langan", "Qolgan", and the "pay remaining" prefill button (now via
  `convertPaymentToContractCurrency`, with a safe string fallback when no
  rate is available client-side).
- `src/lib/server/shop-lists.ts` (`buildDeviceSaleInfo`, shared by both cash
  sale and nasiya sold-device rows) — additive `contractSoldPrice`/
  `contractProfit` fields alongside the untouched legacy `soldPrice`/
  `profit`.

**Payment history.** `salePaymentAmountDisplay` (in `nasiya-contract.ts`) is
the Sale counterpart of Nasiya's `paymentAmountDisplay`: it shows exactly one
selected display currency, starting from `paymentInputAmount/Currency` and
using `paymentExchangeRate` for historical cross-currency conversion — never
reinventing a historical rate. Rows recorded before payment-time tracking
existed fall back to `formatDisplayMoneyFromContract(payment.amount, 'UZS',
...)`, same as before this fix. A dedicated Sale payment-history table was
added in a later pass — see §19.

**Telegram.** `deviceSoldMessage`/`salePaymentMessage`/
`olibSotdimCreatedMessage` all now take a `contractCurrency` param and
format amounts via `formatContractMoneyWithDisplay`, which now renders only
the shop's selected display currency. `salePaymentMessage` uses the
payment-time rate for the paid input and no longer shows the old paid/applied
two-line breakdown. The three route call sites (`api/devices/[id]/sell`,
`api/sales/[id]/payment`,
`api/olib-sotdim`) were updated to pass their already-computed
contract-native amounts instead of the legacy UZS ones.

**Profit.** At the time of this pass there was no `contractPurchasePrice`/
`contractProfit` field on Sale, and `Device.purchasePrice` was UZS-only — a
new helper, `computeContractCurrencyMargin`, gave a stable, non-inventing
profit figure: for a UZS contract it's a plain subtraction; for a USD
contract, the UZS purchase price is converted using the **frozen creation
rate** (never today's rate) — mathematically identical to dividing the
already-frozen legacy profit snapshot by that same rate, so it never drifts.
It returns `null` only if a USD contract somehow has no creation rate on
record, in which case every display falls back to the original
`salePrice - purchasePrice` / legacy-UZS computation, preserving
`tests/sold-device-profit.test.ts` exactly. A later pass gave Device its own
native purchase currency and generalized this into
`computeSaleContractMargin` — see §20/§21.

**Olib-sotdim.** Reused `buildDeviceSaleInfo` (shared with regular cash
sales) for its sold-device profit display; its `olibSotdimCreatedMessage`
call now passes contract-native purchase/sale/profit amounts. No changes
were made to supplier-payable partial-payment logic (there is none — see
§13).

**Reports.** Not touched in _this_ pass — no report was found reading
Sale's legacy fields in a way that would misrender a _future_ USD sale. A
later pass did fix the one live-aggregate case that mattered (Sale's
`expectedThisMonth`/`overdueMoney`) — see §11 and §21.

## 18. What was deliberately deferred (not silently dropped)

- **No independent currency selector** in creation forms or the payment
  modal, distinct from the shop's global `preferredCurrency` toggle. The
  existing toggle already provides full flexibility once `contractCurrency`
  is frozen per-deal (create a USD deal while displaying USD, then switch
  display to UZS before recording a payment — that alone produces "USD
  contract paid in UZS"). Adding a second selector was assessed as
  unnecessary risk to existing, tested UI wiring for a capability the app
  already has.
- **Device.purchasePrice** stayed UZS-only at the time this section was
  written — since fixed with a native `purchaseCurrency` context, see §20.
  See §22 for what remains genuinely deferred as of the latest pass.

## 19. Sale payment history UI (final cleanup pass)

Sale has no dedicated `/sales/[id]` page — the device detail page
(`src/app/(shop)/shop/qurilmalar/[id]/page.tsx`) is the canonical Sale
detail view (it already renders the "Sotuv ma'lumotlari" card). This pass
added a "To'lov tarixi" table there for `SOLD_CASH` devices, directly below
that card, mirroring the nasiya detail page's own payment-history table:

- `GET /api/devices/[id]` now selects `SalePayment` rows under the sale
  (`where: { deletedAt: null }`, `orderBy: { paidAt: 'asc' }`) together with
  `paymentInputAmount/paymentInputCurrency/paymentExchangeRate/
appliedAmountInContractCurrency`.
- Each row renders via `salePaymentAmountDisplay(payment,
latestSale.contractCurrency, currency)` (already implemented and tested in
  §17/`tests/nasiya-contract.test.ts`) — one selected display currency, using
  the payment-time rate when the original payment input must be converted for
  display. Example: a UZS payment of `6 250 000 so'm` at rate 12 500 displays
  as `"$500.00"` in USD mode and `"6 250 000 so'm"` in UZS mode.
- Legacy `SalePayment` rows recorded before payment-time tracking existed
  fall back to `formatDisplayMoneyFromContract(payment.amount, 'UZS', ...)`
  — today's display currency, never an invented historical rate.
- An empty note renders as `—`, never blank/`undefined` text; an empty
  history shows `"To'lov tarixi hali yo'q"` instead of a broken/empty table.

## 20. Device purchase-price currency context (final cleanup pass)

`Device.purchasePrice` stays exactly as-is — the UZS compatibility
snapshot, dual-written in lockstep on every write, never renamed or
dropped. Four new additive columns carry the device's own native purchase
currency:

- `purchaseCurrency` (`UZS` | `USD`, default `UZS`)
- `purchaseInputAmount` — the raw amount as entered, in `purchaseCurrency`
- `purchaseExchangeRateAtCreation` — nullable, frozen at purchase time
- `purchaseAmountUzsSnapshot` — the UZS-converted amount (identical to
  `purchasePrice`, kept as a separate field for the same reason
  `NasiyaPayment.amount` and `appliedAmountInContractCurrency` are both
  kept — see §3)

**Write paths.** `POST /api/devices` (new device), `PATCH /api/devices/[id]`
(purchase price edit, only while the device is still `IN_STOCK` — money is
locked once financially linked, see the route's existing
`isFinanciallyLinked` guard, unchanged), and `POST /api/olib-sotdim` (the
externally-sourced device) all populate these four fields from the same
`inputCurrency`/`moneyInputToUzs` mechanism already used for every other
money input in this codebase — `purchaseCurrency` defaults to the shop's
current `preferredCurrency` (the existing "Yangi qurilma" form already
sends `inputCurrency: currency.currency`, so no new currency-selector UI was
needed). The restock route and the nasiya-import route intentionally do
**not** touch these fields: restock is a pure `RETURNED -> IN_STOCK` status
flip with no price input, and nasiya-import always creates a device with
`purchasePrice: 0` (original cost genuinely unknown) — the schema defaults
(`purchaseCurrency: 'UZS'`, `purchaseInputAmount: 0`,
`purchaseAmountUzsSnapshot: 0`) already describe that correctly.

**Legacy rows.** The migration
(`prisma/migrations/202607080006_device_purchase_currency/migration.sql`) is
additive-only (`ADD COLUMN`, no drops/renames) and backfills every existing
row to `purchaseCurrency = 'UZS'`, `purchaseInputAmount = purchasePrice`,
`purchaseAmountUzsSnapshot = purchasePrice` — never inventing a historical
USD purchase for a device that was always UZS-only.

**Device detail UI.** The "Kelish narxi" row now shows
`formatContractMoney(device.purchaseInputAmount, device.purchaseCurrency)`
— the device's own native purchase amount, e.g. `"Xarid narxi: $400"` for a
USD purchase, unaffected by whatever the shop's current display currency
happens to be (a historical record, exactly like a sale's contract amount —
see §4). When `purchaseCurrency !== 'UZS'`, a small hint line shows the UZS
snapshot plus the rate **frozen at purchase time** (never today's rate):
`"5 000 000 so'm · kurs: 12 500"`. A UZS-only purchase shows only the plain
UZS figure, with no hint line (nothing to add).

## 21. Profit calculation rule + mixed-currency report aggregate rule (final cleanup pass)

**Profit.** A new helper, `computeSaleContractMargin` (built on top of
`computeContractCurrencyMargin` from §17), is now purchase-currency aware:

- If the sale's `contractCurrency` equals the device's own
  `purchaseCurrency`, the margin is a **plain native subtraction** — e.g.
  bought for $400, sold for $500 → $100 margin, with **zero FX conversion**.
  This is strictly more correct than round-tripping through the UZS
  snapshot (the old behavior), because the purchase-time rate and the
  sale's own creation rate can genuinely differ — converting UZS → USD
  → UZS → USD across two different rates would silently double-count that
  difference as phantom profit or loss.
- If the two currencies differ, it falls back to exactly the §17 behavior:
  convert the purchase's frozen UZS snapshot into the sale's contract
  currency using the **sale's own frozen creation rate** — never today's
  rate, never the purchase's own rate (there is no well-defined way to mix
  two different frozen rates into one number, so the sale's rate is used
  consistently everywhere this margin is computed).
- Returns `null` only when a USD contract has no creation rate on record
  (should not happen for a real USD sale); every caller falls back to the
  original `salePrice - purchasePrice` / legacy-UZS computation in that
  case, preserving `tests/sold-device-profit.test.ts` exactly.

Wired into `shop-lists.ts` (`buildDeviceSaleInfo`, shared by the qurilmalar
list and sold-devices views) and the device detail page's
`saleContractProfit` — both now build a `PurchaseCostLike` object from the
device's own `purchaseCurrency`/`purchaseInputAmount`/
`purchaseAmountUzsSnapshot` instead of assuming a UZS-only cost.

**Mixed-currency report aggregates.** `shop-stats.ts`'s two "current state"
aggregates that sum across all contracts of a given kind —
`expectedThisMonth` and `overdueMoney` — must never raw-sum a USD-native
contract's remaining balance next to a UZS-native one (`$500 + 2,000,000
so'm = 2,000,500` is meaningless). Nasiya's side of this was already fixed
in §10/§11 via `contractOutstandingAsUzs`. This pass fixed the parallel gap
on the Sale side: `unpaidSales`/`overdueSales` now select
`contractCurrency`/`contractRemainingAmount` and convert each sale's own
contract-currency remaining balance to UZS via **today's rate** (a new
shared helper, `convertContractAmountToUzs`, that `contractOutstandingAsUzs`
itself now calls) before summing — never by summing the legacy
`remainingAmount` snapshot directly. This matters because, unlike a
device's one-time purchase conversion, Sale's legacy `remainingAmount` is
decremented by a _sequence_ of payments, each converted at whatever rate was
live on that payment's own day — so for a USD-native sale with several
payments on different days, the legacy snapshot's implicit "rate" is not
even well-defined, and summing it across many sales would silently mix
however many different day-rates happened to apply. Converting from the
single, always-correct `contractRemainingAmount` through one consistent
current rate avoids that entirely. Creation-time profit aggregates were
replaced by the payment-time component ledger in §11.
`inventoryPurchaseCost` remains a frozen UZS stock snapshot; gross live
receivables continue to use the contract-currency balance conversion
described here.

The dashboard and hisobot pages now also carry a small "joriy kurs bo'yicha"
(at today's rate) label/tooltip next to `expectedThisMonth`/`overdueMoney`,
so a shop owner with mixed-currency contracts understands these are live,
rate-dependent conversions rather than a stored ledger total.

## 22. What is fully fixed now, and what (if anything) remains deferred

**Fully fixed as of this pass:** Nasiya (schema, creation, payment/
allocation, completion, schedules, payment score, reminders, Telegram,
historical payment display); Sale (schema, creation, payment, display on
list/detail, `deviceSoldMessage`/`salePaymentMessage`, payment-history UI);
Olib-sotdim/SupplierPayable (schema, creation, reminders, paid-confirmation
message); Device purchase-currency context (schema, creation/edit/
olib-sotdim write paths, purchase-aware profit margin, detail-page display);
import (nasiya import only — see below); the two Sale/Nasiya live report
aggregates that could have raw-mixed currencies (`expectedThisMonth`,
`overdueMoney`).

**Deliberately deferred, not silently dropped:**

- **No independent currency selector** in creation forms or the payment
  modal, distinct from the shop's global `preferredCurrency` toggle (see
  §18) — unchanged, still assessed as unnecessary risk for a capability the
  app already has via the display-currency toggle.
- **Generic audit-log formatter** (`src/lib/log-format.ts`'s
  `formatLogValue`, used by the "Amallar tarixi" log viewers across Shop/
  Device/Customer/Nasiya/Sale) reformats whatever legacy UZS number is
  stored in a `Log.newValue`/`oldValue` JSON blob using the **current**
  display currency/rate at view time — the same double-conversion-drift
  bug class as §10, but for an audit trail rather than a balance. This is a
  much broader, shared, generic utility touched by many unrelated log
  target types; fixing it would require either storing contract-currency
  context on every log row or teaching the formatter about each target
  type's own contract fields, which is a materially larger refactor than
  this pass's scope. Left as a known, documented limitation: log entries
  for a USD-native contract may show a slightly different so'm-equivalent
  figure than they did when first logged, if the rate has since moved. The
  underlying data (the contract-currency ledger itself) is unaffected —
  only this historical-audit display has the limitation.
- **No separate device-level currency import/bulk-import path** beyond
  nasiya import — there is no generic "device import" route in this
  codebase to extend; the one bulk-import flow that exists
  (`POST /api/nasiya/import`) already stores its own `contractCurrency` on
  the created Nasiya (see §14), and creates its device with
  `purchasePrice: 0` (cost genuinely unknown), which the new
  `purchaseCurrency` defaults already describe correctly with no extra
  code needed.
- **Device CSV/XLSX exports** (`/api/export/[entity]`) now expose the frozen
  native purchase amount/currency/rate and UZS snapshot as separate columns,
  alongside the legacy-UZS and current shop-display values. This preserves
  the original acquisition context without raw-mixing currencies.

## 23. Production incident: device detail page crash on USD-native sales (fixed)

**Symptom**: `/shop/qurilmalar/[id]` crashed with Next.js's generic
client-side error boundary ("This page couldn't load. Reload to try
again.") after a device was marked sold, on some reloads.

**Root cause**: a Prisma `Decimal` column serializes to a JSON **string**
once it crosses `NextResponse.json()` → `fetch().json()` into the browser —
this was already a known, previously-fixed issue for
`Device.purchasePrice` (`currency.ts`'s `convertUsdToUzs`/`convertUzsToUsd`
were hardened to accept `number | string` for exactly this reason; see the
regression comment in `tests/currency.test.ts`). The newer helpers added
across the Sale/Nasiya contract-currency work in `src/lib/nasiya-contract.ts`
(`formatContractMoney`, `formatDisplayMoneyFromContract`,
`formatContractMoneyWithDisplay`, `computeContractCurrencyMargin`,
`computeSaleContractMargin`, `salePaymentAmountDisplay`,
`roundContractMoney`, `contractScheduleOutstanding`,
`convertContractAmountToUzs`, `convertPaymentToContractCurrency`) never
received the same hardening — `formatContractMoney` called
`amount.toFixed(2)` directly for a USD amount, which throws
`TypeError: amount.toFixed is not a function` when `amount` is actually a
string. This affected any sale/purchase/payment whose relevant currency was
USD (a first-class, common case in this app, not an edge case) — e.g. a
device with a USD `purchaseCurrency`, or a sale with a USD `contractCurrency`
displayed in the shop's own USD display mode (the "same currency, no
conversion" branch passes the raw un-converted value straight through, so
it was never protected by the multiplication-based coercion that
conversion functions get for free).

**Not the cause**: this was verified NOT to be a missing production
migration. The crash signature itself is diagnostic evidence: a missing
column would fail the Prisma query server-side (caught by the route's
`try/catch`, returning a JSON `{success:false}` response — the client would
show "Qurilma topilmadi", not a React render-crash overlay). The specific
overlay the user saw only happens on an _uncaught client-side JavaScript
exception during render_, exactly matching the `.toFixed()` TypeError.
Production (`https://oryx-tech-erp.vercel.app/api/health`, checked directly)
was confirmed live and healthy on the latest deployed commit at the time of
this fix.

**Fix**: every money-accepting function in `nasiya-contract.ts` now accepts
`number | string` and calls `Number(...)` before any arithmetic or
`.toFixed()`, mirroring the exact pattern already established in
`currency.ts`. `PurchaseCostLike`/`SalePaymentLike` interfaces were widened
to match. See `tests/device-detail-crash-fix.test.ts` for the full set of
serialized-Decimal-string regression tests (one per hardened function,
plus page-level guard tests confirming every `.toFixed()` call site in the
device detail page is fed by a hardened conversion, never a raw API field).

### 23a. Second, distinct crash: the same bug in the RATE parameter, not just the amount

**Symptom**: the device detail page kept crashing after the §23 fix
deployed (confirmed live via `/api/health`'s `commit` field).

**Root cause**: `currency.ts`'s `convertUsdToUzs`/`convertUzsToUsd` had
already been hardened to coerce their `amount` parameter
(`Number(amountUsd)`/`Number(amountUzs)`) — but **not** their `rate`
parameter, which was passed straight into `assertRate(rate)`. `assertRate`
uses the strict, non-coercing `Number.isFinite(rate)` check, which returns
`false` for a string even when it represents a perfectly valid rate.
`Sale.contractExchangeRateAtCreation` and `Device.purchaseExchangeRateAtCreation`
are both `Decimal?` columns, so they arrive as JSON strings exactly like
every other Decimal field — and `computeContractCurrencyMargin` (called by
`computeSaleContractMargin` for the device detail page's profit figure)
passes `contractExchangeRateAtCreation` straight through as the `rate`
argument to `convertUzsToUsd`. The §23 fix hardened every _amount_
argument in `nasiya-contract.ts` but this one function still leaked an
un-coerced _rate_ argument into `currency.ts`'s stricter check.

This reproduces whenever a device's `purchaseCurrency` differs from its
sale's `contractCurrency` — e.g. a device purchased in UZS (the common
default) and sold as a USD contract — which is a realistic, everyday
scenario, not a rare edge case. That mismatch is exactly what routes
`computeSaleContractMargin` into the `computeContractCurrencyMargin`
fallback branch that uses the frozen creation rate.

**Fix**: `convertUsdToUzs`/`convertUzsToUsd` in `currency.ts` now coerce
`rate` via `Number(rate)` before `assertRate`, the same as `amount` always
was. Every `rate`/`contractExchangeRateAtCreation`-shaped parameter across
`nasiya-contract.ts` was widened from `number | null` to
`number | string | null` to match the real runtime shape, with the
truthy/`<= 0` guard comparisons updated to coerce first. The device detail
page's `Sale.contractExchangeRateAtCreation`/`Device.purchaseExchangeRateAtCreation`
TypeScript field types were widened to match, so the type system stops
lying about the actual runtime shape.

**Additional hardening added in the same pass** (defense-in-depth, not
required to fix the crash but explicitly requested): `formatContractMoney`
and `formatDisplayMoneyFromContract` now return `"—"` instead of
`"$NaN"`/`"NaN so'm"` for a genuinely non-finite amount (missing/corrupt
data), and `computeContractCurrencyMargin` returns `null` instead of
attempting a conversion that would throw. The device detail page now shows
an explicit warning card ("Bu qurilma sotilgan deb belgilangan, lekin savdo
yozuvi topilmadi.") if a device is marked `SOLD_CASH` but its `Sale`
relation is unexpectedly missing, instead of silently rendering nothing.

See `tests/sold-device-detail-rate-crash-fix.test.ts` for the full
regression suite: a worked example of the exact UZS-purchase/USD-sale
scenario, direct tests of the now-hardened `rate` parameter, and the
NaN-safety tests.

## 24. Nasiya allocation rate-drift edge case — found real, fixed

**Deferred status before this fix**: an earlier audit flagged "a schedule
whose legacy UZS math says PAID could, after rate drift, still have a small
real balance on the contract-currency side" as a low-probability, deferred
edge case. On direct investigation this pass, the bug is real, reproducible,
and — in one direction — actively user-facing (a live Telegram reminder bug),
not just a bookkeeping nicety. It has now been fixed.

**Root cause**: `POST /api/nasiya/[id]/payment`'s per-schedule allocation
loop decided `isFullyPaid` (and therefore the schedule's `status`) purely
from the LEGACY UZS ledger (`scheduleOutstanding(expectedAmount, paidAmount)`),
even though the payment amount actually applied is dual-tracked in both
ledgers. `expectedAmount` is a snapshot frozen at the nasiya's CREATION
exchange rate; `paidAmount` accumulates from payments converted at EACH
PAYMENT's OWN rate (`moneyInputToUzs`, today's rate at payment time — not
the creation rate). Once a USD-native nasiya is paid across two or more
payments at genuinely different exchange rates, the legacy UZS sum and the
true contract-currency sum can disagree about whether one particular
schedule is actually done:

```
Schedule: $100 owed, created when the rate was 12,000 -> legacy
expectedAmount = 1,200,000 so'm (frozen forever).

Payment 1: $60 paid @ rate 11,000 -> legacy applied 660,000.
Payment 2: $40 paid @ rate 11,000 -> legacy applied 440,000.
Legacy total: 1,100,000 (100,000 so'm SHORT of expectedAmount)
  -> legacy math alone says: NOT fully paid.

Contract total: $60 + $40 = $100 = contractExpectedAmount exactly
  -> contract math says: FULLY paid.
```

Left legacy-driven, this schedule stays at status `PARTIAL`/`OVERDUE`
forever, even though the customer's real (contract-currency) debt for it is
$0. **This is not just cosmetic**: `src/app/api/cron/reminders/route.ts`
selects schedules for a Telegram reminder purely by `NasiyaSchedule.status`
(`{ in: ['PENDING', 'PARTIAL', 'DEFERRED', 'OVERDUE'] }`) and does not check
whether the parent nasiya itself is `COMPLETED` — so this drift could send a
live "you owe money" Telegram reminder for a schedule that is, in truth,
already fully paid off.

A second, opposite direction of the same root cause was also found: if the
exchange rate moves the other way, the LEGACY ledger can close a schedule
"for less than it should" relative to contract truth, silently absorbing a
rate-driven excess with no functional harm (see the worked "reverse drift"
example in `tests/nasiya-allocation-rate-drift.test.ts`) — this direction
was already effectively harmless (nasiya-level completion was already
contract-driven), but is now handled by the exact same fix for consistency.

A third symptom of the same root cause: the payment route's "does this
payment exceed the remaining debt" validation gate compared a today's-rate
payment amount (`amountUzs`) against a **legacy-UZS-summed** total
outstanding (frozen at each schedule's own creation rate). After enough
rate movement, this legacy sum can differ from the real remaining contract
debt — wrongly REJECTING a legitimate final payment ("To'lov qolgan nasiya
summasidan oshib ketdi") when the legacy sum understates real debt, or
wrongly ALLOWING a real overpayment through when it overstates it.

**Fix**: the per-schedule allocation loop was extracted into a new pure,
directly-unit-testable module, `src/lib/nasiya-payment-allocation.ts`
(`allocateNasiyaPayment`/`totalContractOutstanding`), and the API route now
calls it instead of the old inline loop:

- `isFullyPaid` / schedule `status` is now decided ENTIRELY from the
  contract-currency ledger (`contractScheduleOutstanding`), the same ledger
  nasiya-level completion (`contractAllFullyPaid`) already trusted — never
  the legacy UZS snapshot.
- The legacy `paidAmount` is still updated (kept as a compatibility
  snapshot for existing readers) but is SNAPPED to `expectedAmount` in
  lockstep whenever the contract ledger says the schedule is done — the
  exact same pattern already used at the nasiya level
  (`remainingToStore = contractAllFullyPaid ? 0 : remaining`), just applied
  one level down, to each schedule row.
- The overpayment validation gate now compares
  `appliedAmountInContractCurrency` against a CONTRACT-currency-summed
  `totalContractOutstanding` across the eligible schedules — never a
  legacy-UZS sum — eliminating both false-rejection and false-allowance
  directions of the drift.
- Historical payment display is untouched by this fix: `paymentInputAmount`/
  `paymentInputCurrency`/`paymentExchangeRate`/`appliedAmountInContractCurrency`
  on each `NasiyaPayment` row are frozen at write time exactly as before —
  this fix only changes how the SCHEDULE's own running status is decided,
  never re-derives a historical payment's own recorded figures.

**Residual risk (data, not code)**: this fix only affects payments made
AFTER it lands. Any nasiya schedule rows that ALREADY drifted in a
production database before this fix (a schedule whose legacy `status`
disagrees with its real contract-currency debt, from a past multi-rate
payment history) are not retroactively corrected by this code change alone
— a one-time backfill/audit script would be needed to reconcile existing
rows, which was out of scope for this pass (no such drifted rows were
identified or reported; this is a documented "if it turns out to matter"
follow-up, not a known active problem).

See `tests/nasiya-allocation-rate-drift.test.ts` for the full proof: the
exact bug scenario reproduced and fixed, the reverse-direction case, the
no-drift regression case (unchanged behavior), a UZS-native control case,
overdue-still-due-date-driven regression, and multi-schedule allocation
order. `tests/nasiya-payment-allocation.test.ts` and
`tests/nasiya-payment-contract-currency.guard.test.ts` were updated to
assert the new pure-function-based call sites instead of the removed
inline loop.

## 25. Nasiya payment allocation dust tolerance — fixed

**Symptom**: a suggested/current-month nasiya payment could leave a tiny
floating-point/conversion remainder such as `$0.004`, which formatted as
`$0.00` but was still treated as a real overpayment by the allocation flow.
That could create a fake next-month allocation, mark the next schedule
`PARTIAL`, show the modal warning ("Ortiqcha $0.00 keyingi oy..."), include
a Telegram allocation line, or write misleading allocation data into logs.

**Rule**: dust is defined in the contract's own currency before promoting a
remainder into a real allocation:

- USD: amounts smaller than `$0.01` are ignored; `$0.01` and above remain
  meaningful.
- UZS: amounts smaller than `500 so'm` are ignored; `500 so'm` and above
  remain meaningful, preserving the existing completion tolerance.

**Fix**:

- Added `isContractCurrencyDust()` in `src/lib/nasiya-contract.ts` so the
  tolerance rule is shared by server allocation, API validation, UI preview,
  and Telegram rendering.
- `allocateNasiyaPayment()` now rounds the remaining contract-currency
  amount and stops before touching another schedule if the remainder is
  dust. Dust-only payments therefore create no schedule update and never
  mark a schedule `PARTIAL`.
- The payment route's "payment exceeds remaining debt" guard still rejects
  real overpayments, but allows dust-sized excess so an exact final payment
  is not blocked by conversion noise.
- The nasiya payment modal computes `overpayExtraContract` through the same
  dust helper, so it no longer shows a `$0.00` / tiny-so'm next-month
  warning.
- `nasiyaPaymentMessage()` filters dust allocations defensively, so even if
  an old/hand-built caller passes a `$0.004` allocation, Telegram will not
  render a fake `$0.00 2-oyga oldindan qo'llandi` line.

Regression coverage:

- `tests/nasiya-allocation-rate-drift.test.ts`: USD dust does not allocate,
  UZS `1–499 so'm` dust does not allocate, real `$0.01` overpayment still
  allocates, and dust-only payment leaves the current schedule untouched.
- `tests/nasiya-payment-message-contract-currency.test.ts`: Telegram filters
  `$0.00` dust allocations.
- `tests/currency-consistency.guard.test.ts`: modal warning remains guarded
  by `isContractCurrencyDust`.
- `tests/nasiya-payment-allocation.test.ts` /
  `tests/nasiya-payment-contract-currency.guard.test.ts`: API/allocation
  source guards verify the shared helper remains wired into the route and
  pure allocator.

## 26. Nasiya status is contract-authoritative — P0-01 fixed

**Invariant:** a Nasiya schedule or parent is paid/completed only from its
native contract-currency balance. The historic UZS `expectedAmount`,
`paidAmount`, and parent `remainingAmount` fields are compatibility mirrors;
they may diverge when a payment is converted at a different USD/UZS rate and
must never decide financial state.

`src/lib/nasiya-contract-status.ts` is the shared read-path derivation:

- a schedule is `PAID` only when
  `contractExpectedAmount - contractPaidAmount` is below the strict native
  dust threshold; `$0.01` / `500 so'm` remain meaningful debt;
- otherwise the schedule is `OVERDUE` after
  `delayedUntil ?? dueDate`, `PARTIAL` after a native partial payment, and
  `PENDING`/`DEFERRED` otherwise;
- a parent is `COMPLETED` only when every native schedule is paid. A stored
  `COMPLETED` parent is not trusted if a native schedule still owes money.

The Nasiya list, detail API, CSV/XLSX export, dashboard active-count
correction, and payment route use this derivation. The detail GET endpoint is
read-only: it no longer writes a best-effort `COMPLETED` status based on a
legacy UZS read. The payment endpoint rejects only a **contract-complete**
parent, so a stale raw `COMPLETED` row can still receive its real final
payment.

Historical records are not automatically rewritten during reads. See
`docs/nasiya-contract-status-repair-plan.md` for the approved dry-run,
reconciliation, audit, and verification procedure.

## 27. Sale payment acceptance is contract-authoritative — P0-02 fixed

**Invariant:** the native Sale contract ledger decides whether a payment is
allowed. `contractRemainingAmount`, `contractAmountPaid`,
`contractSalePrice`, and `contractCurrency` take precedence over the legacy
UZS `remainingAmount`, `amountPaid`, and `salePrice` snapshots.

`src/lib/sale-contract-payment.ts` provides the pure settlement decision used
inside `POST /api/sales/[id]/payment`'s existing serializable transaction:

- the payment input is converted once using its payment-time USD/UZS rate;
- the converted amount is accepted/rejected only against
  `contractRemainingAmount`, with the shared strict contract-currency dust
  rule (`$0.01` / `500 so'm` remain meaningful);
- a real overpayment is rejected, while an excess below the dust threshold is
  clamped to the debt actually applied;
- when native debt reaches zero, the sale is marked paid and the legacy UZS
  `remainingAmount` snapshot is snapped to zero. For a partial payment, that
  legacy snapshot is reduced as before and clamped non-negative.

This means a `$100` debt created at `12,000 UZS/USD` accepts an exact `$100`
payment after a `13,000 UZS/USD` rate change, even though its payment-time
UZS snapshot is `1,300,000` and the legacy remaining snapshot was
`1,200,000`. The original customer-entered amount/currency/rate remains on
`SalePayment`, as does the native amount actually applied to debt; history and
Telegram continue to render one shop-display currency from those frozen
payment-time values.

The route retains shop-scoped lookup, idempotency, serializable retry, split
payment validation, notifications, and cache invalidation. The remaining
limitation is test infrastructure: unit and source-guard coverage prove the
contract math and route wiring, but a disposable Postgres API/concurrency test
is still a P1 follow-up.
