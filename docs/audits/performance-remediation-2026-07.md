# Performance remediation — July 2026

This report covers the measured performance work on branch
`codex/full-production-remediation`. Production was not queried, mutated, or
deployed. Database tests used the disposable local PostgreSQL database
`oryx_perf_test` with all 24 checked-in migrations and 100,000 synthetic
in-stock devices.

## Executive result

The highest-confidence bottlenecks were fixed without adding a general Redis
cache. The sale/nasiya stock selector is now a bounded, debounced server search;
the persistent debt banner no longer polls every minute; notification delivery
uses bounded concurrency; repeated Supabase bucket checks are coalesced; the
admin identity is server-seeded; and admin/shop routes have loading/error
feedback.

No claim is made that every route is fully optimized. The remaining section
lists the database and background paths that still require a dedicated pass.

## Before/after evidence

| Flow | Before | Now | Evidence |
|---|---|---|---|
| Sale/nasiya device picker | One request loaded up to 200 devices; subsequent inventory was unavailable; the general projection also included fields the picker did not need | 25-row pages, 50-row API ceiling, server search, 250 ms debounce, stale-request cancellation, load-more, and explicit loading/error/empty states | `src/components/shop/in-stock-device-picker.tsx`, `src/app/api/devices/route.ts` |
| Selector initial query at 100k devices | No dedicated selector query | 0.129 ms execution, four shared buffer hits, backward scan on `Device_shopId_status_createdAt_idx` | Local `EXPLAIN (ANALYZE, BUFFERS)` |
| Selector representative JSON | 200 rows / 45,884 bytes (old projection approximation, before API envelope) | 25 rows / 4,069 bytes | Local PostgreSQL `json_agg` comparison; 91.1% smaller |
| Selective model/IMEI search at 100k | Not measurable as a correct full-inventory flow because only the first 200 rows were in the browser | 6.299 ms using trigram bitmap indexes | Local `EXPLAIN (ANALYZE, BUFFERS)` for `99999` |
| Broad model/IMEI/color/storage search at 100k | Same correctness limit | 71.089 ms locally for the representative `99999` search | Local `EXPLAIN (ANALYZE, BUFFERS)`; this is the current search ceiling |
| Device beyond first 200 | Could not be selected unless it happened to be in the first response | Browser search found `Model 99999` as the single result | Authenticated local browser verification |
| Warm selector API at 100k | Not available as a correct bounded selector flow | 52 ms total / 49 ms application code for the initial 25 rows; 35 ms total / 31 ms application code for `99999` search | Next dev request timing after route compilation |
| Due/overdue banner | One request every 60 seconds for every open shop session | Immediate refresh after local financial mutations, focus/reconnect/visibility refresh, five-minute fallback | `src/components/shop/due-overdue-banner.tsx`, `src/lib/client-events.ts` |
| Idle banner polling | 60 requests/hour/session | 12 requests/hour/session | Exact interval comparison; 80% reduction |
| Admin identity | Client rendered `Admin`, then called `/api/auth/session` and updated after hydration | Server validates SUPER_ADMIN and passes the authenticated name into a narrow client shell | `src/app/(admin)/layout.tsx`, `admin-layout-client.tsx`; one request and identity flash removed |
| Notification drain | Up to 100 Telegram deliveries ran sequentially | Five concurrent deliveries per wave; atomic claim/retry/recovery retained | `src/lib/notification-service.ts` |
| Multi-admin broadcast | Every queued recipient could start a competing queue drain | Recipients are persisted first, then one drain runs | `queueNotification(..., { processImmediately: false })` |
| Private bucket readiness | Both upload routes called `listBuckets()` on every upload | Concurrent cold checks share one promise; successful readiness is reused for ten minutes per warm instance | `src/lib/server/private-storage-bucket.ts` |
| Supabase admin client | New client object per call | Lazy per-instance singleton | `src/lib/supabase-admin.ts` |
| Route waiting/failure UX | Five loading files and no segment error files | Shared accessible skeleton/retry UI, admin loading boundary, admin/shop error boundaries | `src/components/route-loading.tsx`, `route-error.tsx` |
| 320 px shop shell | Page-level horizontal overflow during browser verification | No document-level horizontal overflow after `min-w-0`/responsive header fix | Authenticated browser check at 320×700 |

## Cache inventory

| Cache/memoization | Scope/key | TTL | Invalidation | Stale-data risk | Fallback |
|---|---|---:|---|---|---|
| `getShopCurrencyContext` React request memoization (pre-existing) | One server render, `shopId` argument | Request | Ends with request | None across requests | Fresh DB/rate-layer read |
| Shop stats `unstable_cache` (pre-existing) | Shop, role, month, admin | 15 seconds | Shop-scoped mutation tags, immediate expiry | Short-lived dashboard display only; mutations invalidate | Fresh aggregate query |
| Private storage bucket readiness | One warm function instance and configured private bucket | 10 minutes | TTL; failed checks are not retained | An out-of-band bucket change can take up to ten minutes to be rechecked | Upload failure surfaces; next check retries |
| Supabase admin client | One warm function instance | Instance lifetime | Instance recycle | Configuration does not change inside an instance | Lazy recreate on new instance |

Authorization/session revocation, stock approval, payment eligibility, debt
balances, search results, and mutation responses remain uncached.

## Redis decision

**Decision: defer general Redis data caching.**

- The proven selector bottleneck was query shape and pagination, not repeated
  cacheable reads.
- PostgreSQL serves the 100k initial selector page in 0.129 ms locally and a
  selective indexed search in 6.299 ms; a remote Redis hop would not improve
  these source-of-truth reads safely.
- Financial and inventory decisions require transactionally current PostgreSQL
  state and are poor cache candidates.
- Existing Next.js shop-stat caching already has shop-scoped keys and mutation
  invalidation.

Upstash Redis remains appropriate only for distributed rate limiting. The
adapter already exists and is enabled by setting
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`; no production variables
were changed in this work. Reconsider a general Redis cache only after Vercel
P95 traces prove a high-repeat, low-staleness database read dominates latency
and an exact invalidation plan exists.

## Quality gates

- Baseline: 1,211 tests passed, 17 todo; TypeScript passed.
- After: 1,227 tests passed, 17 todo; 127 files passed and one file skipped.
- Disposable PostgreSQL integration: all 24 migrations applied; five
  integration tests passed.
- ESLint: passed.
- TypeScript: passed.
- Prisma generation/production build: passed on Next.js 16.2.9.
- Browser: login, authenticated dashboard, 100k-device first page, search for
  device 99,999, loading completion, error-overlay check, console warning/error
  check, and 320 px overflow check passed.
- Built-in Next.js route/module analyzer completed successfully; its local
  diagnostics artifact was 13 MB. This establishes the current route graph,
  but there is no honest before/after byte claim because no pre-change analyzer
  artifact was captured.
- No Vercel deployment or live-production Web Vitals were performed.

## Remaining performance risks

These were confirmed in the source audit but not changed because correctness
requires a separate design/test pass:

1. Status-filtered nasiya lists still derive status across all matching
   contracts/schedules before slicing. The database predicate must exactly
   reproduce native-currency completion tolerances and delayed due dates.
2. Customer list trust badges still load each paginated customer's complete
   nasiya/schedule history. A SQL aggregate must first prove byte-for-byte tier
   equivalence with `computeCustomerTrustRating`.
3. Shop dashboard still loads all relevant open schedules and unpaid sales to
   compute contract-currency current-state totals. Moving this to SQL requires
   exact USD/UZS tolerance and current-rate equivalence tests.
4. Reminder cron still executes nine candidate scans and many notification
   upserts. Queue sending is faster now, but candidate production and cron P95
   need Vercel traces.
5. XLSX exports remain intentionally capped at 5,000 and materialize a workbook
   buffer. Very large exports need an asynchronous job/object-storage design;
   the cap must not simply be removed.
6. Route-level JavaScript bytes, hydration time, LCP, INP, and CLS require a
   deployed preview plus Vercel Speed Insights/Observability. A successful
   local build is not production Web Vitals evidence.
7. Broad color/storage substring search used a parallel sequential scan in the
   100k synthetic case (71.089 ms locally). If production P95 becomes high,
   evaluate a single indexed search-document column or a two-stage search,
   using production-like cardinality in staging.

## Production observability and rollout

Before promotion, capture preview and production P50/P95 for `/api/devices`,
shop/admin dashboards, `/api/stats/due-overdue`, upload POSTs, notification
drain duration, backlog age, function memory, LCP, INP, and CLS. Alert when the
oldest pending notification exceeds five minutes, cron duration exceeds 45
seconds, or a common list API P95 exceeds 500 ms.

Roll out normally through a preview deployment and authenticated smoke test.
There is no schema migration in this performance change. Rollback is the code
deployment rollback; no data rollback is required. Enabling Upstash rate
limiting or changing production environment variables remains a separate
approval step.
