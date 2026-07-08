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
- **Sale's live aggregates** (`expectedThisMonth`, `overdueMoney`, via
  `unpaidSales`/`overdueSales`) were fixed in the same later pass that added
  §21's `convertContractAmountToUzs` — see §21 for why the legacy
  `remainingAmount` alone was not safe to keep summing for these two
  figures.

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
the legacy `payable.amount` — the same double-conversion-drift bug as §10
applied here too (a payable's `amount` is frozen at creation rate; a paid
confirmation or reminder sent later, at a different rate, would have
misstated a USD-native payable's true amount).

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
  narxi" (with an optional "Shartnoma: $X" reference line shown only when
  display currency differs from contract currency), "Farq / Foyda",
  "To'langan", "Qolgan", and the "pay remaining" prefill button (now via
  `convertPaymentToContractCurrency`, with a safe string fallback when no
  rate is available client-side).
- `src/lib/server/shop-lists.ts` (`buildDeviceSaleInfo`, shared by both cash
  sale and nasiya sold-device rows) — additive `contractSoldPrice`/
  `contractProfit` fields alongside the untouched legacy `soldPrice`/
  `profit`.

**Payment history.** `salePaymentAmountDisplay` (in `nasiya-contract.ts`) is
the Sale counterpart of Nasiya's `paymentAmountDisplay`: it shows the
payment-time native amount, or (when payment currency differs from contract
currency) "paid X → applied Y · kurs: Z", using `paymentInputAmount/
Currency/paymentExchangeRate/appliedAmountInContractCurrency` — never
reinventing a historical rate. Rows recorded before payment-time tracking
existed fall back to `formatDisplayMoneyFromContract(payment.amount, 'UZS',
...)`, same as before this fix. A dedicated Sale payment-history table was
added in a later pass — see §19.

**Telegram.** `deviceSoldMessage`/`salePaymentMessage`/
`olibSotdimCreatedMessage` all now take a `contractCurrency` param and
format amounts via `formatContractMoneyWithDisplay` (native amount leads,
`(~display equivalent)` is an optional secondary hint) — e.g. "Sotuv narxi:
6 250 000 so'm (~$480.77)" for a UZS-native sale viewed while the shop
displays USD, or "Sotuv narxi: $500.00" unchanged forever for a USD-native
sale regardless of today's rate. `salePaymentMessage`'s paid/applied
two-line breakdown now triggers when the payment currency differs from the
sale's own **contract** currency (not the shop's display currency) — the
same fix already applied to `nasiyaPaymentMessage` in §12. The three
route call sites (`api/devices/[id]/sell`, `api/sales/[id]/payment`,
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

**Reports.** Not touched in *this* pass — no report was found reading
Sale's legacy fields in a way that would misrender a *future* USD sale. A
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
  §17/`tests/nasiya-contract.test.ts`) — payment-time native amount, or
  "paid X → applied Y · kurs: Z" when payment currency differs from
  contract currency, never a live reconversion at today's rate. Example
  rows: `"6 250 000 so'm → $500.00 · kurs: 12 500"` (USD sale paid in UZS),
  `"$160.00 → 2 000 000 so'm · kurs: 12 500"` (UZS sale paid in USD), or a
  single `"$500.00"` when nothing was converted.
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
decremented by a *sequence* of payments, each converted at whatever rate was
live on that payment's own day — so for a USD-native sale with several
payments on different days, the legacy snapshot's implicit "rate" is not
even well-defined, and summing it across many sales would silently mix
however many different day-rates happened to apply. Converting from the
single, always-correct `contractRemainingAmount` through one consistent
current rate avoids that entirely. **Creation-time aggregates**
(`accrualRevenueThisMonth`, sold-device profit, `inventoryPurchaseCost`)
remain untouched — each device/sale/nasiya contributes a single,
frozen-at-its-own-creation-rate UZS number, and summing many independently-
frozen numbers is ordinary, correct accounting with no reconversion
involved (see §11).

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
- **Sold-device list/CSV exports** (`/api/export/[entity]`) show each row's
  own legacy-UZS and display-currency amount side by side — this is a
  per-row historical export, not a summed aggregate, so it was not touched
  and carries no mixed-currency risk.
