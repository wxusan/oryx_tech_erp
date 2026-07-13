# Production remediation matrix

Baseline: `e818f1b47cf5a74ce4f7ccc3dbb600163078a6a7` on 2026-07-12.

This is the current status document. Earlier audit and follow-up documents are
point-in-time evidence and are not silently rewritten when a finding changes.

Status meanings:

- `OPEN`: confirmed work has not started or remains materially incomplete.
- `DECISION`: product/accounting approval is required before implementation.
- `VERIFY`: implementation exists, but a stated browser, restored-data, CI, or
  production proof is still missing.
- `DONE`: the finding's stated implementation and acceptance evidence passed.

No row moves to `DONE` because it compiles or passes a source guard alone.

## Current findings

| Finding | Implemented state and evidence | Remaining proof or action | Status |
|---|---|---|---|
| F-001 — immutable return/refund accounting | `prisma/migrations/202607130001_immutable_return_ledger`, `prisma/schema.prisma`, `src/lib/return-accounting.ts`, and `src/app/api/devices/[id]/return/route.ts` preserve original contracts/payments, freeze contract and UZS disposition values, allocate refunds to original receipts, cancel debt explicitly, restock atomically, and retry serialization/deadlock failures. Pure tests plus real PostgreSQL Sale/Nasiya/zero-refund/method/race tests pass. | Guarded production migration, live smoke, and separately approved historic-data review. A future correction would require a compensating-adjustment design; completed returns are not editable. | VERIFY |
| F-002 — password and distributed throttling | Central password policy, login/source throttling, and `src/lib/rate-limit-adapter.ts` support either complete explicit Upstash variables or the Vercel Marketplace `KV_*` pair with bounded local fallback. Unit and route guards pass. | Provision a production Upstash resource if multi-instance enforcement is required, then prove shared-window behavior and failover. Production currently has no Redis/Upstash variables. | VERIFY |
| F-003 — native contract currency | Sale, Nasiya, devices, reminders, stats, details, CSV, and XLSX use frozen native contract values with clearly labelled UZS snapshots. The final 73-test PostgreSQL run proves frozen USD device/Sale/Nasiya exports and XLSX generation. | Preview/production UI-export smoke and historic drift review. | VERIFY |
| F-004 — bounded device selection | Device/Olib selection paths use server search and bounded pagination instead of relying on a first-200 stock snapshot; paging/search guards cover the wiring. | Preview browser behavior and a production-shaped last-record lookup measurement. | VERIFY |
| F-005 — bounded derived status/stats | `src/lib/server/shop-stats-queries.ts`, `src/lib/server/shop-lists.ts`, the shared formula policy, due/overdue API, and bounded hydration keep full-set aggregation and derived list filtering in PostgreSQL. The final 73-test PostgreSQL run covers currency boundaries and cancelled/delayed/no-schedule cases, including an ACTIVE parent whose only schedule is CANCELLED. The final-tree 100,000-obligation benchmark kept every measured path below 92 ms median and returned bounded rows. | Capture Vercel/database/browser timings and production-like concurrent load. | VERIFY |
| F-006 — notification backlog and queue health | `src/lib/notification-service.ts` implements bounded batched claiming/draining, retry/dedupe/crash handling, and multi-image progress. Admin ops exposes actionable queue count and oldest actionable age. Unit, Telegram HTTP integration, reminder integration, and ops guards pass. | Configure external alert delivery/ownership and verify the real production backlog after release. | VERIFY |
| F-007 — safe release path and CI | `.github/workflows/ci.yml`, `.github/workflows/release-production.yml`, `scripts/vercel-build.mjs`, the count-only preflight, and the runbook implement artifact-first build, guarded migration, and post-migration proof. Release accepts only the exact green `main` push SHA, authenticates to the protected unaliased Vercel artifact, validates database health and commit, rechecks remote `main`, then promotes. The 30-to-36 migration sequence was rehearsed on a disposable database. GitHub `production` now requires named owner review and permits only `main`. | Commit/push the exact tree; pass GitHub CI and preview; confirm backup/PITR; run the reviewed production workflow and smoke. | VERIFY |
| F-008 — executable database integration tests | The TODO-only inventory was removed. `tests/integration/` now exercises real PostgreSQL invariants, routes, tenancy, races, reminders, Telegram HTTP, retention, trust aggregation, exports, and set-based stats/list derivation. On 2026-07-13 all 36 migrations applied from empty and 73/73 integration tests passed. | Keep CI green on the published commit. This finding's previously missing executable suite is closed. | DONE |
| F-009 — operations/recovery | Admin ops, structured operational events, queue age, data-retention code, and `docs/operations/recovery-and-release-runbook.md` now define release, recovery, repair, and smoke procedures. | Assign incident/backup/release owners, approve RPO/RTO, configure alert recipients, and execute a timed restored-staging drill. | VERIFY |
| F-010 — enforcing CSP | `src/proxy.ts` generates per-request nonces and an enforcing CSP; `next.config.ts` supplies the remaining security headers. Header/proxy tests pass. | Verify hydration, dialogs, signed images, navigation, and browser console on the exact preview and production artifacts. Styles still require the documented `unsafe-inline` exception. | VERIFY |
| F-011 — database tenant/integrity constraints | `202607130002_financial_invariants` adds reviewed financial/tenant constraints and real PostgreSQL tests reject cross-shop and invalid states. | Run production preflight, review historic candidates, and validate staged `NOT VALID` constraints only after approved cleanup. | VERIFY |
| F-012 — online migration practice | The runbook classifies the guarded sequence; preflight is read-only/count-only; environment precedence is protected. On 2026-07-13 a disposable clone matching exact old `main` (`2eeae5d`, 30 migrations) passed preflight, all six release migrations applied, and postflight proved 6/6 recorded with zero blockers. The rehearsal deliberately surfaced one pre-existing Nasiya reconciliation candidate as review-only data rather than mutating it. | Repeat against a restored production-like staging copy, record lock/runtime evidence and stop conditions, review historic candidates separately, and confirm PITR immediately before release. | VERIFY |
| F-013 — supplier-payable accounting | Current `SupplierPayable` behavior remains intentionally binary (`PENDING/OVERDUE` to `PAID`, never `CANCELLED` to `PAID`) and is integration-tested. | Product/accounting owner must decide whether partial supplier payments, corrections, and reversals are required. Do not invent a ledger without that decision. | DECISION |
| F-014 — bounded admin/trust reads | Set-based admin stats and `src/lib/server/customer-trust-queries.ts` return bounded aggregates for already-paginated customers. A real PostgreSQL parity test proves the aggregate matches the established trust policy across early/on-time/late/overdue/delayed/cancelled histories. | Preview and production latency/query telemetry with production-shaped tenant distribution. | VERIFY |
| F-015 — UI resilience and identity | Admin reporting/payment surfaces, Olib mobile cards, real shop identity, loading/error copy, and responsive layouts have implementation and component/source coverage. | Real 390px, 768px, and desktop preview checks including failed/empty/loading states. | VERIFY |
| F-016 — accessibility | `src/components/ui/field.tsx` now provides native label/control association, required state, described help/error text, invalid state, and first-error focus. Page-level forms use explicit `htmlFor` associations or `fieldset`/`legend`; file inputs, date and money fields, choice groups, and schedule tables have accessible names and state. `tests/field.component.test.tsx`, `tests/accessibility-forms.guard.test.ts`, and `tests/accessibility-components.test.tsx` pass. | Run axe, full keyboard/focus traversal, and screen-reader checks on the exact preview at mobile, tablet, and desktop widths. | VERIFY |
| F-017 — maintainability | Shared domain unions live in `src/lib/domain-types.ts`; typed labels live in `src/lib/labels.ts`; repeated shop status rendering uses `src/components/admin/shop-status-badge.tsx`; the unused generic API shell and status badge were removed; and the named device, admin-shop, Nasiya, Olib/device-image, and settings responsibilities were extracted into focused components. Unit, source-guard, lint, typecheck, and build evidence pass. | Verify the extracted interactions on preview and continue staged decomposition only where runtime evidence identifies a concrete maintenance or performance problem. | VERIFY |
| F-018 — request correlation/privacy | Proxy overwrites client correlation input with `x-vercel-id` or a server UUID. Async request context enriches structured logs; Prisma extensions attach it to every business Log and OpsEvent, including transactions. `Log.ipAddress` stores only a secret-scoped HMAC network fingerprint, never raw IP. Unit and PostgreSQL end-to-end persistence tests cover the chain, and the retention policy is documented. | Verify the response/runtime/database correlation on the exact Vercel preview and production artifact; approve any external log-drain retention separately. | VERIFY |
| F-019 — upstream dependency advisories | The final local `npm audit` reports 0 critical, 0 high, and 6 moderate package entries: `@hono/node-server`/`@prisma/dev` through Prisma, `postcss` through Next.js, and their direct parent entries `prisma`, `next`, and `next-auth`. The offered force fixes are unsafe framework/ORM/auth downgrades (`next@9.3.3`, `prisma@6.19.3`, and `next-auth@3.29.10`), not supported forward upgrades. | Monitor supported Next.js/Prisma/Auth.js releases that update the affected transitives; re-run the audit in CI/release evidence and do not apply the reported force downgrades. | OPEN |
| F-020 — runtime/configuration/documentation | Node 24 is pinned in engines, `.nvmrc`, `.node-version`, CI and release; CI/release install declared `npm@10.9.4`; Node types match runtime major. Production environment validation is executable and does not print secrets; Prisma configuration preserves explicitly exported database URLs; release/rate-limit/cache docs are updated. Behavioral configuration tests pass. | Prove a fresh GitHub CI bootstrap and production environment validation on the exact deployed commit. | VERIFY |

## Release blockers for the current branch

1. Review and commit the entire dirty worktree as one intentional scope.
2. Pass GitHub CI and authenticated preview browser verification.
3. Confirm backup/PITR ownership and run the guarded production release.
4. Review preflight counts; do not combine historic financial repair with the
   schema release.
5. Verify Vercel deployment, migrations, operations, and read-only production
   flows before claiming the remediation is online.

## Global definition of done

Each finding requires its relevant unit, PostgreSQL integration, migration,
browser, accessibility, load, preview, production, and monitoring evidence.
Production data repairs always remain a separately approved operation with a
dry-run artifact and restorable backup.
