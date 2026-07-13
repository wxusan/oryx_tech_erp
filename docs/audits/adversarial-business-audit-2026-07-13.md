# Oryx Tech ERP adversarial business audit

> **Point-in-time baseline:** this report intentionally describes commit
> `2eeae5d` before remediation. It is retained as audit evidence, not as the
> current release status. See `docs/remediation/remediation-matrix.md` for the
> implementation and verification state.

**Audit date:** 2026-07-13 (Asia/Tashkent)
**Audited commit:** `2eeae5d0e1ec46b2ae7c6bf319d23982338da43d`
**Baseline branch:** `main`, synchronized with `origin/main`
**Audit branch:** `codex/adversarial-business-audit`
**Production mutations:** none
**Application behavior changed:** none
**Highest evidence reached:** L5 against a disposable local database; no L6 live proof

This report audits the system that already exists. It does not authorize a data repair, deployment, Telegram send, or product redesign.

## 1. Executive verdict

The platform has meaningful safety controls, but it is not correct to describe every current business flow as fully production-safe.

### Direct answers

- **Money loss:** no test proved that cash physically disappeared from a bank account or cash drawer. There is, however, executable evidence that accepted inputs, return handling, mixed-currency aggregation, and historical reporting can misstate balances or business results.
- **Money miscounting:** confirmed. Missing FX rates can raw-add UZS and USD numbers; returns can remove historic accrual while leaving payment rows; import can accept contradictory totals; sub-minor-unit and dust behavior can make entered money differ from applied debt.
- **Tenant leakage:** no ordinary API IDOR or cross-shop route bypass was found. Composite tenant foreign keys are present and validated. Queued Telegram content can still be sent after its recipient is disabled, and duplicate Telegram ownership is not database-safe; that is a confirmed privacy/revocation defect and a possible wrong-recipient path.
- **Stale reminders:** confirmed. Queue messages are not revalidated against current debt/entity/recipient state before retry.
- **Missed reminders:** confirmed. Exact-day early/due reminders have no outage backfill, and retry timestamps do not wake a worker.
- **Performance:** normal paginated device browsing remains responsive at 50,000 rows, but Shop Hisobot took **7.4 seconds** and the shared overdue banner took **3.3–8.8 seconds** with 100,000 open obligations in L5 local browser testing.

### Release judgment

| Class | Count/assessment | Meaning |
|---|---:|---|
| P0 | 1 | Return/refund accounting can destructively rewrite historical business reporting. Do not claim accounting-grade history while this remains. |
| P1 | Multiple confirmed | Incorrect currency display/debt reminders, race-prone device edits/deletes, revoked Telegram recipients, admin report omissions, money precision/import defects. |
| P2 | Multiple confirmed/inferred | Reminder recovery, queue semantics, performance, login throttling, report semantics, retention, test depth. |
| P3 | Documentation/maintainability | Large components, duplicated policy maps, stale comments/docs, latent compatibility behavior. |

### Proven safe within the tested scope

- Fully paid and partial Sale creation use a conditional `IN_STOCK` device claim inside the transaction (`src/app/api/devices/[id]/sell/route.ts:87-100`).
- Nasiya creation uses the same conditional device claim (`src/app/api/devices/[id]/nasiya/route.ts:138-151`).
- Nasiya payment uses Serializable isolation, optimistic schedule updates, and bounded retry on serialization conflicts (`src/app/api/nasiya/[id]/payment/route.ts`).
- Current protected routes have an authentication/role guard; no unguarded money, return, stats, export, upload, or admin business handler was found.
- Shop-scoped dynamic lookups inspected were tenant-filtered, and the 44 foreign keys—including composite tenant relationships—were validated in migrated PostgreSQL.
- Private upload routes enforce authentication, tenant path, MIME/magic bytes, and size. CSV formula injection is escaped.
- Telegram HTML dynamic values are escaped; media keys are tenant-prefixed, privately signed, and delivered in 1/2–10/11+ groups with per-position progress.
- Five migrated-PostgreSQL integration files passed 35/35 tests.

### Unsafe or not honest to claim

- Return/refund accounting is not an immutable ledger.
- Open USD money cannot always be displayed in a UZS-preferred shop.
- Sale/Qarz reminder amounts are not reliably contract-native.
- Admin Hisobot's due-shop table is not connected to a real shop source.
- Admin payment history is not complete past endpoint caps.
- Device financial fields and deletion can race a concurrent sale/Nasiya.
- Telegram delivery is at-least-once and does not reauthorize or revalidate at send time.
- Database tenancy is stronger than database financial integrity; monetary equations are mainly application-only.
- “Net profit” is not available because a complete expense/cash-outflow ledger does not exist.

## 2. Baseline and evidence

### Repository baseline

| Item | Result |
|---|---|
| Commit | `2eeae5d0e1ec46b2ae7c6bf319d23982338da43d` |
| Commit subject | `Merge pull request #9 from wxusan/codex/fix-production-release` |
| Remote | `origin` → `https://github.com/wxusan/oryx_tech_erp.git` |
| Initial worktree | clean `main`, equal to `origin/main` |
| Current worktree | audit branch with audit-only untracked tests, SQL and this report |
| Node | `v24.13.1` |
| npm runtime | `11.8.0` |
| Declared package manager | `npm@10.9.4` |
| Next/React | Next `16.2.9`, React `19.2.4` |
| Prisma | `7.8.0` |
| Migrations | 30, all applied successfully to disposable PostgreSQL |
| Test files after audit additions | 154 total: 149 normal-suite, 5 integration |

The audit used `oryx_adversarial_20260713` on local PostgreSQL at `127.0.0.1`. The schema was repeatedly dropped and recreated only through the repository's guarded integration runner. No production database URL was used for a write test.

### Audit-only artifacts

- `tests/adversarial-business-audit.test.ts` — 5 independent pure money/import/dust probes.
- `tests/integration/adversarial-business.integration.test.ts` — 10 migrated-PostgreSQL invariant/race/history probes.
- `tests/integration/business-routes.integration.test.ts` — 4 real Route Handler + real Prisma probes.
- `tests/integration/telegram-http.integration.test.ts` — 3 real PostgreSQL queue + real local HTTP Telegram-stub probes.
- `scripts/sql/adversarial-business-diagnostics.sql` — read-only repeatable-read zero-row invariant pack.

### Evidence inventory

| Level | Evidence obtained |
|---|---|
| L0 | Route, schema, migration, UI, docs, cache, queue, formula and config inspection. |
| L1 | 93 test files use `readFileSync` source/static guards. |
| L2 | Final normal suite attempted 1,354 tests: 1,336 passed, 1 failed, 17 todo; 1 all-todo file is reported skipped. |
| L3 | 5 integration files / 35 tests passed against all 30 real migrations. |
| L4 | Four real Route Handler money tests plus three real queue/HTTP-stub delivery tests. |
| L5 | Shop/admin login, dashboard, device list, Shop Hisobot and Admin Hisobot in the in-app browser against synthetic disposable data. |
| L6 | None. No live bot, production DB write, or approved live production transaction. |

## 3. Existing business state machines

### Device and Sale/Qarz

```text
Device created → IN_STOCK
  ├─ fully paid Sale → SOLD_CASH + Sale + initial SalePayment
  ├─ partial/zero-paid Sale → SOLD_DEBT + Sale (+ initial payment when > 0)
  │    └─ later SalePayment(s) → SOLD_CASH when native remaining reaches tolerance
  ├─ Nasiya → SOLD_NASIYA + Nasiya + schedules (+ down-payment row)
  └─ edit/delete while IN_STOCK (currently vulnerable to a concurrent financial link)

Sale/Nasiya → Return
  → DeviceReturn created
  → original Sale soft-deleted OR Nasiya cancelled/soft-deleted behavior
  → device returned to stock-compatible state by current route
  → later resale is possible
```

| Transition | Preconditions/scope | Money source | Atomicity/idempotency | Side effects and reporting |
|---|---|---|---|---|
| Device purchase | Authenticated active shop; active-only IMEI uniqueness | Input UZS/USD; frozen purchase input/rate + UZS snapshot | Transaction; no request key | Device, IMEI rows, log, notification, cache invalidation. |
| Fully paid Sale | Device is same-shop, active, `IN_STOCK` | Native contract price=paid; UZS snapshot | Conditional `updateMany` inside transaction; synthetic initial-payment key | `SOLD_CASH`, Sale, SalePayment, log, notification. Sale accrual and cash receipt both enter stats. |
| Partial/Qarz Sale | Same; remaining native debt > 0 | Native price/paid/remaining + UZS snapshot | Same atomic device claim; later payment endpoint has key | `SOLD_DEBT`; due/reminder fields; receivable enters current snapshot. |
| Final Qarz payment | Same-shop active Sale with native debt | Payment input/rate; native applied amount; UZS applied snapshot | Transaction and key uniqueness; same-key/different-body is not fingerprinted | Sale paid fields and device status update; payment/log/notification. |
| Device edit/delete | Same-shop device; intended only when no financial link | Purchase cost can change | **Precheck outside transaction then unconditional update/delete** | Can rewrite profit basis or hide a just-sold device under concurrency. |
| Return | Same-shop sold device and linked contract | One refund input/native metadata + UZS snapshot | Serializable transaction, but no `P2034` retry | DeviceReturn/log/notification; original accrual row is removed/cancelled, producing historic-report rewrite. |
| Restock/resale | Legacy `RETURNED` or returned device per route rules | No new money until resale | Guarded transition | RESTOCK notification; later Sale/Nasiya uses normal conditional claim. |

`RESERVED` is legacy-only and was removed from current active status behavior by migration `202607100001_remove_reserved_device_status`. The current sale/Nasiya operations claim `IN_STOCK` directly rather than maintaining a long-lived reservation.

### Nasiya

```text
IN_STOCK device
  → Nasiya ACTIVE + monthly schedules PENDING + optional down-payment receipt
  → selected-month payment first, then oldest effective due dates
  → schedule PARTIAL/PAID; parent ACTIVE/OVERDUE/COMPLETED derived from native debt
  → optional deferral: schedule DEFERRED + immutable NasiyaDeferral row
  → cron overdue transition: eligible schedule OVERDUE, parent may become OVERDUE
  → final native payment: parent COMPLETED, device remains SOLD_NASIYA
```

| Transition | Current protection | Confirmed limitation |
|---|---|---|
| Create by interest/manual monthly | Exact last-row remainder allocation; conditional device claim; frozen native/UZS ledgers | Creation/import omit stored `contractRemainingAmount` on schedule rows; DB default is zero. |
| Down payment | Separate `NasiyaPayment` with native input metadata; does not reduce scheduled debt twice | Reporting meanings still require an explicit revenue/cash policy. |
| Schedule payment | Serializable transaction, selected-first allocation, optimistic row version via prior paid amount | Payment allocation is reconstructable from log JSON, not a normalized immutable allocation table. |
| Multi-schedule prepayment | One payment row may have `nasiyaScheduleId=null`; log carries allocations | DB cannot enforce payment-to-schedule same-contract ownership. |
| Deferral | Unique idempotency key in `NasiyaDeferral`; effective date used in some readers | Upcoming query filters by original due date before sorting by delayed date. |
| Completion | Contract-native derived status; optimistic writes; `P2034` retry | Retry after successful final payment reaches completed guard before old payment lookup and returns 409. |
| Import | Imported device excluded from inventory and current-period sale creation | Contradictory old paid/remaining totals accepted; very small totals can produce a negative final schedule row. |

### Olib-sotdim and supplier payable

```text
External device + customer sale in one operation
  → Device marked external-sourced and sold
  → Sale/customer receivable created
  → SupplierPayable PENDING (supplier money kept separate)
  → binary payment action → PAID
```

This separation correctly avoids automatically offsetting customer receivables against supplier payables. Current limitations are one currency for all legs and binary supplier settlement—no partial supplier-payment ledger. The `CANCELLED → PAID` route defect is L4-confirmed but downgraded to P3 because no current normal app path creates a CANCELLED payable.

### Subscription payments

Super admin records `ShopPayment`; the shop subscription date is extended and the transaction is keyed by `(shopId,idempotencyKey)`. Admin pages do not consume a complete independently paginated payment source, so historical visibility is capped despite the ledger row existing.

### Notification state

```text
business transaction → durable Notification PENDING
  → immediate best-effort after() flush OR manual send OR daily cron
  → PROCESSING lease → Telegram HTTP
       ├─ success → SENT + text/media progress
       ├─ retryable/permanent failure alike → FAILED + nextAttemptAt
       └─ fifth attempt → CANCELLED
```

The delivery guarantee is **at least once**, not exactly once. A Telegram-accepted send followed by a failed DB progress write can duplicate after the five-minute stale lease.

## 4. Monetary ledger and reconciliation model

### Intended authoritative model

| Entity | Native source of truth | Compatibility/history fields |
|---|---|---|
| Device purchase | `purchaseCurrency`, `purchaseInputAmount` | `purchaseAmountUzsSnapshot`, `purchasePrice`, frozen creation rate |
| Sale | `contractCurrency`, `contractSalePrice`, `contractAmountPaid`, `contractRemainingAmount` | legacy `salePrice`, `amountPaid`, `remainingAmount` UZS snapshot |
| Sale payment | `paymentInputAmount/currency`, `appliedAmountInContractCurrency` | `amount` UZS snapshot, payment-time rate |
| Nasiya | `contract*` parent and schedule amounts | legacy UZS principal/interest/payment/schedule fields |
| Nasiya payment | native input/applied amount and payment-time rate | `amount` UZS snapshot |
| Supplier payable | `contractCurrency`, `contractAmount` | `amount` UZS snapshot |
| Return | `refundInputAmount/currency/rate` | `refundAmount` UZS snapshot |

### Invariants and verdict

| Invariant | Verdict | Evidence |
|---|---|---|
| Sale native price = paid + remaining | Application paths generally maintain it; DB does not enforce it | L3 DB accepted contradiction in `adversarial-business.integration.test.ts`. |
| Nasiya final = principal + interest | Pure calculations pass; DB does not enforce parent equation | L2 + L3. |
| Schedule expected sum = scheduled debt | Creation helper passes normal cases | L2; adversarial import edge fails. |
| Schedule paid/remaining = parent | Current payment path recalculates, but stored creation remainder defaults zero | L0/L3. |
| Initial payment counted once | Normal Sale/Nasiya paths create one payment row | L0/L2; full report reconciliation still affected by later soft deletion. |
| Input = applied + explicit change/credit | **Fails for accepted dust** | L2: 1,499 UZS receipt against 1,000 debt can apply 1,000 with 499 unexplained. |
| Minor-unit canonicalization before persistence | **Fails** | L2: 0.1 UZS and 0.004 USD accepted by validation. |
| Missing FX never creates fake scalar | **Fails** | L2 raw-sum examples in `nasiya-contract.ts:89-98` and `shop-stats-formulas.ts:116-141`. |
| Historical periods never change after return | **Fails** | L3: later soft-delete removes old accrual while payment remains. |
| Customer and supplier balances never offset | Passes current Olib model | L0/L2. |
| Same request retry has no additional money row | Generally passes key uniqueness | L3/L4; final Nasiya retry returns 409 instead of original success. |
| Same key/different payload is detected | **Fails fingerprint requirement** | L4 returns earlier success, no duplicate money but no payload conflict. |
| Every monetary relationship is same-shop | Composite tenant FKs pass | L3 catalog + tenant tests. Same-contract semantics remain unenforced. |

## 5. UZS/USD exchange-rate matrix

| Scenario | Expected invariant | Observed | Evidence/status |
|---|---|---|---|
| UZS contract, UZS display | Exact native amount | Works in focused helpers/routes | L2/L4 pass |
| USD contract, USD display | Exact frozen native amount | Works when context remains USD | L2 pass |
| USD contract, shop changed to UZS | Translate with an available governed rate or show partitioned native USD | Real context hard-returns `usdUzsRate:null`; UI/Telegram can show `—` | P1, L0/L2 |
| UZS contract, USD display with rate | One current translation, clearly labeled | Works in formatting helpers | L2 |
| Missing rate in aggregate | Partition currencies / unavailable | Raw numeric addition can produce `500100` for `500,000 UZS + $100` | P1, L2 |
| Zero/negative rate through normal route | Reject | Validation rejects ordinary input; DB accepts negative CurrencyRate | L2/L3 |
| Extreme positive manual rate | Governed bound | No maximum bound or approval workflow | P2 inferred |
| Stale rate | Maximum age/freshness policy | Latest row has no maximum age enforcement | P2 confirmed source |
| Payment at changed rate | Preserve input and applied debt at event rate | Payment rows store frozen metadata | L0/L2 positive |
| Sale reminder after rate change | Use native Sale debt | Cron reads legacy UZS and reconverts at current rate; `$100` can become `$125` | P1, L2 |
| Export after rate change | Export native + frozen rate + snapshot | Several exports expose legacy UZS/display values but omit authoritative native contract context | P2, L0 |

Required policy decision: whether current open USD debt should be translated at today's rate, held in USD, or shown both ways. Regardless of that choice, native debt must never become `—` or a raw mixed scalar.

## 6. Full business scenario matrix

| ID | Setup/action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| S-01 | Two requests sell/Nasiya same IN_STOCK device | One claim | Conditional status update protects both creation routes | L0/L2 | Pass |
| S-02 | Fully paid Sale | SOLD_CASH; price=paid; one receipt | Current path does so | L0/L2 | Pass |
| S-03 | Partial Sale/Qarz | SOLD_DEBT; native remaining | Current path does so | L0/L2 | Pass |
| S-04 | Final Qarz payment | Close native debt and device | Current route does so in normal case | L2 | Pass |
| S-05 | Same Qarz key/same request | Original success, no duplicate | No duplicate; existing response behavior covered | L3 | Pass |
| S-06 | Same Qarz key/different amount | Conflict or fingerprint match | Returns old success amount | L4 | P3 contract weakness |
| S-07 | Edit cost while concurrent sale commits | Reject edit | Stale precheck allows rewrite | L3 | P1 fail |
| S-08 | Delete device while concurrent sale commits | Reject delete | Stale precheck allows soft deletion | L3 | P1 fail |
| N-01 | Interest-based Nasiya | Parent/schedules reconcile | Normal pure cases pass | L2 | Pass |
| N-02 | Manual monthly Nasiya | Reverse formula matches preview | Pure tests pass | L2 | Pass |
| N-03 | Down payment | One cash row, scheduled debt not double-reduced | Current path | L0/L2 | Pass in normal case |
| N-04 | Selected schedule + prepayment | Selected first, then oldest effective dates | Current allocation code | L2 | Pass |
| N-05 | Two parallel payments | Serializable + optimistic protection | Focused tests support; no two live HTTP requests | L2/L3 | Partially proven |
| N-06 | Final payment retry after lost response | Original success | 409 completed before key lookup | L4 | P2 fail |
| N-07 | Deferral then upcoming list | Effective delayed date included | Query can omit by filtering original due first | L0 | P2 fail |
| N-08 | Imported old debt consistent | Carry debt, exclude current sale | Works in normal fixtures | L2 | Pass |
| N-09 | Imported contradictory totals | Reject | Accepted | L2 | P1 fail |
| N-10 | `$0.02` imported debt over 4 months | Nonnegative exact schedule | `[.01,.01,.01,-.01]` | L2 | P1 fail |
| O-01 | Olib customer + supplier sides | Separate receivable/payable | Separate tables | L0/L2 | Pass |
| O-02 | Olib legs in different currencies | Preserve each agreement | One currency forced for all legs | L0 | P2 limitation |
| O-03 | Partial supplier payment | Ledger remaining | Only binary status exists | Policy decision |
| R-01 | Full/partial/no-payment return | Immutable reversal/refund allocation | Coarse DeviceReturn + original soft delete/cancel | L0/L3 | P0 fail |
| R-02 | Return in later accounting month | Old month unchanged + current reversal | Old accrual disappears | L3 | P0 fail |
| R-03 | Legacy RETURNED restock/resale | Return to stock, normal re-claim | Current restock/sale guards support | L1/L2 | Pass; live history unproven |
| T-01 | Queue text success | One HTTP send, SENT | Real stub: pass | L4 | Pass |
| T-02 | Telegram 429 retry_after=7 | One failed attempt, future retry | Backoff stored, but text attempted twice inside same queue attempt | L4 | P2 fail |
| T-03 | Admin disabled after queue | Do not send | Message still sent | L4 | P1 fail |
| T-04 | 0/1/2/10/11+ images | Message/photo/albums without dropping peers | Planner/progress tests pass | L2 | Pass at planner level |
| T-05 | Telegram accepts, DB progress fails | No duplicate | Duplicate window remains | L0 | Unproven/at-least-once |
| SEC-01 | Shop A identifier against Shop B | Reject/empty | Scoped lookups/FKs found | L0/L3 | Pass in sampled routes; full route matrix unproven |
| DB-01 | Cross-Nasiya schedule/payment same shop | Reject | DB accepts | L3 | P1 defense gap |
| DB-02 | Return/payable device differs from linked Sale | Reject | DB accepts | L3 | P1 defense gap |
| UI-01 | Admin Hisobot with 3 active shops | List due shops | “Faol do'konlar topilmadi” | L5 | P1 fail |
| PERF-01 | 50k devices list | Bounded usable page | 25 rows, 2,000 pages; server route 275 ms | L5 | Pass |
| PERF-02 | 50k Nasiya + 50k Qarz obligations | Timely report/banner | Hisobot 7.4 s; banner 3.3–8.8 s | L5 | P2 fail |

## 7. Dashboard and Hisobot ledger map

The source of shop metrics is `src/lib/server/shop-stats.ts:57-285`; formulas are in `src/lib/shop-stats-formulas.ts`. The current documentation map is `docs/audits/dashboard-stat-formulas.md`, but several conclusions below supersede its optimistic assumptions.

### Shop dashboard/Hisobot

| Visible item | Actual business class and source | Time/currency meaning | Problem |
|---|---|---|---|
| Umumiy aylanma / Bu oy tushgan pul | Cash inflow: SalePayment.amount + NasiyaPayment.amount | Payment `paidAt` in selected Tashkent month; UZS snapshots | Reasonable gross customer receipts, not sales turnover. |
| Sof tushum | Gross customer receipts − DeviceReturn.refundAmount | Period flow | Omits supplier/inventory cash outflow; not full net cash flow. |
| Yig'ilgan ulush | receipts / (receipts + current expected) | Mixed cohorts | Numerator is payments received this month from any obligation; denominator adds currently open month obligations. Not a coherent collection cohort. |
| Kutilmoqda / Bu oy kutilmoqda | Open native schedule debt effective in month + unpaid Sale debt due in month | Current snapshot translated at current rate | Missing rate can raw-mix units; deferred rows can be omitted by query order elsewhere. |
| Kechikkan to'lovlar | Open schedules/Sales before Tashkent today | Current snapshot | Can be correct as action queue, but historical month screens still show today's debt state. |
| Sotuv foydasi | Sale salePrice − device cost + Nasiya totalAmount − device cost | Accrual in creation month | Not net profit; later returns remove old rows. |
| Ombordagi tannarx | Sum purchasePrice for current IN_STOCK devices | Current inventory snapshot | Displayed beside period flows without a snapshot label. |
| Jami qurilmalar | Current active non-imported device count | Current snapshot | Correct source. |
| Naqd sotuvlar | Count of all Sale rows in period | Accrual count | Includes Qarz and Olib Sale rows; label is false. |
| Faol nasiyalar | ACTIVE/OVERDUE parents plus derived false-completed IDs | Current snapshot | Requires loading all open schedules into Node. |
| Yaqin to'lovlar | First 50 schedule rows ordered by original due date | Current work list | Effective delayed date is displayed/sorted later; candidate truncation can be wrong. |
| Qaytarilgan pul | Sum DeviceReturn.refundAmount in period | Refund flow | A written refund amount is not reconciled to original receipts. |
| Charts | Gross cash, refunds, expected, overdue; inventory/profit/interest | Mixed flow/snapshot/accrual | Overlapping values appear comparable; axes abbreviated to very large “M” values. |

### Admin dashboard/Hisobot

| Item | Source/meaning | Problem |
|---|---|---|
| Active/suspended/total shops | Shop counts | Sound as current platform snapshot. |
| This-month/Jami subscription receipts | ShopPayment sums | Sound for recorded receipts. |
| Expected revenue / plan | Latest payment or monthly estimate vs multi-month cash | Incompatible cohorts; prepayments distort the comparison. |
| Average payment | Payment sum / row count | Not price per paid month. |
| Due/overdue shops | UI expects `stats.shops` | API omits `shops`; L5 showed empty table with 3 active shops. |
| Admin payments page | `/api/shops` default max 200 shops, max 500, 12 payments/shop | Treats an incomplete nested subset as global history and totals. |

## 8. Dashboard/Hisobot business recommendation

Use only data already present; do not add Redis or invent an expense ledger to mask definition problems.

| Group | Action | Reliable existing values | Reason |
|---|---|---|---|
| Action required | **Move first** | overdue amount + distinct contracts, due today, next 7 days | Drives collection work. Use non-overlapping effective dates. |
| Cash this month | **Rename/regroup** | gross customer receipts, refunds, net customer cash, method/input-currency composition | “Sof tushum” must say it excludes supplier/expense outflows. |
| Receivables | **Regroup** | overdue, rest of current month, later outstanding | Current snapshot; never mix partitions. |
| Sales and margin | **Split** | fully paid Sale, Qarz Sale, Nasiya Sale, accrual revenue, device cost, gross margin, Nasiya interest | Remove “Naqd sotuvlar” for all Sale rows; never call gross margin net profit. |
| Inventory | **Keep/clarify** | in-stock count, UZS book snapshot, native purchase-currency exposure | Label as “current snapshot.” |
| Activity | **Keep** | effective upcoming dates and attributed log events | Query by effective date before limiting. |
| Admin | **Repair source then keep** | renewals, due 7 days, active/suspended, current-month receipts, price per paid month | A real paginated/sorted shop and payment projection is required. |

## 9. Telegram matrix

### Event inventory

| Event | Trigger | Recipient at creation | Main defect |
|---|---|---|---|
| DEVICE_CREATED | Device POST | active verified shop admins | USD native amount can render `—` in UZS shop. |
| SALE | Sell route | same | Same; message row committed in business transaction. |
| NASIYA / NASIYA_IMPORTED | Create/import | same | Legacy/native context differs by template. |
| PAYMENT_RECEIVED | Sale/Nasiya payment | same | Partial remaining USD can render `—`; Sale reminders later drift. |
| NASIYA_COMPLETED | Final payment | same | USD total can render `—`. |
| RETURN / RESTOCK | Return/restock | same | Delivery retry is not revalidated. |
| OLIB_SOTDIM_CREATED | Olib create | same | USD native values can render `—`. |
| SUPPLIER_PAYABLE_PAID | Supplier pay | same | USD native values can render `—`. |
| `/start` | Webhook | Telegram ownership resolver | Expired subscription not checked; failures acknowledged 200. |

### Scheduled reminders

| Family | Eligible state/date | Dedupe | Failure |
|---|---|---|---|
| Nasiya early/due/overdue | open schedule; effective date | type/entity/day/recipient unique key | Exact early/due day is lost after missed cron; parent-state filters are inconsistent for legacy false-completed rows. |
| Sale/Qarz early/due/overdue | `paidFully=false`, legacy remaining >0 | same | Reads legacy UZS remaining, not native debt. |
| Supplier early/due/overdue | PENDING/OVERDUE and reminder enabled | same | Disabling reminder also prevents business OVERDUE transition. |

### Delivery/failure verdict

- 0 images → message; 1 → photo; 2–10 → one album; 11+ → groups of 10 with singleton photo. L2 planner tests cover 0/1/2/10/11+ and progress.
- Caption >1,024 sends the full text separately, then captionless media. No 4,096-character message chunking proof exists.
- Text-only 429 was sent **twice** during one queue attempt in the L4 local HTTP test because the generic media fallback repeats the failed message.
- 429 `retry_after` is stored, but no worker wakes at that time; next delivery may wait until another mutation/manual drain/daily cron.
- 400/401/403 permanent errors receive the same five-attempt path as transient errors.
- Initial selection checks `scheduledAt/nextAttemptAt`; atomic claim rechecks only status/lease. Overlapping workers can bypass future backoff.
- An inactive admin still received a previously queued message in L4.
- Queue top-level failure is caught and returned as a zero-failure summary, so cron can record completion/HTTP 200 while the queue crashed.
- Webhook catches transient initialization/update failures and returns 200, preventing Telegram retry.
- `INTERNAL_API_SECRET || CRON_SECRET` rejects a valid Vercel cron bearer when both differ.
- Notification body PII and operational rows have no retention cleanup.

No real Telegram bot was contacted. Signed Supabase media fetch and Telegram's real HTML/media behavior remain unverified at L6.

## 10. Security and tenant-isolation matrix

| Surface | Current control | Verdict/evidence |
|---|---|---|
| Public routes | Auth.js and minimal `/api/health` | Intentional; health queries DB on every call. |
| Internal routes | bearer secret for cron/send | Protected, but secret precedence defect. |
| Super admin routes | role guard | 8 route files reviewed; no unguarded handler found. |
| Shop routes | session + `resolveActiveShopId` or scoped lookup | No confirmed Shop A→B IDOR. |
| Database tenancy | composite same-shop foreign keys | 44 FKs validated; positive control. |
| Session revocation | `sessionVersion` checked | Active/inactive/deleted/expired checks exist. |
| Admin inactivity | 10-minute client timer | Stolen JWT remains API-valid for configured 8 hours. |
| Shop logout | no idle logout | JWT still hard-expires after 8 hours; not “until explicit logout.” |
| Login throttling | in-process username Map | Bypassable across serverless instances; unbounded warm-instance keys. |
| CSRF | SameSite cookie/Auth.js protections | No explicit Origin/Referer/token on ordinary mutations; browser attack not proven. |
| Uploads | auth, tenant prefix, 5 MB, MIME/magic, short signed URLs | No pixel/decode scan, object record, orphan cleanup, or live bucket-policy proof. |
| Telegram ownership | application precheck | No DB uniqueness within/across admin tables; L3 duplicate accepted. |
| Logging | structured redaction | Embedded signed URL token can evade anchored regex; reachable sensitive call site not proven. |
| Input caps | Zod on core fields | Image arrays, additional phones and several free-text/password fields lack practical maximums. |
| Dependencies | npm audit | 5 moderate, 0 high/critical. No safe automatic fix established. |

## 11. Database, legacy-data and reconciliation findings

The migrated database catalog contained 22 primary keys, 44 foreign keys and only one CHECK constraint (`Device_storage_pair_check`). Tenancy is substantially enforced; business equations are not.

### L3 contradictions accepted by PostgreSQL

- Sale marked fully paid with price, paid and remaining ledgers that do not add up.
- Negative CurrencyRate.
- NasiyaSchedule currency differs from parent and stored native remainder defaults to zero.
- NasiyaPayment points to another Nasiya's schedule in the same shop.
- DeviceReturn/SupplierPayable device differs from linked Sale device.
- DeviceReturn has neither Sale nor Nasiya parent.
- Duplicate Telegram ID across active admin roles.
- Future-backoff FAILED notification satisfies the current atomic claim predicate.

### Historical data requiring diagnostics before repair

- Legacy `RETURNED` devices and their Sale/Nasiya/payment/return relationships.
- Deleted/cancelled original contracts with still-active payment history.
- Old rows missing native input/rate/applied metadata.
- Parent/schedule native remainder divergence.
- Imported Nasiya where original − paid ≠ remaining.
- Duplicate global Telegram ownership.
- Pending queue rows whose recipient/shop/subscription is no longer authorized.
- Notification/Log/OpsEvent/private-object retention volume.

Run `scripts/sql/production-diagnostics.sql`, `scripts/sql/device-specs-phone-repair-diagnostics.sql`, and the new `scripts/sql/adversarial-business-diagnostics.sql` read-only on an approved restored copy first. Repair SQL and production execution require separate approval.

## 12. Failure recovery and concurrency

| Boundary | Current behavior | Risk |
|---|---|---|
| Sale/Nasiya device claim | Conditional status update in transaction | Good protection against double sale/Nasiya. |
| Nasiya payment/payment | Serializable + optimistic schedule update + retry | Strongest current concurrency path. Two real HTTP clients remain untested. |
| Device edit/delete vs sale | Financial/status checks outside transaction | Confirmed stale-write/soft-delete race. |
| Return serialization conflict | Serializable but no `P2034` retry | User can receive conflict/500 under contention. |
| Post-commit cache invalidation | Runs after transaction | Failure can return/appear as an error after money committed; client retry depends on key coverage. |
| Notification queue insertion | Inside business transaction | Queue-row failure rolls back business mutation, coupling availability to notification DB write. |
| Immediate Telegram delivery | after-commit best effort | Durable row is a backstop. |
| Queue crash | Caught into ops event and zero-failure summary | Monitoring can falsely show green. |
| Accepted Telegram send, DB update failure | Lease later retries | Unavoidable duplicate window under current at-least-once design. |
| Same idempotency key | DB unique | No duplicate row; payload is not fingerprinted. |
| Import with blank/placeholder IMEI | No request idempotency | Duplicate import remains possible. |

## 13. Performance and scalability

### Measured PostgreSQL scaling

Synthetic local shops contained 500 (baseline), 5,000 (10×), and 50,000 (100×) rows. Times below are warmed local PostgreSQL `EXPLAIN ANALYZE`, so they exclude remote network, Prisma object creation, JSON serialization, React rendering and serverless contention.

| Current query shape | 500 | 5,000 | 50,000 | Plan observation |
|---|---:|---:|---:|---|
| Dashboard open schedules | 23.2 ms | 25.1 ms | 43.9 ms | Even 500-shop query scanned all 55,500 parent Nasiya rows; returns every open row to Node. |
| Dashboard unpaid Sales | 0.14 ms | 1.20 ms | 10.52 ms | Becomes sequential at dominant 50k tenant; all rows returned. |
| Current-month Sale + device cost | 8.50 ms | 10.44 ms | 28.58 ms | Scans/hashes global device set; all current Sale rows returned. |
| Device page 25 | 0.15 ms | 1.19 ms | 7.83 ms | Bounded, but sorts/scans tenant rows when tenant dominates. |
| Device count | 0.10 ms | 0.74 ms | 4.76 ms | Acceptable local scaling. |

Other measured paths:

- Queue candidate selection over 55,500 due rows, take 100: **0.174 ms**. The index is effective; the bottleneck is delivery cadence/500-run ceiling, not this select.
- Cron Nasiya candidate join returning 55,500 rows: **67.97 ms** DB-only. Route then performs unbounded application work and sequential/batched row/admin writes.
- Export count rejecting a 50,000-row Sale export: **6.53 ms**. Export is bounded at 5,000, but users get an all-or-nothing rejection rather than a scalable job.

### L5 browser measurements

| Flow | Synthetic size | Observed |
|---|---:|---:|
| Device page | 50,000 devices | Server 275 ms; correctly showed 25/50,000 and 2,000 pages, no horizontal overflow. |
| Shop dashboard | 50k Nasiya + 50k Qarz | 362 ms after stats cache was current. |
| Shop Hisobot | same | **7.4 s** server response (6.7 s application code). |
| Shared overdue banner | 100,000 open obligations | **8.8 s**, later **3.3–3.4 s**. It runs on every shop page. |
| Incremental sync | simultaneous heavy first load | 9.8 s once under contention, later 5–156 ms. |
| Admin Hisobot | 3 shops | 315 ms, but table content incorrect. |

The first local dashboard request served a stale cached result from an earlier disposable fixture that reused the same synthetic shop ID; a reload revalidated to the current 50,000-row data. This is not evidence of ordinary production cross-tenant leakage, but database replacement/restore procedures must purge framework caches when IDs are reused.

### Current bottlenecks

1. `getShopStatsFresh` loads all open schedules and unpaid Sales, then computes in Node (`src/lib/server/shop-stats.ts:145-206`).
2. `/api/stats/due-overdue` is an expensive global banner query on every shop page at scale.
3. Reminder cron uses nine unbounded candidate reads and per-record/per-admin writes, then queue drain caps at 500/run.
4. Customer list loads each returned customer's complete Nasiya/schedule history for trust; Nasiya detail reloads all customer contracts.
5. Admin shop/payment API truncates before client filtering/aggregation.
6. Several detail pages direct-fetch on every mount instead of participating in the shared Query cache.
7. Visible clients call sync every 25 seconds: 144 requests per visible client-hour.
8. Device detail (1,669 lines/42 `useState`), admin shop detail (1,172/35), and Nasiya payment modal (714 lines) increase maintainability and hydration risk.

### Redis decision

**Do not introduce Redis as a general financial-data cache now.** It would not fix unbounded reads, wrong report cohorts, incomplete pagination, client refetches, or invalidation correctness.

Use the following order:

1. Move stats to indexed, currency-aware SQL aggregation and bounded projections.
2. Remove the global unbounded overdue-banner path; return action counts/amounts from bounded aggregates.
3. Correct pagination and query-cache participation.
4. Reduce/adapt 25-second sync and measure again.
5. Use a distributed store such as Redis/Upstash specifically for login throttling because coordination across instances is required.
6. For reminder SLA, prefer a durable queue/worker or keep the PostgreSQL outbox with a real scheduled worker. Do not use an ephemeral Redis list as the financial/event source of truth.

## 14. Architecture and clean-code findings

- Currency rules are split between TypeScript helpers, raw SQL triggers, server context, UI formatting and Telegram templates; parity is not differentially tested.
- Cache impact is duplicated across navigation policy, change-event mapping, cache tags and triggers. `NavigationImpact.paths` is generated but has no runtime consumer.
- `use-shop-currency.ts` seeds local state once; another browser's preference change does not update the provider.
- Direct detail-page fetches bypass shared query caching, creating repeated navigation loads.
- Stats and trust logic own large unbounded row sets rather than database projections.
- Notification type/relatedType are free strings; PII-bearing Notification, Log and OpsEvent tables have no retention policy.
- The Prisma adapter is globally initialized and pool size is tunable, but production connection-budget documentation is absent.
- CI has PostgreSQL integration and standard gates, but no dependency audit, secret scan, SAST or coverage threshold; Actions use mutable major tags.
- Documentation drift includes old test/migration totals, old Telegram single-photo behavior, stale “no production migrations in Vercel build” text, and a Sale schema comment describing fields as schema-only despite active use.

## 15. Findings by classification

### Confirmed defects

| Severity | Finding | Business impact | Evidence/data risk | Remediation/test |
|---|---|---|---|---|
| P0 | Return soft-deletes/cancels source contract without immutable reversal allocation | Later return rewrites earlier revenue/margin while receipts remain | L3; existing production returns may be affected | Approve reversal policy; append immutable return allocations; historical-period regression SQL. |
| P1 | USD-native amount renders `—` in UZS context | Staff cannot see real debt/price in UI/Telegram | L0/L2; all USD deals after display change | Context must carry governed rate or show native partition; cross-browser tests. |
| P1 | Missing FX raw-sums units | Fake scalar dashboard/debt totals | L2; affected when rate absent | Currency-partitioned aggregate; missing-rate tests. |
| P1 | Sale/Qarz reminder uses legacy UZS debt | Customer can be reminded for wrong USD amount | L2 | Use native contract remaining; exact rate-change route/cron tests. |
| P1 | Device edit/delete TOCTOU | Profit basis can change or sold device disappear | L3 | Guarded update/version or Serializable reread + retry; two-connection test. |
| P1 | Send-time recipient not authorized | Disabled/changed recipient gets PII | L4 | Store stable recipient ID; reauthorize shop/admin/subscription before each send. |
| P1 | Admin Hisobot shop source missing | Due renewals hidden | L5 | Real sorted/paginated due-shop projection; browser contract test. |
| P1 | Admin payment/shop endpoints truncate history | Old payments/501st shop disappear from totals | L0 | Separate paginated shops/options/payments endpoints. |
| P1 | Minor-unit/dust invariants fail | Entered cash can differ from applied debt | L2 | Currency-specific Decimal canonicalization; explicit change/credit policy. |
| P1 | Import accepts contradictory/negative schedule math | Bad carried debt and schedule rows | L2 | Cross-field validation + exact Decimal allocator. |
| P1 | DB accepts same-contract/link contradictions | Manual/buggy writes can corrupt return/payable/payment semantics | L3 | Composite semantic keys/checks where feasible; transaction validation. |
| P1 | Exact-day reminder outage has no backfill | Missed collection/supplier reminders | L0 | Cursor/watermark catch-up policy and missed-run tests. |
| P1 | Cron secrets conflict | Vercel cron can 401 | L0 | Accept intended secret(s) explicitly; L4 different-secret test. |
| P1 | Queue crash can report green | Silent delivery outage | L0 | Return failure flag/non-2xx; alert on backlog/oldest age. |

### Inferred risks

| Severity | Risk | Why not yet confirmed |
|---|---|---|
| P2 | CSRF on ordinary cookie mutations | SameSite/Auth.js reduce risk; no L4/L5 attack proof. |
| P2 | Logger signed-token exposure | Redaction bypass reproduced, but sensitive reachable call site not proven. |
| P2 | Image decompression/malicious content | Magic/size controls exist; no decode/pixel/scanner test. |
| P2 | Production connection exhaustion | Pool budget and real concurrency/instance count not measured. |
| P2 | Olib return leaves supplier economics inconsistent | Policy and every current return branch were not behaviorally tested. |
| P2 | Cache can surface stale data after DB restore/reuse | Reproduced only with deliberately reused local fixture ID. |

### Disproved suspicions / positive controls

- No unguarded protected business API route was found.
- No confirmed direct cross-shop IDOR was reproduced.
- Composite tenant foreign keys are installed and validated.
- Conditional Sale/Nasiya device claims prevent the simple double-sell race.
- Nasiya payment has real Serializable/optimistic defenses.
- Multi-image planning does not intentionally keep only the first image.
- Customer passport images are not included in Telegram resolution.
- CSV spreadsheet-formula injection is escaped.
- The storage GB/TB UI test passes alone; the full-suite failure is test isolation/timing, not proof that TB is missing from the product.

### Accepted/current policy behavior

- Financial source-of-truth remains PostgreSQL.
- Customer receivable and supplier payable are separate.
- Imported Nasiya is excluded from current-period new-sales and stock cost.
- Reservation is not a current long-lived business state.
- Telegram is currently at-least-once.

These are descriptions, not approval of the unresolved accounting policies below.

## 16. Test-quality report

### Final gate results

| Gate | Result |
|---|---|
| `git diff --check` | Pass for tracked diff; audit artifacts also pass ESLint/typecheck. |
| `npm test` | **Fail:** 147 files passed, 1 failed, 1 all-todo file skipped; 1,336 tests passed, 1 failed, 17 todo. |
| Isolated storage test | Pass 1/1; failure appears only in full parallel suite. |
| `npm run test:integration` | Pass: 5 files / 35 tests after all 30 migrations. |
| `npm run lint` | Pass. |
| `npm run typecheck` | Pass. |
| `npm run prisma:validate` | Pass. |
| `npm run prisma:generate` | Pass, Prisma Client 7.8.0. |
| `npm run build` | Pass; compiled, typechecked and generated 51 static pages. |
| `npm audit --json` | Exit 1: 5 moderate, 0 high, 0 critical. |

### What the tests actually prove

- 93/149 normal-suite files read source text and are static guards. They prove tokens/wiring exist, not runtime behavior.
- Three normal-suite files visibly mock Prisma/queue dependencies; many focused tests are pure formulas/templates.
- Existing migrated-DB baseline contributed 18 tests; audit additions increased the total to 35.
- Four audit tests invoke actual Route Handlers with real Prisma; three exercise the real queue/Grammy HTTP boundary against a local stub.
- L5 browser testing covered login/rendering/performance and the admin-table defect, not full mutation flows.
- There is no coverage provider/threshold and no mutation-testing gate.
- Seventeen explicit TODO cases remain in `tests/integration.todo.test.ts`; some now overlap new audit proof but the tracked TODO inventory was not updated in this audit.
- The full-suite StorageInput failure is reproducible in parallel and passes alone. Stabilize portal cleanup/test isolation before treating the suite as green.

## 17. Prioritized remediation plan

### Blocker order

1. **Approve and implement return/refund/reversal accounting.** Do not repair data before policy approval. Add immutable receipt/refund allocation and preserve historical accrual.
2. **Fix native currency display and aggregation.** Always retain native partition; never raw-add units; govern rate freshness/bounds.
3. **Fix Sale/Qarz reminder native balance.** Exact native amount across creation/current-rate changes.
4. **Eliminate device edit/delete races.** Guarded writes or Serializable reread/retry.
5. **Reauthorize/revalidate Telegram at send time.** Stable recipient ID, shop/subscription/entity/debt check; cancel stale rows.
6. **Repair admin report/payment data sources.** Independent paginated projections; L5 regression.
7. **Enforce money precision and import equations.** Decimal/minor-unit validation and explicit overpayment/change treatment.
8. **Strengthen database semantic invariants.** Same-contract schedule/payment, exact-one return parent, Sale/device/payable consistency, Telegram uniqueness.
9. **Make reminders recoverable and observable.** Secret fix, outage backfill, real worker cadence, atomic retry eligibility, crash propagation, per-shop fairness.
10. **Replace unbounded report/banner work with SQL aggregates.** Use measured 50k/100k acceptance thresholds.
11. **Add distributed login throttling and retention.** Redis/Upstash is justified for coordination here, not general money caching.
12. **Deepen behavioral tests.** Route-by-route tenant matrix, real two-connection concurrency, SQL-vs-TS differential tests, failure injection, browser mutations, optional approved staging bot.

### Business approval required before implementation

- First Nasiya installment date semantics.
- Approved UZS debt-dust threshold (current code uses 500 UZS in places).
- Revenue recognition timing.
- Whether supplier payables remain binary or support partial payments.
- Current-rate valuation versus native-only display for open USD debt.
- Whether zero-payment Qarz creation is allowed.
- Return/refund/reversal accounting, including full/partial/zero refund and supplier consequences.

## 18. Final scorecard

| Area | Proven safe | Failed | Unproven | Evidence | Business impact | Next action |
|---|---|---|---|---|---|---|
| Fully paid Sale | Atomic device claim; receipt row | Minor-unit edge | Full browser mutation | L0–L3 | Core cash sale generally protected | Decimal boundaries + L5 flow |
| Qarz creation | Native balance/status | Dust/precision | Zero-payment policy | L0–L3 | Possible unexplained cash difference | Approve/canonicalize |
| Qarz payment | No duplicate row with key | Changed-payload replay behavior | Two HTTP clients | L3/L4 | Operational ambiguity | Fingerprint request |
| Nasiya creation | Exact normal schedule helper | Stored schedule remainder zero | Every rate/max Decimal boundary | L0–L3 | Latent ledger inconsistency | Populate/check field |
| Nasiya allocation | Selected-first logic | No normalized allocation ledger | Failure at every write | L2/L3 | Harder audit/reversal | Immutable allocations |
| Nasiya completion | Native status | Final retry 409 | Client lost-response recovery | L4 | Duplicate-safe but poor recovery | Check key before completed guard |
| Import | Excluded from new-sales/stock | Contradictory/negative schedule | Large Excel batch concurrency | L2/L3 | Bad opening balances | Cross-field Decimal validation |
| Olib-sotdim | Separate receivable/payable | One currency all legs | Return policy | L0/L2 | Misstated cross-currency economics | Business model decision |
| Supplier payable | Separate table | Reminder toggle blocks overdue | Partial supplier policy | L0/L4 | Missed payable action | Decouple transition |
| Return/refund | Same-shop/transactional route | Historic rewrite/no allocation | Complete supplier effect | L3 | Accounting release blocker | Approved reversal ledger |
| Resale | Restock then normal claim | Legacy data quality | Full L5 lifecycle | L1/L2 | Generally supported | Diagnostic + browser test |
| UZS/USD conversion | Frozen event metadata | `—`, raw sums, reminder drift | Live production rates | L2–L4 | Wrong/unreadable money | Native partitions + governed rate |
| Historical reporting | Tashkent period bounds | Later return changes old month | Approved accrual policy | L3 | Historic reports unreliable | Immutable reversal |
| Dashboard | Current formulas mapped | Cohort/label/mixed-state issues | Production row distribution | L2/L5 | Misleading decisions | Regroup/rename/aggregate |
| Hisobot | Renders synthetic totals | 7.4 s at 50k/50k | Remote production latency | L5 | Slow and semantically mixed | SQL aggregates |
| Admin statistics | Counts/receipts source | Empty due table, incomplete history | >500 live shops | L5 | Renewals/payments hidden | Paginated projections |
| Exports | Tenant/auth/CSV safety; 5k cap | Native context omitted | 5k XLSX memory in serverless | L0/L2 | Weak financial audit trail | Native columns + measured export design |
| Telegram immediate | Durable queue/media planner | Revoked recipient, currency | Live Telegram | L2–L4 | Privacy/wrong amounts | Reauthorize/revalidate |
| Telegram reminders | Daily dedupe | Missed exact day, stale content, FX drift | Multi-day live outage | L0–L4 | Collections missed/wrong | Catch-up worker |
| Telegram media | Tenant keys/progress | Partial status semantics | Real signed URL/Telegram albums | L2 | Delivery claim limited | Approved staging smoke |
| Authentication | Role/sessionVersion checks | Local-only throttle; client idle | CSRF attack | L0/L2 | Credential/API exposure | Distributed throttle + L4 security |
| Tenant isolation | Scoped routes/composite FKs | No confirmed bypass | Exhaustive route matrix | L0/L3 | Strong but not exhaustively proven | Generated matrix |
| Database integrity | Tenancy/uniqueness indexes | Financial/semantic equations absent | Existing production violations | L3 | Bad data can persist | Diagnostics then constraints |
| Concurrency/idempotency | Sale claim; Nasiya payment protection | edit/delete race; claim race | Full two-client matrix | L3/L4 | State/profit corruption | Guarded writes/tests |
| Failure recovery | Durable outbox | false-green crash, no wake, duplicate window | Process-kill injection | L0/L4 | Silent/missed/duplicate alerts | Worker/observability |
| Performance | Bounded lists work | report/banner unbounded | Remote 100× production | L3/L5 | Multi-second pages | Aggregate first; no general Redis |

## 19. Explicit not tested / not claimed

- No production data was read for reconciliation in this audit.
- No production mutation, repair, deploy, commit, push or merge occurred.
- No customer or real Telegram account received a message.
- No real Telegram media album, signed Supabase URL, blocked-bot flow or live retry was tested.
- No Vercel environment-variable values, cron invocation, runtime logs, deployment region or production database pool were verified.
- No full browser mutation lifecycle was run for Sale→payment→return→restock→resale.
- No complete generated L4 route matrix attacked every Shop B identifier from Shop A.
- No real two-connection HTTP concurrency test covered payment/payment, payment/return, return/return, sale/Nasiya, import/import or supplier-payment/return.
- No crash was injected after every individual database write or after Telegram acceptance.
- No maximum Decimal/overflow path was proved across every route.
- No browser CSRF proof, upload decompression bomb, antivirus scan or live storage-policy audit was performed.
- No production-scale 5,000-row XLSX memory profile or 50,000-notification end-to-end drain occurred; only DB plans and source ceilings were measured.
- No claim is made that all production data currently satisfies the new diagnostic queries.
- No claim is made that the platform cannot fail merely because build or focused tests pass.

The most accurate present conclusion is: **the application has a solid tenant-aware transactional base, but return accounting, currency/report correctness, Telegram recovery/privacy, admin data completeness and high-volume reporting must be remediated before “everything is fully working” is an honest production statement.**
