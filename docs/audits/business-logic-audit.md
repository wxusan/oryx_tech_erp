# Business logic audit — Oryx Tech ERP

Date: 2026-07-08. See `full-production-audit.md` for the overall scorecard.

## 1. Device lifecycle

Sell, create-nasiya, return, and restock all guard their status transition
with an atomic `updateMany({ where: { id, shopId, status: <expected> } })`
+ `count !== 1 → 409 conflict` check inside a transaction — verified for
all four routes. A device cannot be sold twice, nasiya'd twice, returned
twice, or restocked from a non-RETURNED state, even under concurrent
requests. **Verdict: correct.**

## 2. Nasiya

### 2.1 Payment allocation

`src/app/api/nasiya/[id]/payment/route.ts`: payments allocate
oldest-unpaid-first (the explicitly-selected schedule first, then by
effective due date), using `Math.min(remaining, outstanding)` per schedule
on BOTH the legacy UZS ledger and the contract-currency ledger in parallel,
each independently tolerance-snapped via `scheduleOutstanding`/
`contractScheduleOutstanding`. Verified against the four worked examples in
`docs/currency-accounting-model.md` (USD paid in UZS, UZS paid in USD, and
both directions with overpayment) and `tests/nasiya-payment-allocation.test.ts`.

**One real, low-probability edge case identified and deferred (P2):** the
PAID-schedule filter that builds `allocationRows` (line ~163) excludes a
schedule once its **legacy** UZS math says it's paid
(`scheduleOutstanding(...) <= 0`). If, after enough exchange-rate drift
across multiple payments on the same nasiya, a schedule's legacy math
settles before its contract-currency math does, that schedule would be
skipped by the allocation loop while still genuinely owing a small
contract-currency balance. This does **not** let the nasiya as a whole be
marked COMPLETED incorrectly — `contractAllFullyPaid` (line ~333) checks
`contractScheduleOutstanding` independently for **every** schedule,
including ones the allocation loop skipped, so a real remaining balance on
any schedule keeps the whole nasiya OVERDUE/ACTIVE. The practical effect
would be a payment redirected to a different (later) schedule instead of
the one it should have closed — a bookkeeping precision issue, not a
"debt forgiven" or "false completion" issue.

**Why not fixed this pass:** correcting this requires making the
schedule-selection filter itself dual-ledger-aware, which touches the same
allocation loop that has been the single most heavily-tested, most
carefully-evolved piece of logic across this project's history (Examples
A–D, the rounding-tolerance fix, the currency-aware tolerance fix). Nasiya
is explicitly the highest-risk flow in this codebase per prior engineering
direction ("focus first on Nasiya because that is the most important and
risky business flow... do not deeply refactor unless necessary and fully
tested"). Rewriting the filter under this audit's time budget, without a
dedicated new test suite proving every existing allocation scenario still
holds, would risk introducing a real regression to fix a narrow, low-
probability edge case. **Next step if a client actually hits this**: add a
schedule-level contract-currency guard to the filter
(`contractScheduleOutstanding(...) > 0` in addition to the legacy check),
and re-run the full Examples A–D + rounding-tolerance test suite before
shipping.

### 2.2 Completion ("Yakunlangan")

`contractAllFullyPaid` (contract-currency, tolerance-aware) drives the
`COMPLETED` status decision, not the legacy UZS remainder — this was
already fixed in a prior pass and is confirmed correct. A USD nasiya
cannot be marked complete while it genuinely owes money, nor stuck ACTIVE
over UZS-sized rounding dust. **Verdict: correct.**

## 3. Sale (cash sale) — P0 found and fixed

`src/app/api/sales/[id]/payment/route.ts` previously decided `paidFully`
and snapped `contractRemainingAmount` to 0 based **only** on the legacy UZS
remainder (`nextRemaining <= 0`), never on the sale's own contract-currency
balance. Unlike Nasiya (which already decided completion from
`contractAllFullyPaid`), Sale never received the equivalent fix in an
earlier pass.

**Why this is a real bug:** for a USD-native sale, the legacy `remainingAmount`
is decremented by each payment's amount **converted to UZS using whatever
rate was live on that payment's own day** (`moneyInputToUzs` always fetches
today's rate for a non-UZS payment). The contract-currency remainder,
meanwhile, decrements by the exact native amount applied. Once the rate has
moved between two payments on the same sale, these two remainders can cross
zero at different moments. Deciding `paidFully` from the legacy side alone
could therefore:

- mark a sale fully paid while real USD debt remains (silently forgiving
  debt the shop is owed), or
- keep a sale open (and the customer nagged for payment) after the
  contract-currency balance has genuinely settled to zero.

**Fix**: mirrors the Nasiya payment route exactly. `contractScheduleOutstanding`
(currency-aware tolerance: 500 so'm / $0.01) now decides `contractFullyPaid`
from the contract ledger; `paidFully`, `dueDate`, `reminderEnabled`, and the
Telegram message's `remaining` figure all read from that decision; the
legacy `remainingAmount` is snapped to 0 in lockstep once the contract side
is settled (`remainingToStore`), matching Nasiya's `remainingToStore`
pattern. A defense-in-depth guard was also added: the "already fully paid"
rejection at the top of the route now checks the contract ledger too, not
just the legacy one.

Files changed: `src/app/api/sales/[id]/payment/route.ts`.
Tests added: `tests/sale-payment-completion-currency-fix.test.ts` (a worked
numeric example proving the legacy/contract divergence, plus 4 tests
pinning the exact fixed decision logic in the route). Existing guard tests
(`tests/sale-display-drift-fix.guard.test.ts`,
`tests/sale-supplier-payable-contract-currency.guard.test.ts`) updated to
match the corrected code.

## 4. Olib-sotdim (external device sale) — P1 found and fixed

Creation logic (`POST /api/olib-sotdim`) is correct: `supplierPaidNow=false`
creates a PENDING `SupplierPayable` with the required due date; `true`
creates it already PAID with no dangling reminder risk (the cron query only
ever selects PENDING/OVERDUE, so a PAID row is naturally excluded — no
separate "cancel reminder" step needed). Profit (`contractSalePrice -
contractPurchasePrice`) can be negative (a loss resale) and is rendered
with red/green coloring in both the Telegram message and the create-form UI
— checked directly, this already worked correctly (a sub-agent's report
that profit "wasn't rendered" did not hold up on inspection).

**P1 found**: `PATCH /api/olib-sotdim/[id]/pay` (mark supplier payable as
paid) used a plain `update()` by id, with the "already paid" check
performed **before** the transaction. Two concurrent requests (e.g. a
double-click) could both pass that check before either committed, then
both succeed — firing two Telegram confirmations and two `Log` rows for
the same payable.

**Fix**: switched to the same atomic `updateMany({ where: { id, shopId,
deletedAt: null, status: { not: 'PAID' } } })` + `count !== 1 → 409` pattern
already used by the device sell/nasiya/restock/return routes.

Files changed: `src/app/api/olib-sotdim/[id]/pay/route.ts`.
Tests added: two new tests in `tests/olib-sotdim.guard.test.ts` pinning
the atomic pattern and the 409 rejection path.

## 5. Supplier payable

Creation, contract-currency tagging, and reminder/paid-message behavior
were already correct from a prior pass. The one correctness gap (atomicity
of the pay route) is the same P1 fixed in §4.

## 6. Currency accounting (cross-cutting)

- **USD contract paid in UZS / UZS contract paid in USD**: correct for
  Nasiya (already fixed); now also correct for Sale (this pass's fix).
- **USD device purchase sold in USD / USD purchase sold in UZS**: `computeSaleContractMargin`
  (added in the prior "sale purchase and report currency accounting" pass)
  uses a plain native subtraction when purchase currency matches sale
  contract currency (avoiding double-counting an FX difference between
  purchase-time and sale-time rates), and falls back to the frozen-rate
  conversion otherwise. Verified via `tests/nasiya-contract.test.ts`.
- **Mixed USD/UZS reports**: `shop-stats.ts`'s live aggregates
  (`expectedThisMonth`, `overdueMoney`) convert each Nasiya's and each
  Sale's own contract-currency balance to UZS via today's rate before
  summing — no raw mixed-currency sum found. Creation-time aggregates
  correctly keep summing frozen legacy snapshots.
- **Historical payment display**: payment-time fields
  (`paymentInputAmount`/`Currency`/`ExchangeRate`/`appliedAmountInContractCurrency`)
  are preserved and never re-derived from today's rate, for both Nasiya and
  Sale.
- **Import validation**: `importNasiyaSchema` already rejects negative
  amounts and enforces `remainingDebt <= originalTotalAmount` server-side
  via Zod — a sub-agent's suggestion that a "direct API caller could bypass
  form-level validation" does not hold up, since Zod validation runs on the
  API route itself, not just in the browser form.

## Summary table

| ID | Severity | Flow | Issue | Fixed? | Files changed |
|---|---|---|---|---|---|
| BL-P0-1 | P0 | Sale payment | Completion decided from legacy ledger, not contract ledger | Yes | `src/app/api/sales/[id]/payment/route.ts` |
| BL-P1-1 | P1 | Olib-sotdim / Supplier payable | Mark-paid race condition (duplicate notifications) | Yes | `src/app/api/olib-sotdim/[id]/pay/route.ts` |
| BL-P2-1 | P2 | Nasiya allocation | Rate-drift edge case in schedule-selection filter | No — deferred, see rationale above | — |

No other business-logic bugs were confirmed. Device lifecycle,
return/restock, nasiya completion, supplier payable, and profit calculation
are all correct as verified.
