# Mutation-aware navigation cache remediation — 2026-07

> Historical 30-second baseline. The current two-minute incremental architecture is documented in `docs/architecture/incremental-navigation-sync.md`.

## Scope and decision

This change was measured against `4ab1c8c` (the merge commit at the tip of `main` when the work began) and implemented on `codex/mutation-aware-navigation-cache`.

The application now uses Next.js Client Router Cache as a display/navigation optimization. It does **not** cache authentication, mutation responses, stock/payment eligibility, authoritative balances, or PostgreSQL validation. Redis, SWR, React Query, WebSockets, and new runtime dependencies were not added.

Redis would not solve the reported problem: the repeated work was browser RSC navigation, and a Redis hit would still require a network/server round trip. The appropriate layer is the browser Router Cache plus exact invalidation after successful writes.

## Why pages previously reloaded

Next.js 16 defaults `staleTimes.dynamic` to zero. A dynamic page segment therefore issued another RSC request when revisited by normal client navigation. The baseline production trace confirmed repeated `GET /shop/qurilmalar?..._rsc=` and `GET /shop/dashboard?..._rsc=` requests.

Normal viewport prefetching also fetched many low-probability shop routes. The final policy fully prefetches only the high-probability sidebar routes (shop dashboard/devices/nasiyas and admin dashboard/shops), disables sidebar prefetch for low-probability routes, and uses intent-only prefetch for expensive row details.

## Cache policy

- `experimental.staleTimes.dynamic = 30`
- `experimental.staleTimes.static = 30`
- Static was explicitly set after measurement: `prefetch={true}` uses the static bucket, whose five-minute framework default was too long for user-specific operational screens.
- The cache is per browser/session and is never an authorization source.
- Every operational API mutation still validates current PostgreSQL state transactionally.
- Authentication/session revocation remains in `requireApiSession()` and is rechecked by every invalidation/focus Server Action.
- Logout performs a full callback navigation and clears this feature's cross-tab marker.

## Before/after measurement

Both builds were production builds using the same disposable local PostgreSQL dataset. A local request-tracing proxy counted actual RSC requests. The route timing is click-to-URL-commit; it excludes the browser harness's post-click actionability wait.

| Measurement | Before (`4ab1c8c`) | Optimized |
| --- | ---: | ---: |
| Warm device route commit | 31 ms | 21 ms |
| Warm dashboard return commit | 35 ms | 32 ms |
| RSC requests during repeated device → dashboard cycle within 30 s | 2 | 0 |
| General dependencies added | 0 | 0 |

The useful result is the request count: the repeated optimized cycle used the recent Router Cache entries instead of asking the server for both pages again. Timings are local-machine evidence, not a promise for every production network.

## Invalidation design

`src/lib/navigation-cache-policy.ts` is the typed, pure mutation matrix. Clients cannot provide arbitrary paths: dynamic detail paths are constructed only from validated entity IDs. `src/app/actions/navigation-cache.ts` authenticates the caller, enforces shop/admin mutation ownership, revalidates the matrix paths, refreshes the current shell, and returns a server-derived session/tenant scope.

Client workflow:

1. Route Handler completes the PostgreSQL mutation and returns success.
2. The client awaits `invalidateNavigationAfterMutation()`.
3. The Server Action revalidates the affected paths and refreshes the current Router Cache.
4. Only then does `navigateAfterMutation()` call `router.push()`.
5. If the database write succeeded but the invalidation action fails, only that critical transition uses a full document navigation/reload.
6. Failed API writes never call the success invalidation mechanism.

The existing `src/lib/server/cache-tags.ts` tag/path invalidation remains in place. Customer import now also calls the customer server-cache invalidator.

## Mutation matrix

| Mutation kind | Primary invalidated views/domains |
| --- | --- |
| device create/edit/delete | devices list/detail, cash/nasiya stock selectors, dashboard, reports, logs |
| device restock | all device views/selectors, nasiyas, dashboard, reports, logs |
| cash sale create/edit | device list/detail/selectors, customers, dashboard, reports, logs, overdue |
| cash sale payment | device list/detail, customers, dashboard, reports, logs, overdue |
| nasiya create/import/edit | nasiya list/detail/new, device list/detail/selectors, customers, dashboard, reports, logs, overdue |
| nasiya payment | nasiya list/detail, device list/detail, customers, dashboard, reports, logs, overdue banner |
| nasiya reminder | nasiya list/detail, dashboard, logs, overdue |
| return/refund | devices/selectors/detail, nasiya list/detail, dashboard, reports, logs, overdue |
| Olib-sotdim create/payment | Olib-sotdim, device/detail, dashboard, reports, logs |
| customer edit/import | customers, nasiyas, dashboard, reports, logs |
| shop/profile setting | settings, shop layout/dashboard, logs |
| shop/global currency | shop layout and every formatted financial list/report/settings view |
| admin profile | admin dashboard/settings/logs |
| admin shop create/edit/delete/payment/admin | admin dashboard, shops list/detail, payments, report, logs, ops |

## Cross-tab, focus, reconnect, and races

- Successful mutations publish a tenant/session-scoped `BroadcastChannel` message with localStorage fallback.
- The originating tab ignores its own message; sibling tabs deduplicate message IDs and coalesce concurrent refreshes.
- Messages with a different shop/user/session-version scope are ignored.
- A visible tab re-authenticates and refreshes on focus, visibility restoration, or reconnect when its last freshness check is at least 30 seconds old.
- No polling or WebSocket was added.
- Devices, nasiyas, logs, and the stock picker abort stale requests. Customers and Olib-sotdim additionally use request-generation guards, so an older response cannot overwrite a newer query result.

Changes from another physical browser are bounded by the 30-second navigation TTL and focus/reconnect refresh. Display data never authorizes a sale/payment; Route Handlers still validate PostgreSQL.

## Prefetch and list state

- Shop sidebar: dashboard/devices/nasiyas use explicit targeted prefetch; other destinations do not prefetch on viewport visibility.
- Admin sidebar: dashboard/shops use explicit targeted prefetch; other destinations do not.
- Device, nasiya, admin-shop, and dashboard detail links use an 80 ms hover dwell or keyboard-focus/touch intent. Rendering 25 rows no longer prefetches all 25 details.
- Device/nasiya/customer/log/Olib-sotdim search, filter, and page state is written to URL parameters.
- Devices and nasiyas server-render the exact restored query/page. Customers and Olib-sotdim use authenticated server wrappers to seed restored state. Logs receives restored filter state from its server page.
- Native Back navigation therefore restores the exact URL and browser scroll behavior; the client Router Cache preserves recent list payloads when still valid.
- Successfully submitted forms navigate away only after invalidation; no React Activity/global Cache Components migration was enabled, so submitted form state is not intentionally retained.

## Browser acceptance evidence

Disposable dataset flow:

- Device total before: 100000.
- `POST /api/devices`: `201`.
- Invalidation Server Action: 5 ms in the development trace.
- Returned list total: 100001 without manual reload.
- The new `Cache Acceptance Device` was immediately found through the device list's URL-backed search.
- The same device was immediately found in `/shop/sotuv/new` stock search.
- Dashboard device count/value updated to 100001 / `100 001 234 567 so'm`.
- Submitting the same IMEI returned `409`, remained on the form, and displayed the duplicate error; no success invalidation ran.

The synthetic performance seed deliberately assigned later timestamps to its 100000 generated rows, so the newly created row did not sort to the first visual row. Exact search proved the new record was present; production data using normal creation timestamps will sort normally.

Responsive checks passed at 768 px, 375 px, and 320 px with no document-level horizontal overflow. At 375 px the desktop table was hidden and the mobile cards were visible. Filter tabs and pagination now contain their own narrow-screen layout instead of widening the document.

## Quality gates

- ESLint: pass.
- TypeScript: pass.
- Prisma validation: pass.
- Unit/guard tests: 129 files passed, 1245 tests passed, 17 todo; one test file intentionally skipped by the existing suite.
- Disposable PostgreSQL integration: 2 files / 5 tests passed after all 24 migrations were deployed to a reset local database.
- Production build: pass (50 static pages generated; authenticated routes remain dynamic).
- Browser console at 320 px: no errors.
- New cache tests: 18 tests covering TTL/matrix, tenant scope, event ordering, mutation wiring, cross-tab/focus/dedupe, URL state, intent prefetch, logout, and stale-request guards.

## Remaining risks and limits

- Next.js `staleTimes` is experimental. Keep the request-count regression tests/manual trace in release checks when upgrading Next.js.
- Physical-device multi-user changes are not real-time; the bound is TTL plus focus/reconnect. WebSockets are not justified by current requirements or measurements.
- A failed background focus refresh leaves the browser performing a full reload so authentication and current server state win over a cached display.
- Browser testing covered the complete new-device success/duplicate flow; cross-tab delivery is covered by the coordinator/guard tests, not by a simultaneous mutation from two independently authenticated physical browsers.
- No production deployment, environment change, Redis resource, or production-data mutation was performed.
