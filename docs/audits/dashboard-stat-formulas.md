# Dashboard / Hisobot stat formulas — Oryx Tech ERP

Date: 2026-07-08. Ground truth for every dashboard/report card, extracted
directly from the actual code (`src/lib/shop-stats-formulas.ts` /
`src/lib/server/shop-stats.ts`), not assumed. Both `/shop/dashboard` and
`/shop/hisobot` call the exact same `getShopStats(session, shopId)` →
`computeShopStatsFromRows(rows)` pipeline, so they can never disagree for
the same month/shop — there is only one stats object, read by both pages.

## The bug that was reported

"After marking a phone as sold, Sotuv foydasi / Sof foyda increases
correctly, but Umumiy aylanma / Umumiy daromad does not change."

**Root cause, proven** (see `tests/shop-stats-formulas.test.ts`): these two
cards use two different, both-legitimate accounting bases that were never
documented as such:

- **Sotuv foydasi** (`accrualGrossProfitThisMonth`) is **ACCRUAL** — every
  `Sale`/`Nasiya` row *created* this month counts at its full margin the
  instant the deal happens, regardless of whether the customer has paid
  yet. This matches standard retail practice (profit is realized when
  goods change hands) and is the same recognition Nasiya has always used.
- **Umumiy aylanma** (`grossCashInThisMonth`) is **CASH** — only money that
  has actually been *received* (a `SalePayment`/`NasiyaPayment` row with
  `paidAt` this month) counts. This is this ticket's own recommended
  definition, and matches its sibling metric "Sof tushum" right next to it.

For a cash sale that is **fully paid at creation** (the sell route creates
a `SalePayment` for the full amount in the same transaction as the `Sale`
row), both bases agree and both cards move together — proven in
`tests/shop-stats-formulas.test.ts`. For a sale created with a partial or
zero down payment, profit is recognized immediately while turnover only
grows once a payment is actually collected — this is intentional, was
previously **undocumented**, and is now: (a) written down here, (b)
surfaced as tooltips/captions on the cards themselves (see
`src/app/(shop)/shop/dashboard/page.tsx` and `.../hisobot/page.tsx`), and
(c) regression-tested so it can never silently regress into an actual bug
(e.g. a fully-paid sale failing to move both together).

No cache-invalidation bug, no query-date-range bug, and no currency-
conversion bug were found — see "Investigated and ruled out" below.

## Formula table

| Card | Formula | Includes | Excludes | Date field | Currency rule | Cache invalidation |
|---|---|---|---|---|---|---|
| **Umumiy aylanma** (dashboard "Bu oy pul oqimi"; hisobot "Bu oy tushgan pul") | `grossCashInThisMonth` = `Σ SalePayment.amount` + `Σ NasiyaPayment.amount`, both legacy-UZS, both frozen at their own payment time | Any sale/nasiya payment actually recorded this month, regardless of when the underlying sale/nasiya was created | Unpaid/future nasiya debt; a sale's un-collected remaining balance; supplier payables; inventory value | `SalePayment.paidAt` / `NasiyaPayment.paidAt` | Cash basis — no live conversion; sums the legacy UZS amount frozen at each payment's own time (see §10/§23 of `docs/currency-accounting-model.md` for why re-deriving via today's rate would be wrong) | `invalidateShopSaleMutation`, `invalidateShopPaymentMutation`, `invalidateShopNasiyaMutation`, `invalidateShopDeviceMutation`, `invalidateShopReturnMutation` (all include `stats`+`reports` tags) |
| **Sof tushum** | `netCashFlowThisMonth` = `grossCashInThisMonth` − `returnRefundsThisMonth` | Same as Umumiy aylanma, minus refunds paid out this month | Same exclusions as Umumiy aylanma | Same as Umumiy aylanma, plus `DeviceReturn.createdAt` for refunds | Same as Umumiy aylanma | Same as Umumiy aylanma, plus `invalidateShopReturnMutation` |
| **Sotuv foydasi / Sof foyda** | `accrualGrossProfitThisMonth` = `Σ Sale.salePrice` (sales created this month) + `Σ Nasiya.totalAmount` (nasiyas created this month, excluding imports) − `Σ Device.purchasePrice` for those same sold devices | Every Sale/Nasiya **created** this month, at full value, regardless of payment status | Imported (pre-Oryx) nasiyas — carried-over debt, not a new sale | `Sale.createdAt` / `Nasiya.createdAt` | Legacy-UZS creation-time snapshot sum — each row is frozen at its own creation rate; summing many frozen snapshots from different dates is ordinary, correct accrual accounting (no reconversion) | `invalidateShopSaleMutation`, `invalidateShopNasiyaMutation`, `invalidateShopDeviceMutation`, `invalidateShopReturnMutation` |
| **Kutilmoqda** | `expectedThisMonth` = Σ (per-nasiya-schedule `contractOutstandingAsUzs`) for schedules due this month + Σ (per-sale `convertContractAmountToUzs(contractRemainingAmount)`) for sales due this month | Only schedules/sales with an unpaid balance **and** a due date inside this month | Already-paid schedules/sales (tolerance-snapped to 0); schedules/sales due outside this month | `NasiyaSchedule.dueDate`/`delayedUntil`, `Sale.dueDate` | Live conversion — each row's own contract-currency balance converted to UZS via **today's** rate, exactly once, never a raw sum of mixed USD/UZS balances | Same as Sotuv foydasi, plus `invalidateShopOverdueCron` |
| **Kechikkan to'lovlar** (`overdueMoney`/`overdueCount`) | Same per-row outstanding-balance logic as Kutilmoqda, filtered to `effectiveDue < now` instead of "due this month" | Genuinely unpaid schedules/sales past their due date (currency-aware tolerance: 500 so'm / $0.01) | Paid/tolerance-settled schedules; not-yet-due schedules | Same as Kutilmoqda | Same as Kutilmoqda | Same as Kutilmoqda |
| **Ombordagi tannarx** | `inventoryPurchaseCost` = `Σ Device.purchasePrice` where `status IN (IN_STOCK, RESERVED)` | Devices currently in stock or reserved | Sold/returned/deleted devices — the moment a device's status flips away from IN_STOCK/RESERVED (e.g. on sale), the next fetch of this aggregate excludes it automatically (no separate "remove from inventory" step needed) | N/A (point-in-time status, not date-ranged) | Legacy-UZS purchase price, one-time frozen conversion per device — safe to sum across devices bought at different rates (see `docs/currency-accounting-model.md` §11) | `invalidateShopDeviceMutation`, `invalidateShopSaleMutation`, `invalidateShopNasiyaMutation`, `invalidateShopReturnMutation` |
| **Naqd sotuvlar** | `soldThisMonth` = count of `cashSalesThisMonth` rows | Every Sale created this month | Nasiyas (tracked separately as "Faol nasiyalar") | `Sale.createdAt` | N/A (a count) | `invalidateShopSaleMutation` |
| **Faol nasiyalar** | `activeNasiyalar` = count of `Nasiya` where `status IN (ACTIVE, OVERDUE)` | Nasiyas not yet completed/cancelled | `COMPLETED`/`CANCELLED` nasiyas | N/A (current status) | N/A (a count) | `invalidateShopNasiyaMutation`, `invalidateShopPaymentMutation`, `invalidateShopOverdueCron` |
| **Oxirgi operatsiyalar** | `recentActivity` = last 5 `Log` rows for the shop (filtered to `SHOP_ADMIN`-actor rows for shop-admin sessions) | Every logged mutation (sell, nasiya create, payment, return, restock, etc.) | Nothing filtered by type — every `Log` action shows | `Log.createdAt` | N/A | Every mutation route's invalidate call includes the `logs` tag |
| **Yaqin to'lov sanalari** | `upcomingPayments` = next 5 nasiya schedules by `effectiveDue`, with `expectedAmount`/`paidAmount` converted to UZS via today's rate from the nasiya's own contract currency | Pending/partial/overdue/deferred schedules on non-cancelled, non-deleted nasiyas | Paid schedules; cancelled/deleted nasiyas | `NasiyaSchedule.dueDate`/`delayedUntil` | Live conversion, same rule as Kutilmoqda | `invalidateShopNasiyaMutation`, `invalidateShopPaymentMutation` |

## Investigated and ruled out (with evidence)

- **Cache invalidation gap**: every mutation route that can affect these
  stats (`sell`, `sales/[id]/payment`, `nasiya` create/edit/import,
  `nasiya/[id]/payment`, `devices` create/edit/return/restock,
  `olib-sotdim` create/pay, `customers`, `shop/profile`, the overdue cron)
  calls an `invalidateShop*Mutation` helper that includes the `stats` and
  `reports` cache tags (verified by reading `src/lib/server/cache-tags.ts`
  and grepping every route under `src/app/api/**` for `invalidateShop`).
  `getShopStats`'s single `unstable_cache` entry is tagged with all of
  these — there is exactly ONE cached computation per shop, read by both
  dashboard and hisobot, so it cannot be "half stale."
- **Date-range mismatch between `Sale.createdAt` and `SalePayment.paidAt`**:
  both are set to `new Date()` in the same database transaction when a
  sale is created with full payment, so they always land in the same
  month range together for a normal same-day sale.
- **Dashboard vs. Hisobot formula divergence**: both pages call the exact
  same `getShopStats()` and read the exact same field names
  (`grossCashInThisMonth ?? cashCollectedThisMonth`,
  `accrualGrossProfitThisMonth ?? realProfitThisMonth`) — verified by
  reading both page files directly.
- **Currency conversion inconsistency**: `expectedThisMonth`/`overdueMoney`
  already converted per-row via `contractOutstandingAsUzs`/
  `convertContractAmountToUzs` before summing (fixed in an earlier pass);
  `grossCashInThisMonth`/`accrualGrossProfitThisMonth` correctly do NOT
  re-convert — they sum already-frozen legacy-UZS snapshots, which is
  correct accrual/cash accounting, not a currency bug.

## What changed in this pass

1. Extracted the pure arithmetic from `getShopStatsFresh` into
   `src/lib/shop-stats-formulas.ts` (`computeShopStatsFromRows`) — no
   `server-only`, no Prisma — so it can be unit-tested directly with
   synthetic rows instead of only through source-string guard tests. Zero
   behavior change: `getShopStatsFresh` now just runs the same Prisma
   queries and passes the results straight through.
2. Exposed `accrualRevenueThisMonth` (gross revenue, before subtracting
   cost) on the returned stats object — it was already computed internally
   but discarded; now available for anything (docs, future UI, tests) that
   needs true accrual revenue rather than net profit.
3. Added tooltips/captions to "Umumiy aylanma", "Sof tushum", "Sotuv
   foydasi" (dashboard) and "Bu oy tushgan pul", "Sotuv foydasi" (hisobot)
   clarifying the accrual-vs-cash distinction in-product, so it is no
   longer mistaken for a bug.
4. Added `tests/shop-stats-formulas.test.ts` (16 tests) proving: a
   fully-paid sale moves both cards together; a zero/partial-down-payment
   sale moves only profit (documented); nasiya payments correctly affect
   turnover without inflating expected/receivable; USD-native turnover
   does not drift after a rate change; mixed-currency aggregates never
   raw-sum; active/overdue/completed exclusions are correct.
