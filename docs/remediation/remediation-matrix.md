# Production remediation matrix

Baseline: `e818f1b47cf5a74ce4f7ccc3dbb600163078a6a7` on 2026-07-12.

Status meanings:

- `OPEN`: confirmed work has not started.
- `IN PROGRESS`: implementation or its prerequisite is being built.
- `DECISION`: product/accounting approval is required before implementation.
- `VERIFY`: code exists but the required database/browser/production proof is incomplete.
- `DONE`: implementation and every stated acceptance gate passed.

No row may move to `DONE` because it compiles or passes a source guard alone.

| Finding | Current state | Main files | Planned change | Required tests | Migration | Risk | Status |
|---|---|---|---|---|---|---|---|
| F-001 | Return restocks and deletes/cancels the contract without immutable financial reversals | `devices/[id]/return`, `schema.prisma`, stats/exports | Approved refund, reversal and allocation ledger | Full/partial/zero refund, Qarz/nasiya, concurrent payment/return, reconciliation | Additive accounting models + reviewed backfill policy | Critical/accounting | DECISION |
| F-002 | Six-character password minimum; login throttle is per instance | `auth.ts`, admin routes, rate-limit adapter | Strong password policy and distributed login/source throttling | Multi-instance limiter, password create/reset/login | None unless auth-event persistence is approved | Medium/security | OPEN |
| F-003 | Initial payment metadata fixed; exports/reminders still need native-contract conversion. Olib list now uses native amounts | sale/nasiya/Olib create routes, exports, cron, UI | Finish frozen contract read model everywhere | Rate-change golden tests, CSV/XLSX/message tests | Data audit; optional additive backfill markers only | High/accounting | IN PROGRESS |
| F-004 | Olib now paginates; sale/nasiya stock picker still defaults to 200 | device picker pages, devices API, Olib API/UI | Server-searchable paginated selector | 100k-last-record lookup, paging/filter behavior | Index only if query plan proves necessary | Medium/UX | IN PROGRESS |
| F-005 | Overdue API now filters effective due dates in PostgreSQL; filtered nasiya/dashboard projection remains | shop lists, due-overdue API, shop stats | Complete bounded SQL/queryable derived-status projection | Status equivalence, query bounds, performance | Likely additive projection/index | High/correctness | IN PROGRESS |
| F-006 | Notification drain takes 100 and sends sequentially; cron loops row by row | notification service, cron, admin ops | Batched claim/drain, bounded concurrency, queue age | Retry/dedupe/crash/concurrency/load | Optional queue-age index after plan | Medium/reliability | OPEN |
| F-007 | Vercel migration ran before build; no mandatory CI | `vercel.json`, workflows, release docs | CI and artifact-first manual production release | CI itself + migration rehearsal | None | High/release | IN PROGRESS |
| F-008 | 17 DB/tenant/Telegram integration tests are TODO | integration TODO, Vitest config | Disposable PostgreSQL and real behavior tests | All 17 TODO scenarios executable | All migrations applied to disposable DB | Medium | IN PROGRESS |
| F-009 | Pull-only ops view; no complete recovery/SLO/alert path | ops API/UI, logger, docs | Recovery runbook, alert contract, restore drill | Synthetic incident and restore drill | None | High/operations | IN PROGRESS |
| F-010 | CSP report-only with unsafe-inline and no collector | `next.config.ts`, proxy | Report collection, nonce-based staged enforcement | Header/browser CSP suite | None | Medium/browser | OPEN |
| F-011 | Related tenant IDs are not database-constrained to the same shop | schema and all financial relations | Detection, approved cleanup, composite constraints where safe | Cross-shop insert/update rejection | Rehearsed additive constraints | High/data | OPEN |
| F-012 | Backfills/indexes/enum rewrites lack a unified online migration runbook | migrations, operations docs | Migration classification, rehearsal and lock evidence | Restored-staging rehearsal | Procedure affects future migrations | Medium/high | IN PROGRESS |
| F-013 | Supplier payable is binary; no immutable correction workflow | SupplierPayable schema/API/UI | Product decision, SupplierPayment/Adjustment if approved | Installment/correction/reversal reconciliation | Additive models | High/accounting | DECISION |
| F-014 | Admin revenue cap and repeated currency context fixed; customer trust over-fetch remains | admin stats/page, customer API, currency helper | Finish focused customer trust read model | Query count, >2k shops, mature customer | Possible summary fields/index | Medium | IN PROGRESS |
| F-015 | Olib mobile, shell identity and route resilience incomplete | Olib UI, layouts, route segments | Mobile cards, real server-seeded identity, errors/loaders | 390/768/desktop and failure states | None | Low/medium | OPEN |
| F-016 | Many labels lack programmatic control association | shop/admin forms, UI fields | Accessible shared field primitive and conversions | Axe, keyboard, screen reader | None | Low | OPEN |
| F-017 | Large route/components, repeated domain types, mostly unused api-client | large pages, types, `api-client.ts` | Tested staged extraction and type centralization | Existing behavior plus focused component tests | None | Medium/regression | OPEN |
| F-018 | Request ID and Log.ipAddress are defined but not populated | logger, proxy/API helpers, Log | Correlation propagation and approved privacy policy | One request traced end-to-end | Optional audit metadata migration | Medium/privacy | OPEN |
| F-019 | Five moderate dependency advisories | package/lock | Supported patch upgrades only | Full suite and browser smoke | None | Medium/framework | OPEN |
| F-020 | Open-ended Node major, incomplete env sample, stale comments | package, env docs, schema/docs | Pin Node major, typed env validation, doc cleanup | Fresh CI/bootstrap config tests | None | Low | IN PROGRESS |

## Dependency order

1. Disposable database, CI, artifact-first release and recovery contract.
2. Accounting decisions and P0 return ledger.
3. Native currency/payment history.
4. Bounded query/read-model and notification improvements.
5. Security/database constraints and correlation.
6. UI/accessibility improvements backed by browser coverage.
7. Maintainability and framework/dependency cleanup.

## Global definition of done

Each finding requires the relevant subset of unit, PostgreSQL integration,
migration rehearsal, browser, accessibility, load, preview, production smoke
and monitoring evidence. Production data repairs always remain a separately
approved operation with a dry-run artifact and restorable backup.
