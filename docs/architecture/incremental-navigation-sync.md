# Incremental navigation and data synchronization

Status: implemented on `codex/incremental-data-sync` in July 2026. This document supersedes the runtime design in `docs/audits/navigation-cache-remediation-2026-07.md`; that file remains the historical 30-second baseline.

## Outcome and boundaries

Authenticated shop and super-admin layouts own one in-memory TanStack Query client. Previously visited list/report data remains available for two minutes and is retained for up to 30 minutes of inactivity. App Router dynamic/static client cache lifetimes are also 120 seconds. Warm views keep their existing content while a background check runs; they do not replace the page with a loading screen.

This is a browser cache plus durable PostgreSQL delta stream. It does not weaken API authorization, lifecycle validation, payment validation, or database transactions. The server and PostgreSQL remain authoritative.

## Browser cache lifecycle

`AuthenticatedQueryProvider` is mounted by both authenticated layouts. Its defaults are:

- `staleTime = 120_000` and `gcTime = 30 minutes`;
- one retry for reads and no automatic mutation retry;
- structural sharing by entity `id`;
- no localStorage/IndexedDB persistence;
- background revalidation without removing existing data;
- complete cache disposal when the authenticated scope unmounts or changes.

Focus, reconnect, visibility, and a visible-only 25-second interval are handled by the single `NavigationCacheCoordinator`. TanStack's independent focus/reconnect refetch is disabled deliberately so these browser events issue one small `/api/sync` request instead of refetching every stale query. This provides the required reconnect/focus freshness with tighter request control.

Logout calls `clearNavigationClientState`, which clears the active QueryClient. Scope keys include role, tenant, and `sessionVersion`; a role, tenant, or session-version change therefore cannot reuse the old cache.

## Query-key rules and first render

All keys are created in `src/lib/query-keys.ts` and start with:

`['oryx', role, tenantId, sessionVersion, domain]`

List keys then include one structured object containing relevant filters, search, page, page size, sort, and report dimensions. Components must not create unrelated ad-hoc roots. The typed device factory also separates list and detail keys.

The first page is rendered by a Server Component and passed as `initialData` under the exact same client key. It is not immediately fetched again. `IncrementalSnapshotBoundary` replays from a cursor captured before the server snapshot query, closing the mutation-between-cursor-and-snapshot race.

## Transactional change-event model

Migration `prisma/migrations/202607120001_incremental_change_events/migration.sql` creates `ChangeEvent` with:

- a PostgreSQL `BIGSERIAL` monotonic sequence;
- scope type/id, domain, entity type/id, operation, mutation kind;
- entity version timestamp and creation timestamp;
- scope/cursor, scope/domain/cursor, and retention indexes.

The event contains identifiers, not customer/device/financial payloads. The authenticated sync endpoint resolves current canonical data after enforcing the session's scope.

All user mutations write their business record and audit `Log` in one Prisma transaction. The migration's `AFTER INSERT` trigger creates the corresponding event inside that same transaction: a rollback removes the business row, audit row, and event together. The trigger covers every audit target used by the navigation mutation matrix. Cron-only overdue transitions have no user audit action, so the cron writes their event explicitly inside the status transaction.

Events are retained for seven days. The daily reminders cron performs bounded age cleanup. If a nonzero cursor predates the oldest retained global stream position, `/api/sync` returns `resetRequired`; the browser clears authenticated query data and performs the exceptional full server refresh.

## Cursor and delta lifecycle

`GET /api/sync?cursor=<decimal>&domains=<optional-list>&limit=<optional>`:

- authenticates with `requireApiSession` and derives scope only from the session;
- allows shop admins to read their own shop stream plus non-tenant global currency events;
- allows super admins to read global and their own admin stream;
- uses `private, no-store` and `Vary: Cookie`;
- caps a batch at 100 events, returns `hasMore`, and coalesces repeated entity changes;
- resolves related device IDs in fixed bulk queries, avoiding per-event queries;
- returns string cursors, canonical device upserts, deletion tombstones, and targeted aggregate/list invalidations;
- logs duration, counts, reset state, and serialized response bytes without PII.

A no-change response contains only the cursor and empty arrays (unit-guarded below 1 KB). Polling pauses in hidden tabs, maintains one in-flight request, drains batches, aborts obsolete work, and exponentially backs off to 120 seconds on temporary network failures while leaving stale UI intact.

BroadcastChannel is the same-browser wake-up path. localStorage holds only a small event notification fallback, never business data. Another browser/device discovers committed changes on the next visible poll (normally within 25 seconds), or immediately on focus/reconnect/visibility restoration.

## Mutation and patch matrix

| Mutation/entity | Precise browser action | Targeted fallback/invalidation |
| --- | --- | --- |
| Device create/update | Patch every cached device list whose search/status membership can be proven; maintain sort, first-page boundary, and total | Refill only an affected active page when a row moves out or a later page shifts |
| Device delete | Apply an idempotent tombstone and decrement containing-list totals | Refill only the affected active list |
| Sale/payment/nasiya/return/supplier payable | Resolve and patch the related canonical device/status | Revalidate only affected sales, nasiya, payment, customer, report, log, overdue, or Olib-sotdim query roots |
| Customer/reminder/settings/currency | Keep current UI visible | Revalidate only mapped active domain roots; currency deliberately has broad domain impact |
| Admin shop/admin/payment changes | Keep current UI visible | Revalidate only admin shop/payment/report/log/ops roots |
| Cursor gap/session or permission change | Cache cannot be proven complete | Clear authenticated cache and perform the exceptional server refresh/auth flow |

For non-device paginated datasets the server does not yet return enough canonical membership data to patch every filtered page safely. The correctness fallback is a targeted active query refetch with `keepPreviousData`; it is not a page/RSC refresh. Device rows use the full entity-level path. Optimistic insertion is intentionally not used for device creation because the server owns its ID, timestamp, canonical display data, and stock validation; the confirmed canonical row is patched immediately after the response.

## Server cache matrix

`src/lib/navigation-cache-policy.ts` is the domain impact matrix shared by browser mutation handling. `src/lib/server/cache-tags.ts` is the server-side tag invalidation authority for cached aggregates. Broad `revalidatePath` calls were removed after the production-build browser trace proved that they evicted multiple warm Router Cache entries and caused unrelated RSC prefetch traffic. Client-backed detail pages fetch their authenticated detail API when mounted. Route handlers perform server tag invalidation; the browser no longer invokes a second invalidating Server Action.

Ordinary successful mutations must not call `router.refresh()` or `window.location.reload()`. The only permitted full-reset paths are authentication/permission failure and an expired cursor gap.

## Privacy and tenant isolation

- Client input never selects a shop scope for synchronization.
- Every query key includes authenticated tenant and session scope.
- Query data is memory-only and cleared on scope disposal/logout.
- Change events hold no business payload.
- Shop admins receive only their shop events and globally safe currency changes.
- Cross-tab messages include scope and source identifiers and are ignored across scopes.
- Sync telemetry contains timing/count/size fields only.

## Why Redis is not used

Redis would not preserve App Router browser state or prevent React list rerenders. TanStack Query solves repeat navigation; entity patching solves local mutations; PostgreSQL's transactional event stream solves durable cross-user/device correctness; BroadcastChannel wakes sibling tabs; `/api/sync` transfers deltas; existing Next tags cover server computations.

Reconsider a shared server cache only if production traces show sustained database read pressure, expensive identical computations repeated across Vercel instances, or high server-cache miss rates after this architecture is live. Any future cache needs tenant-safe keys, bounded TTL/size, explicit mutation invalidation, and measured benefit.

## Operations, rollback, and metrics

Monitor structured `sync.bootstrap`, `sync.delta`, and `sync.failed` logs for duration, response bytes, event counts, batch draining, and resets. Also monitor PostgreSQL query latency, event table size/oldest timestamp, cron cleanup count, Vercel function errors, browser request count, and mutation-to-visible-row latency. Never add PII to these logs.

The release is migration-sensitive. Use `.github/workflows/release-production.yml`: build the immutable production artifact, apply the reviewed backward-compatible migration with `prisma migrate deploy`, then deploy that exact prebuilt artifact. `vercel.json` intentionally never migrates during a build.

Rollback procedure:

1. Stop promotion if migration rehearsal, integration tests, or preview build fails.
2. If code is deployed but unhealthy, promote the prior known-good artifact. The additive `ChangeEvent` table/trigger is backward-compatible with the old application.
3. Do not drop the table/trigger during an incident; disable the coordinator or roll back code first.
4. If event creation adds unacceptable load, remove/disable the trigger only through a reviewed forward migration after confirming the old code is live.
5. Verify `/api/health`, database migration state, sync error rate, and recent production logs after promotion.

## Verification and known limits

Automated coverage includes query-scope isolation, filtered device membership/patching, pagination boundaries, structural identity, idempotent tombstones, cursor parsing, response size, event coalescing, all migrations from empty PostgreSQL, transactional commit/rollback, tenant separation, deletion ordering, and concurrent cursor uniqueness.

Production-build verification against a disposable PostgreSQL demo dataset recorded:

- no-change delta: 134 serialized bytes and roughly 4–31 ms locally;
- one newly created device delta: 693–699 serialized bytes with one canonical upsert;
- database work is a fixed 2 queries for a normal no-change sync, 3 for a direct device delta, and at most 6 for a mixed 100-event batch (event page plus three relation batches plus one canonical device batch); reset detection uses 3;
- warm return to the device list: zero document requests and zero full-list API/RSC requests (only the independent tiny sync check when due);
- confirmed device creation after removing path invalidation: one `POST /api/devices`, sync/replay requests only, zero document requests, zero list API requests, and zero RSC requests;
- the confirmed row appeared first immediately after navigation;
- memoized desktop rows/mobile cards receive structurally shared entity objects, so unchanged device components are eligible to skip rerender.

Final local gates: 130 unit/guard test files passed with 1 intentionally skipped file, 1,255 tests passed and 17 todo; 12 PostgreSQL integration tests passed after all 25 migrations were applied from an empty schema; ESLint, TypeScript, Prisma format/validation, diff whitespace checks, and the optimized Next production build passed.

The historical 30-second implementation baseline in `docs/audits/navigation-cache-remediation-2026-07.md` recorded two repeated RSC requests on warm navigation. The same production-build trace after this change recorded none for the warm device return.

Remaining limits to state honestly:

- non-device lists use precise domain refetch rather than canonical per-row deltas;
- cross-device freshness is polling-bound, not websocket real time;
- a seven-day/offline cursor gap intentionally performs a complete reset;
- exact per-component production render counts, 30-minute memory behavior, and live multi-user timing must be measured in production observability rather than inferred from local minified React profiles;
- Next `staleTimes` remains experimental and must be regression-tested on Next upgrades.
