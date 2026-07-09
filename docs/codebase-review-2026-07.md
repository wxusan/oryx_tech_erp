# Codebase review — 2026-07-10

## Executive summary

This is a fresh, read-only review of the full Oryx ERP codebase: app routes, shared logic, Prisma schema/migrations, tests, configuration, Telegram delivery, reporting, and the shop-facing UI. No production database was changed as part of this review. The findings below describe the review baseline; see the implementation addendum for work completed after the review.

## Implementation addendum — 2026-07-10

**P0-01 is implemented in code.** Nasiya status now derives from native
contract-currency schedule balances on list, detail, export, payment, and the
dashboard active-count correction. The unsafe detail-GET completion write was
removed. A stale raw `COMPLETED` parent with real native debt no longer blocks
its final payment. Detail progress now uses contract paid/final amounts.

The change includes regression tests for the rate-rise `$100 → $80` applied
case (still owes `$20`), overdue behavior, rate-fall overpayment, exact USD
completion, strict `$0.01` boundary, legacy fallback, delayed due date, and
source wiring. Historical records are deliberately not changed during reads;
the required dry-run and audited repair process is documented in
`docs/nasiya-contract-status-repair-plan.md`.

P0-02 and P0-03 were not modified by this implementation.

The project has a strong foundation: server-side session revalidation, pervasive shop scoping in business routes, explicit payment idempotency, serializable payment transactions, careful HTML escaping in Telegram templates, private image storage, meaningful audit logs, and genuinely useful pure-function tests around currency, allocation, and schedules. The architecture has clearly improved through several focused passes.

However, three confirmed P0 accounting defects remain. They are not theoretical:

- A USD nasiya can be marked `COMPLETED` from its legacy UZS mirror while contract currency still has a real balance. The detail read path then persists that false completion and blocks further payment.
- A legitimate final USD payment on a normal sale can be rejected after the USD/UZS rate rises, because it is compared to the frozen legacy UZS balance before the contract balance.
- A partial refund/return deletes the original sale or nasiya rather than recording an immutable reversal/adjustment. It changes historic reports and has no coherent representation of retained money.

Do not demonstrate cross-rate USD payment completion or partial return/refund as a reliable feature until these are fixed. The app is usable for a controlled demo of stock, UZS cash sale, standard nasiya creation, and basic payments, but it is not ready for real financial production.

## Scope and method

- Read `src/app`, `src/app/api`, `src/lib`, components, configuration, schema, migrations, tests, and requested documentation.
- Traced sale, nasiya, return/restock, supplier-payable, import, export, notification, Telegram, upload, auth, and reporting paths.
- Reviewed all dynamic API route ownership lookups for shop scoping.
- Ran `npm run typecheck`, `npm run lint`, and `npm run test`.
- Did not run migrations or use a production/shared database.

## Scores

| Area | Score /100 | Confidence | Reason | Main risks |
|---|---:|---|---|---|
| Overall codebase quality | 76 | High | Clear conventions and thoughtful fixes, but critical paths still contradict each other | Currency/return defects; huge client pages |
| Security | 82 | Medium | Strong session checks, upload controls, webhook secret, and headers | CSP is report-only; login throttle is instance-local |
| Tenant isolation | 89 | Medium | Shop-facing ID routes consistently scope the first ownership lookup to `shopId` | No live-DB/API cross-tenant proof; DB does not enforce all same-shop relationships |
| Authentication | 78 | Medium | JWT session version revalidation and bcrypt are sound | Login limiter is process-local; shop logins are case-sensitive |
| Authorization / roles | 76 | High | Shop vs super-admin separation is consistently enforced | Every shop admin has broad operational power; no staff role model |
| Money/accounting correctness | 52 | High | Contract-ledger direction is good | Three P0 defects in nasiya, sale payment, and return/reversal accounting |
| Currency correctness | 62 | High | Native contract fields and payment-time conversion are well designed | Legacy ledger still controls sale caps, nasiya display status, reminders, Olib-sotdim and exports |
| Nasiya correctness | 52 | High | Allocation and idempotency are strong inside the write transaction | Legacy status derivation can forgive a real USD balance |
| Sale correctness | 63 | High | Atomic device reservation and payment idempotency are strong | Valid final USD payment can be rejected after rate movement |
| Split payment correctness | 84 | Medium | Parts are validated, persisted, and rendered clearly for sale/nasiya payments | No creation-time split payment; supplier payable JSON field is not used in UI/route |
| Device lifecycle correctness | 70 | High | Atomic sell/nasiya/restock guards are good | Return semantics delete financial source records; no cancel/adjustment model |
| Olib-sotdim correctness | 65 | High | Creation joins device, sale and supplier payable atomically | List/export use legacy currency values; payable is binary-only |
| Supplier payable correctness | 64 | High | Double-click protection on mark-paid is sound | No partial payment, reversal, split-payment route, or durable payment ledger |
| Returns/restocks correctness | 35 | High | Return/restock status transitions are guarded and logged | Partial refund and historic accounting are unsafe |
| Customer trust/rating usefulness | 75 | Medium | Explainable score and override are useful | Override requires no reason; all shop admins can alter a credit signal |
| Telegram notification correctness | 75 | High | Escaping, private-image exclusion, verified recipients and retry states are good | Sale reminder balance is legacy-based; queue cannot drain at stated scale |
| Telegram message UX | 84 | Medium | Consistent Uzbek HTML templates and one-display-currency intent | Late/batched reminders undermine trust; some live sale amounts can drift |
| Reminder/cron correctness | 45 | High | Per-day dedupe keys and timezone helpers are sound | One daily run creates then drains only 100 globally; jitter window is not actually used |
| Dashboard accuracy | 68 | High | Formula layer and contract-aware live aggregates are a major strength | Returned contracts alter history; raw active count can disagree with schedule-level debt |
| Hisobot/report accuracy | 60 | High | Month/admin filter and cash-vs-accrual labels are thoughtful | Returns rewrite past accrual reports; exports use legacy nasiya/sale values |
| Logs/auditability | 74 | Medium | Mutations generally create useful Log rows; ops events exist | No immutable payment-reversal record, source IP is never populated, and some log data is too coarse |
| Search/filter quality | 78 | Medium | Server search, phone normalization, trigram indexes and page filters are good | Stock pickers cap at 200; Olib-sotdim lacks pagination/debounced search |
| Pagination/scalability | 71 | High | Devices, customers and nasiyalar have real paginated primary lists | Olib-sotdim and create-flow pickers remain capped; exports hard-fail over 5,000 rows |
| Mobile UX | 72 | Medium | Device, customer and nasiya lists now have card layouts | Olib-sotdim and detail history tables still require horizontal scrolling |
| Desktop UX | 79 | Medium | Core forms, details and hierarchy are clear | Return/payment corrections are too irreversible; shop identity is hard-coded in layout |
| Error handling | 76 | High | Uzbek API errors and common client error states are present | No route-level error boundaries; several errors surface only on submit |
| Loading/empty states | 78 | Medium | Main list pages cover loading/error/empty states | Some dashboard empties are generic; no resilient full-page error boundary |
| Data validation | 83 | High | Zod plus server-side ownership and image signature checks are broadly strong | Customer/shop/profile update schemas are looser than creation schemas |
| Privacy/data protection | 77 | Medium | Passport/device objects use private storage and shop-key authorization | CSP is not enforced; Telegram recipient linking relies on manually entered IDs |
| API design | 82 | High | Consistent envelopes, auth helpers, pagination and idempotency in key routes | Similar operations have inconsistent body/header idempotency and currency contracts |
| Server action/route safety | 79 | High | Most mutations use transactions, audit rows and cache invalidation | Return flow needs a ledger redesign; no test harness proves race/tenant behavior live |
| Database schema design | 73 | High | Useful indexes, partial uniques, Decimal columns, and contract mirrors | Duplicated `shopId` columns are not cross-relation constrained; JSON payment breaks are weakly normalized |
| Migration quality | 64 | High | Additive migration intent and db-push guard are strong | Large table backfills/index builds are not online; no rollback/runbook |
| Test coverage | 77 | High | 1,155 passing tests; strong pure currency/allocation coverage | 69 guard files and no DB/API integration tests leave critical runtime paths unproved |
| Test quality | 71 | High | Pure logic tests are valuable | Many checks only assert source strings; no browser E2E or live Telegram/DB flows |
| Code maintainability | 62 | High | Shared helpers are generally good | 1,603-line device detail and 819-line nasiya detail combine many state machines |
| Component structure | 58 | High | Shared UI primitives and payment modal help | Detail pages still own too many dialogs, fetches and financial behaviors |
| Performance | 65 | Medium | Batched dashboard queries, cache tags and relevant indexes are good | Dashboard loads all unpaid schedules; reminder queue and stock pickers do not scale |
| Caching correctness | 74 | Medium | Key money mutations invalidate relevant tags | Cache does not solve queue backlog; manual rate changes do not act as an immediate override |
| Observability/logging | 69 | Medium | Structured logger, OpsEvent, health and queue state exist | No alerting/SLOs, no queue age alert, no request correlation or source IP |
| Deployment readiness | 76 | Medium | Vercel cron, health probe, env example and migration guard are present | Cron throughput and migration locking make real scale risky |
| Documentation quality | 84 | High | Currency and operational docs are unusually thorough | Some documentation now overstates currency/reminder readiness and is stale after later changes |
| Client demo readiness | 72 | Medium | Strong for a controlled UZS-first walkthrough | Avoid rate-change USD settlement, partial refund, scale and overdue-reminder demonstrations |
| Real production readiness | 52 | High | Platform fundamentals are credible | P0 money defects, no correction ledger, no integration environment, and reminder backlog block release |

### Summary scores

| Metric | Score |
|---|---:|
| Overall Project Score | 76 / 100 |
| Client Demo Readiness Score | 72 / 100 |
| Real Production Readiness Score | 52 / 100 |
| Biggest Hidden Risk Score | 96 / 100 — nasiya legacy self-heal can forgive a real USD balance |
| Confidence Score in this audit | 87 / 100 |

## Findings by severity

### P0 — blockers

| ID | Severity | Area | Issue | Evidence | User impact | Fix difficulty | Recommended action |
|---|---|---|---|---|---|---|---|
| P0-01 | P0 | Nasiya/currency | Legacy UZS values decide nasiya display completion and trigger a destructive self-heal, although contract currency is documented as authoritative. A USD schedule can be legacy-paid but still contract-partial after a rate move. | `src/lib/server/shop-lists.ts:480-487`, `src/app/api/nasiya/[id]/route.ts:150-197`, `src/lib/nasiya-utils.ts:373-455` use legacy `expectedAmount`/`paidAmount`; the read route persists `status: 'COMPLETED'`. | A real balance is hidden, plan becomes completed, future payment is rejected by `src/app/api/nasiya/[id]/payment/route.ts`, and export/list/detail disagree with dashboard reminders. Example: $100 created at 12,000; customer pays 1,200,000 UZS at 15,000 = $80 contract payment, but legacy schedule reads fully paid. | Medium/high | Create one contract-aware overdue/completion derivation; use it in list, detail, export, self-heal and parent status calculation. Add worked rate-rise regression tests and a repair query/runbook for affected rows. |
| P0-02 | P0 | Sale/currency | Valid final USD sale payments can be rejected against the frozen legacy UZS `remainingAmount` before the route evaluates contract balance. | `src/app/api/sales/[id]/payment/route.ts:139-145` checks `amountInput.amountUzs > oldRemaining`; `oldRemaining` is legacy UZS while `appliedAmountInContractCurrency` is authoritative. | A customer trying to pay the exact remaining $100 after the rate rises can be told payment exceeds debt, leaving a valid debt impossible to settle. Olib-sotdim sales share the route. | Medium | Validate overpayment solely against contract outstanding in contract currency; derive legacy snapshot only after acceptance. Test USD rise and fall, both payment currencies, and idempotent retries. |
| P0-03 | P0 | Returns/accounting | A return with any refund amount soft-deletes the sale/nasiya and then allows restock. It records only a single `DeviceReturn`; it does not reverse individual payments, interest, profit, or retained value. | `src/app/api/devices/[id]/return/route.ts:96-123`; reports exclude deleted sales/nasiyas in `src/lib/server/shop-stats.ts:65-121`. | Partial refund, zero-refund return, and past-period return can silently rewrite historic revenue/profit and leave no coherent financial explanation for money retained or refunded. | High; redesign | Do not patch by editing historic rows. Design immutable return/reversal/adjustment entries, explicit return outcome (full/partial/refund/fee), and report rules before implementation. |

### P1 — fix before first real client

| ID | Severity | Area | Issue | Evidence | User impact | Fix difficulty | Recommended action |
|---|---|---|---|---|---|---|---|
| P1-01 | P1 | Notifications/scale | `processPendingNotifications` takes only 100 rows and has no continuation; the daily cron is the only guaranteed drain. | `src/lib/notification-service.ts:157-180`, `src/app/api/cron/reminders/route.ts:705`. | At 3,000 plans and 20 admins, reminders backlog for days and can arrive after the due date. | Medium | Paginate/loop with a time budget or use a queue worker; expose pending age and alert when overdue. |
| P1-02 | P1 | Cron/Telegram UX | The configured cron runs at 11:35 Tashkent, after the documented 11:00–11:30 jitter window. Created rows are already due and are sent in one drain. | `vercel.json`, `src/app/api/cron/reminders/route.ts:8-25`, `src/lib/notification-schedule.ts`. | The claimed spreading does not happen; recipients receive bursts and delivery is less reliable. | Low/medium | Align scheduler frequency/window, or remove jitter and document one daily batch deliberately. |
| P1-03 | P1 | Historical payments | Initial sale payments and nasiya down payments omit `paymentInputAmount`, `paymentInputCurrency` and `paymentExchangeRate`. | `src/app/api/devices/[id]/sell/route.ts:143-156`, `src/app/api/devices/[id]/nasiya/route.ts:218-232`, `src/app/api/olib-sotdim/route.ts:261-274`. | Old initial payments are displayed using the current rate fallback rather than the rate/customer amount at creation; audits and split history are incomplete. | Medium | Populate the same historical fields for every initial payment and migrate/label existing unknown history honestly. |
| P1-04 | P1 | Telegram/currency | Sale due, overdue and early-reminder messages query/display `Sale.remainingAmount`, the legacy UZS balance, not `contractRemainingAmount`. | `src/app/api/cron/reminders/route.ts:346-510`; templates accept a UZS `remainingAmount`. | USD sale reminder amount drifts after rate changes and can disagree with sale detail/dashboard. | Medium | Make sale reminder templates contract-aware and select/filter on contract balance. |
| P1-05 | P1 | Olib-sotdim/currency | Olib-sotdim list shows legacy UZS purchase/sale/profit through today’s display rate; it does not select contract fields. | `src/app/api/olib-sotdim/route.ts:72-107`, `src/app/(shop)/shop/olib-sotdim/page.tsx:56-70, 195-203`. | A USD operation’s displayed price/profit drifts, despite native contract data existing. | Medium | Return contract purchase/sale/payable data and render through contract-aware formatters; apply same rule to exports. |
| P1-06 | P1 | Payment operations | There is no safe void/reversal/correction flow for sale, nasiya, or supplier payments. | No payment DELETE/adjustment routes; money fields are intentionally locked in `src/app/api/sales/[id]/route.ts` and `src/app/api/nasiya/[id]/route.ts`. | Staff cannot correct an accepted payment except by a destructive return workaround. | High; redesign | Define immutable reversal/adjustment entries with reason, actor, linked original, and report effects. Never allow direct payment edits. |
| P1-07 | P1 | Supplier payable | Supplier debt is a one-shot status flip, with no partial amount, split payment persistence, correction, or payable-payment ledger. | `src/app/api/olib-sotdim/[id]/pay/route.ts`, `src/app/(shop)/shop/olib-sotdim/page.tsx`; `paymentBreakdown` exists in schema but is unused. | Real supplier settlement cannot represent installments or a mistaken payment. | Medium/high | Either explicitly limit product scope in UI or introduce `SupplierPayment` records before client use. |
| P1-08 | P1 | Security | Login throttling is an in-memory map keyed by login and is not distributed or IP-aware. | `src/lib/auth.ts:20-58`; rate-limit adapter is not used for login. | Brute-force protection weakens across serverless instances/cold starts. | Medium | Use a shared limiter for login by account and IP; normalize shop login case at creation/login. |
| P1-09 | P1 | Browser security/privacy | CSP is report-only and permits inline script/style; Telegram notifications carry customer phone/IMEI to manually configured Telegram IDs. | `next.config.ts:24-74`, `src/app/api/telegram/webhook/route.ts:35-89`. | XSS blast radius remains higher than necessary; a mistaken recipient ID can receive shop/customer data after `/start`. | Medium | Move CSP to enforced nonce/hash design after report collection; add a recipient confirmation flow and documented PII policy. |
| P1-10 | P1 | Performance/UX | Sale and nasiya creation load only the default 200 in-stock devices and filter client-side. | `src/app/(shop)/shop/sotuv/new/page.tsx:115`, `src/app/(shop)/shop/nasiyalar/new/page.tsx:165`; `/api/devices` non-paginated default. | At a 5,000-device shop, staff cannot find most available devices. | Medium | Add server-backed stock picker search with cursor/page results and keyboard selection. |
| P1-11 | P1 | Performance | Dashboard fetches every unpaid schedule and computes aggregates in application memory; notification creation is one row per admin per deal. | `src/lib/server/shop-stats.ts:99-144`, `src/app/api/cron/reminders/route.ts`. | Slow dashboard/cron and increased serverless timeout risk at stated scale. | Medium | Move aggregate work to bounded SQL/grouped queries or a materialized summary; batch notification creation. |
| P1-12 | P1 | Migration/release | Several production migrations create indexes/backfill large tables in normal migration transactions, while docs acknowledge online indexes are needed for large tables. No rollback playbook is present. | `prisma/migrations/202607020004_search_performance_indexes/migration.sql`, `202607080004_nasiya_contract_currency/migration.sql`, `docs/audits/production-readiness-followup.md`. | A production deploy can lock tables or be hard to recover from. | Medium | Require staging rehearsal, backup/restore plan, online-index procedure and explicit forward-fix rollback strategy before production migration. |

### P2 — fix soon

| ID | Severity | Area | Issue | Evidence | User impact | Fix difficulty | Recommended action |
|---|---|---|---|---|---|---|---|
| P2-01 | P2 | Nasiya UX | Detail-page progress percentage is calculated from legacy fields while displayed paid/total use contract fields. | `src/app/(shop)/shop/nasiyalar/[id]/page.tsx:399-406, 557-566`. | A USD nasiya can show “$80 paid” and “100%” together. | Low | Calculate percentage from `contractPaidAmount / contractFinalAmount`. |
| P2-02 | P2 | Export | Sales/nasiya exports format legacy UZS values using today’s rate and derive nasiya status from legacy schedules. | `src/app/api/export/[entity]/route.ts:194-353`. | Spreadsheet can contradict UI/contract history. | Medium | Export explicit contract fields and clearly labelled historical UZS snapshots; use contract-aware status helper. |
| P2-03 | P2 | Olib-sotdim UX | Olib-sotdim has no pagination, no debounce, no mobile cards and an irreversible “paid” action without confirmation/reversal. | `src/app/(shop)/shop/olib-sotdim/page.tsx`, `src/app/api/olib-sotdim/route.ts:45-107`. | Supplier debt is hard to scan on a phone and easy to misrecord. | Medium | Add pagination/mobile cards now; only add confirmation alongside the P1 payment-ledger design. |
| P2-04 | P2 | Validation consistency | Customer, shop profile, device patch, and admin profile update schemas lack some creation-time max/format limits. | `src/app/api/customers/[id]/route.ts:15-27`, `src/app/api/shop/profile/route.ts:34-42`, `src/app/api/devices/[id]/route.ts:25-36`. | Oversized/poorly formatted data creates poor UI and logs. | Low | Reuse named common Zod schemas across create/update routes. |
| P2-05 | P2 | Auth UX | Super-admin logins are lowercased, but shop-admin creation/login are case-sensitive; global unique text index permits case variants. | `src/lib/auth.ts:145-156`, `src/app/api/shops/route.ts`, schema `ShopAdmin.login`. | Workers can be locked out by capitalization and confusing duplicate-like accounts. | Low/medium | Normalize and migrate shop logins to lowercase with collision review. |
| P2-06 | P2 | Data model/tenant defense | Redundant `shopId` fields on sale/payment/schedule rows are not enforced to match their related sale/device/nasiya/customer shop. | `prisma/schema.prisma` `Sale`, `SalePayment`, `NasiyaPayment`, `NasiyaSchedule`. | A future route bug/direct DB operation can create internally inconsistent or cross-shop records. | High; redesign/migration | Add composite tenant foreign keys or eliminate redundant ownership columns in a planned schema redesign. |
| P2-07 | P2 | Auditability | `Log.ipAddress` exists but is not populated; business logs lack request IDs and payment reversal chains. | `prisma/schema.prisma`, route searches show no `ipAddress` writes. | Investigating a disputed operation is harder. | Medium | Capture trusted proxy IP/request ID where appropriate; include linked adjustment IDs after ledger redesign. |
| P2-08 | P2 | Product roles | Shop admins have one broad role; shop owner cannot self-manage staff/permissions. | `ShopAdmin` schema and `requireApiSession`; admin management is super-admin-only. | Owner must ask platform admin and cannot limit cashier vs manager actions. | Medium/high | Confirm client need before building a minimal role/permission matrix. |
| P2-09 | P2 | Trust score governance | Any shop admin can manually override a customer trust tier with no reason/audit-specific UI explanation. | `src/app/api/customers/[id]/route.ts`, customer edit modal. | Credit decision signal can become arbitrary. | Low | Require a reason and surface “manual override by/date” in the badge/history. |
| P2-10 | P2 | Currency operations | Manual USD rate is only a fallback after CBU failure; a new manual rate does not override a fresh CBU rate or invalidate its 12-hour cache decision. | `src/lib/server/currency.ts:25-47`, `src/app/api/admin/currency-rate/route.ts`. | Admin expectation of a “manual rate” can be wrong. | Low | Rename it “fallback rate” or implement a deliberate, audited override policy. |
| P2-11 | P2 | Caching/reporting | Parent nasiya status can be raw-completed while schedule-level contract debt remains, and active-count uses raw status. | `src/lib/server/shop-stats.ts:92-100`; P0-01 read self-heal. | Dashboard count may contradict expected/overdue totals. | Resolved with P0-01 | Derive from contract schedules or repair parent status atomically with the contract-aware fix. |
| P2-12 | P2 | Maintainability | Device detail owns sale payment, edit, delete, return, restock, image and nasiya flows in one 1,603-line client component; nasiya detail is 819 lines. | `src/app/(shop)/shop/qurilmalar/[id]/page.tsx`, `src/app/(shop)/shop/nasiyalar/[id]/page.tsx`. | Financial changes are risky to modify and review. | Medium/high | First add browser tests, then extract modal controllers one at a time. |
| P2-13 | P2 | Test tooling | No coverage reporter, live Postgres integration suite, Playwright flow tests, or Telegram stub integration tests. | `vitest.config.ts`, `tests/integration.todo.test.ts`. | Guard tests can pass while route construction/runtime behavior is broken. | Medium | Provision a disposable Postgres DB and add the P1 test list below; add coverage reporting. |

### P3 — can wait

| ID | Severity | Area | Issue | Evidence | User impact | Fix difficulty | Recommended action |
|---|---|---|---|---|---|---|---|
| P3-01 | P3 | Shop UX | Shop layout contains hard-coded “Malika shop OS”, “Do'kon admini”, and avatar “S”. | `src/app/(shop)/layout.tsx:42-82`. | Feels unfinished and can confuse a new shop. | Low | Render actual shop/admin name and initials from session/profile. |
| P3-02 | P3 | Navigation | Olib-sotdim is not a direct shop navigation item despite being a supplier-debt workspace. | `src/app/(shop)/layout.tsx:10-20`. | Workers may miss overdue supplier debts. | Low | Add a visible nav item or a supplier-debt badge after product confirmation. |
| P3-03 | P3 | Empty/error UX | Several dashboard/list empty messages are generic and error recovery is manual. | Dashboard/list components. | Small friction for new users. | Low | Add contextual next action and retry controls. |
| P3-04 | P3 | Documentation | Earlier audit docs still describe now-resolved pagination/mobile work and overstate remaining currency/reminder correctness. | `docs/audits/*`, `docs/currency-accounting-model.md`. | Future maintenance can rely on stale assurance. | Low | Update historical docs with superseding references after P0 fixes. |

## Money and accounting review

### Strong points

- `Decimal` fields, native contract fields, payment-time conversion, split-payment sum validation, serializable payment transactions, and idempotency keys are the right building blocks.
- Nasiya allocation prioritizes the selected schedule then effective due order and correctly uses contract currency for the main overpayment gate: `src/app/api/nasiya/[id]/payment/route.ts` and `src/lib/nasiya-payment-allocation.ts`.
- Purchase currency is preserved on Device, preventing a same-currency purchase/sale margin from round-tripping through UZS.
- Reports distinguish cash collected, accrual revenue and refunds more clearly than a typical small-shop ERP.

### Confirmed money failures

1. **USD nasiya rate-rise forgiveness (P0-01).** A 1,200,000 UZS payment at a later 15,000 rate applies as $80 to a $100 plan created at 12,000. Allocation leaves contract debt $20 but fills legacy UZS schedule paid amount to 1,200,000. Legacy `deriveNasiyaOverdue` reports complete and the GET route asynchronously writes `COMPLETED`. The next genuine $20 payment is rejected.
2. **USD sale final payment rejection (P0-02).** A $100 balance created at 12,000 has legacy UZS balance 1,200,000. At 13,000 a legitimate $100 payment becomes 1,300,000 UZS and is rejected before contract conversion can settle it.
3. **Partial returns are not an accounting ledger (P0-03).** The return route soft-deletes the original contract regardless of refund amount. It cannot represent partial refund, retention, cancellation fee, returned interest, or a late correction without rewriting history.
4. **Initial payment history is incomplete (P1-03).** The initial `SalePayment`/`NasiyaPayment` records do not persist original input/rate fields, so their display silently falls back to current-rate conversion.
5. **Olib-sotdim accounting is only partly modelled (P1-05/P1-07).** Supplier payment is a status stamp rather than a financial payment record, and the list reads legacy amounts.

### Direct answers to accounting questions

| Question | Result |
|---|---|
| Can an amount be double-counted? | Payment writes use idempotency/serializable transactions; standard sale/nasiya duplicate submission is well defended. Returned payment rows still feed cash collection while deleted contracts disappear from accrual history, which creates report ambiguity. |
| Can an amount be missed? | Yes: P0-01 can hide an unpaid USD balance; initial payment historical context is missing; retained value in a partial return is not a typed accounting event. |
| Can dust change status? | Yes, legacy UZS tolerance is still used in nasiya derivation while contract ledger uses USD-cent tolerance. This is the root of P0-01, not merely cosmetic dust. |
| Can a payment be applied twice? | Sale/nasiya post-payment routes require idempotency and retry serializable transactions; supplier mark-paid has an atomic status guard. Live-DB proof is still missing. |
| Can current rate change old history? | Later payments store rate; initial sale/down-payment rows do not. Olib lists/exports and sale reminders still reconvert legacy amounts through current rate. |
| Can USD/UZS be raw-summed? | Main live dashboard aggregates convert contract values correctly, but legacy reports/list/export paths remain inconsistent. |
| Can a returned device still count profit? | Contract is soft-deleted from accrual queries, so the problem is worse: historical profit can disappear rather than be adjusted explicitly. |
| Can completed nasiya show overdue or vice versa? | Yes. P0-01 can mark a plan complete in detail/list while contract schedule debt still appears to cron/dashboard. |
| Can payment history disagree with debt? | Yes: initial payment display and nasiya progress can disagree with contract debt after rate movement. |

## Tenant isolation review

### What is strong

- Shop-admin session validation rechecks active admin, exact shop, shop status and subscription on every API guard: `src/lib/api-auth.ts`.
- Dynamic device, sale, nasiya, customer, return, restock, payable and log-link routes constrain ownership with `shopId` before mutation.
- File-key access checks shop prefixes; passport files are private and not eligible for Telegram photos.
- Super-admin-only routes use `requireSuperAdmin`; a shop admin cannot invoke platform admin endpoints.

### Residual concerns

- The evidence is static and code-level. `tests/tenant-isolation.guard.test.ts` scans source but no test calls an API handler against a live DB as Shop A and Shop B.
- The schema repeats `shopId` on connected entities without composite constraints. Application code is safe today, but the database cannot independently reject a mismatched `Sale.shopId`/`Device.shopId` or payment/sale shop mismatch.
- `resolveNotificationImageUrl` uses related IDs without directly checking the notification’s `shopId`; current route-created notification rows make this safe in practice, but a future writer should include and verify shop ownership.

**Conclusion:** no confirmed current user-facing cross-shop read/write exploit was found. Tenant isolation is strong at the route layer but not yet proven with live integration tests or fully backed by relational constraints.

## Telegram review

### Strong

- Dynamic template values pass through escaping helpers; templates use a controlled HTML subset.
- Only verified, active, non-deleted shop admins are selected for shop notifications.
- Device-only signed images are resolved at send time; passport path cannot match the device-image key pattern.
- Photo failure falls back to text; retry/cancel state and OpsEvent recording exist.
- Per-day reminder dedupe keys include recipient and related entity.

### Findings

- **Queue backlog and faux jitter (P1-01/P1-02):** current cron cadence cannot deliver a large daily queue within the intended schedule window.
- **Sale reminder currency drift (P1-04):** nasiya and supplier reminder amount paths are contract-aware; sale reminder amount path is not.
- **Recipient verification is operationally fragile (P1-09):** manually entering an ID followed by `/start` is possession proof, not a shop-admin confirmation workflow. A typo or accidental reassignment can expose phone/IMEI data.
- **No live Telegram integration test:** current tests prove escape/string/delivery decisions, not recipient selection and queue behavior against a real transaction database.
- **Long-message behavior:** the photo caption fallback is careful; no explicit 4096-character safeguard exists for text. Current input field limits make this low probability.

## UI/UX review — shop-worker perspective

| Page | Exact confusion/risk | Suggested fix |
|---|---|---|
| Nasiya detail | “To'langan” can show $80 while progress says 100%; status can say completed when money is still due. | Fix P0-01 first, then derive percentage/status from contract fields only. |
| Device detail return | Worker can enter any partial/zero refund and confirm a return without seeing how it affects prior cash, profit and debt. | Replace with an explicit return outcome review once immutable reversal design exists. |
| Sale payment modal | It can reject a valid USD settlement with a generic “exceeds debt” message after exchange movement. | Fix contract-only validation and show exact contract balance/prepared payment. |
| Olib-sotdim | No direct nav item, no mobile card layout, no pagination, and “To'landi deb belgilash” is a one-shot binary action. | Add navigation/mobile/page controls; redesign payable payment workflow. |
| New cash sale/new nasiya | Stock selector loads a fixed initial subset rather than searching the full warehouse. | Use a server-backed searchable combobox. |
| Shop shell | “Malika shop OS”, “Do'kon admini”, and `S` avatar are not the actual shop/admin. | Load real identity from session/profile. |
| Forms | Several errors appear only after submit; customer/shop update rules differ from creation. | Add field-level validation and shared schemas. |
| Mobile detail histories | Payment/schedule tables are horizontally scrollable rather than summarized for phone use. | Preserve table on desktop; add compact timeline/card representation for the key values. |

## Test quality review

### Existing real coverage

- Strong pure tests: currency conversion, nasiya amounts, allocation, payment breakdown, date/timezone helpers, notifications schedule, phone normalization, rate limit adapter, logger redaction, trust score and report formula layer.
- Useful guard coverage: security headers, tenant ownership patterns, contract fields, rate-limit route coverage, Telegram template rules, pagination wiring and mobile markup.

### Limits

- 69 of 112 test files are `*.guard.test.ts`; 76 test files read source text. These tests can pass if a route is syntactically shaped correctly but query semantics, transaction execution, serialization, session handling or UI interaction is broken.
- No live Postgres/API route test verifies idempotency uniqueness, serialization conflict handling, raw partial indexes, or cross-shop access.
- No browser E2E test covers sell, nasiya payment, split payment, return, restock, responsive UI or file upload.
- Telegram tests are template/delivery-plan checks, not queue/recipient/integration behavior.

### Top tests to add

| Missing test | Why it matters | Suggested test type | Priority |
|---|---|---|---|
| USD nasiya created at 12,000 then paid 1,200,000 UZS at 15,000 remains $20 active | Direct regression for P0-01 and self-heal safety | Pure helper + live DB/API integration | P0 |
| USD $100 sale created at 12,000 accepts final $100 at 13,000 | Direct regression for P0-02 | Live API/DB integration | P0 |
| Full, partial, zero-refund and prior-period return report outcomes | Prevents misleading profit/cash history | DB/report integration | P0 |
| Shop A cannot read/mutate Shop B device/customer/nasiya/file | Validates real ownership, not source text | Authenticated API integration | P1 |
| Replay and concurrent duplicate payment requests | Validates unique idempotency + serializable transaction | DB/API concurrency integration | P1 |
| Cron with >100 pending notifications drains until time budget / reports backlog | Prevents stale reminders | DB + fake Telegram integration | P1 |
| Olib-sotdim USD list/export stays contract-correct after rate move | Prevents display/report drift | Route/UI integration | P1 |
| Initial sale/down-payment history preserves original currency and rate | Ensures audit history correctness | API/unit integration | P1 |
| Cash sale and nasiya stock picker can find item 201+ | Catches real shop flow scalability failure | Playwright E2E | P1 |
| Mobile return/payment confirmation and layout | Protects high-risk mobile flow | Playwright E2E | P2 |

## Performance and scale review

Assuming 5,000 devices, 2,000 customers, 3,000 nasiyas, 30,000 payments and 20 admins:

- **Dashboard:** `getShopStatsFresh` correctly batches independent work, but `nasiyaSchedulesForStats` loads every unpaid schedule into application memory. With 3,000 multi-month plans this can be tens of thousands of rows every cache cycle.
- **Reminder cron:** every matching deal is loaded with customer/device/shop/admin relations and then produces one `Notification` per admin. The processor only claims 100 jobs once. This is the clear scaling failure.
- **Stock pickers:** sale/nasiya creation request an unpaginated in-stock list with the route’s 200-row default. Item 201+ is unavailable in the UI.
- **Olib-sotdim:** list is a 200-row hard cap with no `skip`, pagination, debounce, or card view.
- **Search:** primary device/customer/nasiya search has sensible trigram indexes and server paging. Device search’s nested `some` customer relations are still more expensive than a denormalized search index at larger scale.
- **Exports:** exports page in 500-row batches but rejects all exports over 5,000 rows. That is a safe failure, but a real 5,000-device shop is at the limit before related data is considered.
- **Caching:** money mutation invalidations are disciplined. Cache correctness is not the primary risk; data correctness and cron throughput are.

## Database and migration review

### Strong

- Appropriate Decimal types, partial unique indexes for active IMEI/phone, durable idempotency unique keys, relevant date/status indexes, and a defensive `db push` guard.
- Contract-currency data is additive, preserving a migration path for old UZS data without inventing historical USD rates.

### Risks

- Contract and legacy mirrors multiply consistency obligations. P0-01 proves a reader still used the wrong mirror.
- Soft deletion changes business/report semantics. It is not an accounting reversal strategy.
- `paymentBreakdown` JSON is acceptable for display detail but inadequate for report-by-method and supplier partial settlements; it should not become the long-term payment ledger.
- Raw partial/trigram index migrations are not safely online for a large active production database. Migration files themselves warn about this, but there is no operational runbook or rollback plan.
- No database constraint guarantees every relation carrying `shopId` belongs to the same tenant.
- Nullable historical currency fields are honest for old records, but every fallback must remain visibly “legacy/unknown” rather than pretend it has a current-rate fact.

## Maintainability review

| File | Problem | Why it matters | Fix approach |
|---|---|---|---|
| `src/app/(shop)/shop/qurilmalar/[id]/page.tsx` | 1,603-line client component with multiple money and lifecycle dialogs | A small UI change can break a different financial workflow | Add E2E coverage; extract one modal/controller at a time |
| `src/app/(shop)/shop/nasiyalar/[id]/page.tsx` | 819-line detail with display, score, passport, schedule and edit behavior | Status/progress logic is duplicated/fragile | Move contract presentation selectors to a tested view-model helper |
| `src/lib/nasiya-utils.ts` | Legacy UZS overdue/completion helper is reused for USD-native state | Central helper has a misleading universal role | Split legacy compatibility helper from contract-aware authoritative helper |
| `src/lib/server/shop-lists.ts` | Contract-aware payment score beside legacy status derivation | Mixed-source truth is easy to miss in review | Return a single contract-derived status view model |
| `src/app/api/cron/reminders/route.ts` | One very large sequential job orchestrates all reminder types and delivery | Hard to make throughput safe or retry independently | Separate generation from worker drain; batch each type |
| `src/app/api/devices/[id]/return/route.ts` | Return, cancellation and refund accounting are conflated | Directly causes P0 financial ambiguity | Replace only after adjustment-ledger design is approved |
| `src/app/api/olib-sotdim/route.ts` and page | Contract data exists but page uses legacy fields | Regresses currency design in one product area | Centralize operation view model/formatter |

## Product completeness review

| Product question | Assessment |
|---|---|
| Can owner manage staff? | Only through super admin; no shop-owner staff role/permission management. |
| Can owner see who did what? | Mostly yes through logs, but no IP/request correlation and no immutable reversal chain. |
| Can owner export data? | Yes for primary entities, up to 5,000 rows; exports are not contract-currency-complete. |
| Can owner import existing data safely? | Customer batch import and manual old-nasiya import exist; no preview/dry-run/rollback and customer import is serial inside a transaction. |
| Can owner correct mistakes? | Metadata corrections exist. Financial correction/void/adjustment does not. |
| Can owner undo a payment? | No, not safely. |
| Can owner handle returned nasiya/partial refunds? | Status transition exists, but accounting is not safe for partial/zero/full historical return cases. |
| Can owner handle broken device? | No dedicated damaged/write-off/repair inventory state. |
| Can owner handle supplier debt? | Basic all-or-nothing payable/reminder works; partial/corrective settlement does not. |
| Can owner understand profit? | Normal current-deal display is good; returns and Olib-sotdim currency history compromise trust. |
| Can owner filter reports? | Month/admin filters exist, with clear non-attribution note; return/history semantics remain wrong. |
| Can owner trust reminders? | Not at scale until queue/drain scheduling is fixed. |
| Can owner operate without developer help? | For routine UZS flows, mostly. For corrections, returns, staff permissions, bulk scale, or currency edge cases, no. |

## Action plan

### Immediate before demo

| Priority | Task | Why | Estimated risk | Estimated effort | Files likely affected |
|---|---|---|---|---|---|
| P0 | Fix contract-aware nasiya completion/status derivation and disable unsafe self-heal until repaired | Stops real USD debt from being forgiven | Very high | Medium | `nasiya-utils.ts`, `shop-lists.ts`, `api/nasiya/[id]/route.ts`, export, tests |
| P0 | Make sale overpayment validation contract-currency-only | Lets valid USD customer settlement complete | Very high | Small/medium | `api/sales/[id]/payment/route.ts`, contract helpers, tests |
| P0 | Put partial return/refund demo behind an explicit limitation or remove partial amount entry pending redesign | Avoids demonstrating unsafe accounting | Very high | Small as containment; high for real solution | return modal/route, docs |
| P1 | Add visible queue/backlog warning in ops and avoid claiming jitter | Keeps demo honest about reminders | High | Small | ops page/route, cron docs |
| P1 | Add the two USD worked-example regression tests | Prevents immediate reintroduction | High | Small | new tests |

### Before first real client

| Priority | Task | Why | Estimated risk | Estimated effort | Files likely affected |
|---|---|---|---|---|---|
| P1 | Design and implement immutable payment adjustment/reversal + return ledger | Core operational accounting requirement | Very high | High | schema, migrations, reports, return/payment routes, exports, UI |
| P1 | Make notification draining bounded-but-complete and align cron cadence | Prevents stale/duplicate-looking reminders at real scale | High | Medium | notification service, cron, Vercel scheduler, ops |
| P1 | Repair sale reminders/Olib-sotdim/list/export currency paths | One truthful contract-currency rule everywhere | High | Medium | cron, templates, Olib route/page, export |
| P1 | Preserve initial payment input/rate/breakdown history | Auditability and historical display | High | Medium | sale/nasiya/olib creation routes, UI/tests |
| P1 | Provision disposable Postgres + API integration test harness | Proves tenancy, idempotency and accounting routes | High | Medium | test infra, CI, integration tests |
| P1 | Build server-backed stock picker and paginate Olib-sotdim | Daily shop usability at inventory scale | High | Medium | device API, new-sale/new-nasiya UI, Olib API/page |
| P1 | Enforce distributed login rate limit and production CSP | Close externally exposed hardening gaps | Medium/high | Medium | auth, limiter env/deploy, proxy/CSP |

### After first client feedback

| Priority | Task | Why | Estimated risk | Estimated effort | Files likely affected |
|---|---|---|---|---|---|
| P2 | Supplier partial-payment/adjustment model | Depends on actual shop settlement practice | Medium | High | schema/routes/Olib UI/reports |
| P2 | Owner-managed staff roles and trust override governance | Needs real workflow decisions | Medium | Medium | auth/schema/settings/logs |
| P2 | Contract-currency export redesign | Better accountant-facing export | Medium | Medium | export route/tests |
| P2 | Inline validation and mobile detail timelines | Reduce training/support burden | Low/medium | Medium | forms/detail components |
| P2 | Structured audit context/IP/correlation | Better support and dispute resolution | Low/medium | Medium | middleware/logger/log writers |

### Later scale

| Priority | Task | Why | Estimated risk | Estimated effort | Files likely affected |
|---|---|---|---|---|---|
| P2 | Replace in-memory dashboard aggregate with SQL summaries/materialized reporting | Keeps dashboard fast at many schedules | Medium | High | stats layer/schema/jobs |
| P2 | Tenant-consistent composite relation constraints | Adds defense in depth | Medium | High | schema/migrations/all writes |
| P2 | Extract detail-page flows after E2E coverage | Lowers ongoing regression risk | Medium | High | detail components/tests |
| P3 | Improve empty states, branding and navigation | Product polish | Low | Small | layouts/pages |

## Top five first fixes

1. Contract-aware nasiya completion/derived status and repair plan for affected data.
2. Contract-only sale payment overpayment validation.
3. Immutable return/refund/payment-adjustment accounting design.
4. Notification worker drain + scheduler alignment.
5. Currency-correct initial payment, sale reminder, Olib-sotdim and export surfaces.

## Top five manual QA flows

1. USD nasiya at one rate, partial UZS payment at a higher rate, then view list/detail/dashboard and collect the remaining USD balance.
2. USD cash sale at one rate, settle exact USD remainder at a higher and lower rate.
3. Full, partial and zero-refund return across the same month and a later month; compare cash, profit, exports and restock state.
4. Create 101+ due reminders and verify drain order, queue age, dedupe and actual Telegram delivery timing.
5. With Shop A and Shop B sessions, attempt every ID route, file signed URL, log link, payment and export across shop IDs.

## Top five things not to touch without a bigger redesign

1. Payment history by directly editing/deleting `SalePayment` or `NasiyaPayment` rows.
2. Return/refund by simply changing `deletedAt`, `amountPaid`, `remainingAmount` or profit fields.
3. The dual legacy/contract ledger fields without one authoritative view-model/repair plan.
4. Tenant `shopId` duplication/relations without a staged migration and composite constraints strategy.
5. Large detail-page refactors before Playwright coverage of sell, payment, return and restock.

## Manual QA checklist

- [ ] UZS cash sale: full and partial payment, reminder and payment history.
- [ ] USD cash sale: create at one rate, pay in USD/UZS after rate changes, then close exactly.
- [ ] UZS and USD nasiya: down payment, selected-month payment, overpayment allocation, defer, completion and overdue.
- [ ] Split cash/card payment: each part total, persisted history and Telegram text.
- [ ] Return: full and partial refund, historical report comparison, restock and re-sale.
- [ ] Olib-sotdim: supplier paid now/later, overdue reminder, paid status and profit display in UZS/USD.
- [ ] Shop A/B isolation: detail, mutation, export, upload retrieval and logs.
- [ ] Mobile: device/nasiya/customer list card flows, payment modal, return dialog, Olib list.
- [ ] Notification retry: text fallback when photo fails, unverified/deleted admin exclusion, queue failure state.
- [ ] Deployment: clean migration rehearsal on staging, cron secret, database health, rate-limit configuration and CSP reports.

## Final recommendation

**Do not approve real production deployment yet.** Approve a narrowly scoped P0 remediation plan first: nasiya authoritative-state derivation, sale payment contract validation, and a decision/design for returns/refunds. For a client demo, restrict scope to stable UZS flows and be explicit that partial returns, financial corrections, rate-change settlement and high-volume reminder behavior are not demo commitments.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run test` | Passed: 111 files passed, 1 skipped; 1,155 tests passed; 17 tracked TODOs. The test output also displayed expected DB-safety guard messages from its safety tests. |

## Change control

- Application code changed: **No**.
- Documentation created: this report and `docs/codebase-review-action-plan.md`.
- Commit created: **No**.
- Push performed: **No**.
