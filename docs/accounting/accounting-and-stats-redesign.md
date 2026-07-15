# Accounting and statistics redesign

Status: implemented in code and migrations; production activation is allowed
only through the guarded release workflow.

## Authoritative recognition rules

All shop monthly and range reporting uses Asia/Tashkent boundaries and the
shared payment-basis accounting aggregate. A contract date does not create
cash or profit.

| Metric | Definition |
| --- | --- |
| `Bu oy tushgan pul` | Gross cash-sale, Pay Later, Nasiya down-payment, and Nasiya installment receipts whose payment date is in the selected month. |
| `Sof tushum` | Gross received money minus actual customer refunds paid in the month. Cancelled unpaid debt is not subtracted as cash. |
| `Bu oy to‘lanishi kerak` | Amount due in the selected month and still unpaid. Future periods are excluded. |
| `Bu oy haqiqiy foyda` | Paid ordinary device margin plus paid Nasiya interest, less valid recognized-profit return reversals in the month. |
| `Bu oy kutilayotgan foyda` | Still-unpaid margin plus interest due in the selected month. It is not actual profit. |
| `Nasiya foizi — tushgan` | Interest allocated to Nasiya payments received in the period. |
| `Nasiya foizi — kutilayotgan` | Unpaid interest allocated to active schedules due in the period. |
| `Kechikkan summa` | Active unpaid obligations whose due date is before the selected as-of date. |
| `Mijozga qaytarilgan pul` | Cash actually refunded in the period. |

Future installments never inflate the current period. Total agreement
interest is reference-only on the Nasiya detail page.

## Immutable component allocation

`Sale`, `Nasiya`, and `NasiyaSchedule` freeze cost/principal, ordinary margin,
and interest budgets. `NasiyaPaymentAllocation` records the exact component
split of every receipt across down payments and schedule rows. Partial, early,
late, combined, and final-rounding payments use cumulative allocation so UZS
stays in whole so‘m and USD stays at two decimals. The last applicable
allocation absorbs the exact contractual rounding remainder.

Historical facts are reconstructed by
`scripts/backfill-payment-profit-ledger.mjs`. Reliable history becomes
`COMPLETE`; incomplete evidence remains `PARTIAL` or `UNRECONSTRUCTABLE` and
missing profit is never invented. Original contracts, payments, returns, and
audit rows are not rewritten.

For the required $800 cost / $1,000 base / $200 down / 20% financed interest /
four installment example, the down payment recognizes $40 ordinary margin and
$0 interest. Each $240 installment contains $160 principal, $40 ordinary
margin, and $40 interest. Before payment its $80 profit is expected in its due
month; after payment it becomes actual on the payment date. No future interest
is recognized at contract creation.

## Zero-payment Pay Later

The Sale UI has paid-in-full, partial, and full-amount-later modes. In Pay Later
mode, `amountPaid` is exactly zero, the full price remains due, and a due date
is mandatory. No payment method and no zero-valued `SalePayment` row are
created. Negative values, overpayments, missing due dates, and missing payment
methods on positive receipts are rejected by the API.

Sale creation uses a shop-scoped idempotency key and immutable command hash.
An exact replay returns the existing sale; conflicting reuse is rejected. A
zero-paid sale produces zero actual cash and profit until a real payment is
recorded.

## Returns, archive, and legacy write-off

Returns separate reversed sale value, actual refund, retained cash, cancelled
unpaid debt, returned cost basis, and recognized-profit reversal. Only actual
refunds reduce net cash; only previously recognized margin/interest can be
reversed.

Archive/restore is the only current Nasiya resolution workflow. Archive removes
remaining unpaid values from active/expected statistics while preserving paid
history. Restore reintroduces the remaining schedule. Owners have access by
default; staff need the `Can archive Nasiya` checkbox, and the backend enforces
the same permission. New write-offs are rejected. Historical written-off rows
remain immutable, read-only audit evidence.

## Super Admin currency policy

`SuperAdmin.preferredCurrency` persists the UZS/USD display choice and is
provided by the server layout before hydration. The switch changes display
only; it never mutates shop preference, package billing currency, receipt
currency, or historical rate snapshots.

Every subscription receipt preserves original amount/currency, package version
and monthly price, service period, payment date, recorder, payment-time rate,
and available immutable UZS/USD reporting snapshots. Historical reports use
those snapshots, never today's rate. Expected package revenue remains
partitioned by native currency and uses the current governed rate only for
display. With no valid rate, the UI shows native totals such as `12,000,000
so‘m + $500` instead of guessing or crashing.

Legacy null `ShopPayment.currency` rows are backfilled to UZS only because the
pre-multi-currency subscription system stored and displayed them exclusively
as UZS. Cross-currency snapshots use a governed rate recorded at or before the
payment and no more than seven days old. Missing evidence is marked `PARTIAL`.

## API and export contracts

Super Admin aggregates expose separate native UZS/USD totals, immutable
historical snapshot totals, per-display-currency completeness, and counts.
Payment rows expose original currency/amount, both available historical
snapshots, rate, and reconstruction status. CSV exports include the same
evidence and protect spreadsheet cells from formula injection.

Shop stats, range reports, charts, and exports read the shared accounting
aggregate and keep actual, expected, refund, and legacy audit values separate.

## Release safety

Migration `202607150004_complete_accounting_redesign` is additive apart from
making the already-backfilled `ShopPayment.currency` non-null. It adds Super
Admin preference, Pay Later idempotency fields, immutable subscription-payment
snapshots, a native-snapshot constraint, and retirement of the write-off
permission. The guarded postflight blocks pending currency reconstruction,
missing native snapshots, active legacy write-off permission, or accounting
ledger reconciliation failures. Partial historical cross-currency evidence is
reported as a review gap, not silently repaired.
