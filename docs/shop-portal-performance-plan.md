# Shop portal performance and loading-feedback plan

Date: 2026-07-16

Scope: shop owner and shop staff portals

Production baseline measured: `75a15fb`
Current `main` at audit handoff: `d77b09d`

## Outcome

The portal should feel responsive even when fresh data is still arriving, and
the expensive paths should be made genuinely faster. The work therefore has
two equal tracks:

1. reduce route, tab, search, modal, and mutation latency;
2. show immediate, accessible feedback for every operation that is not
   effectively instant.

This is not a spinner-only project. Production measurements reproduced real
backend and navigation delays:

- Qurilmalar cold load: about 5.4 seconds;
- Qurilmalar tab switch: about 3.1 seconds;
- Sotuvlar shell: about 4.4 seconds, with rows still loading five seconds
  later (more than nine seconds to a usable list in the observed run);
- To'lovlar cold load: about 4.8 seconds;
- Nasiyalar cold load: about 12.2 seconds;
- Nasiya payment dialog shell: about 281 ms, but its operation context was
  still loading after five seconds.

No browser console errors were observed. Production runtime logs did not
provide request-duration evidence, so instrumentation is part of phase 0.

## Performance budgets

Measure owner and staff separately and report p50, p75, and p95. A change is
complete only when it meets the relevant budget on a production-shaped data
set and a throttled mobile connection.

| Interaction | Feedback budget | Data-ready target |
| --- | ---: | ---: |
| Sidebar route click | visible pending state <= 100 ms | warm p75 <= 800 ms, p95 <= 1.5 s |
| Cold list route | page skeleton <= 150 ms | p75 <= 1.5 s, p95 <= 2.5 s |
| Tab switch | selected tab + busy state <= 100 ms | cached <= 150 ms; uncached p75 <= 700 ms, p95 <= 1.2 s |
| Live search | input remains instant | request starts 250-300 ms after last key; p75 <= 700 ms after debounce |
| Payment modal | shell <= 100 ms | prefetched context <= 200 ms; cold p95 <= 1 s |
| Save/create/payment | button pending <= 100 ms | one request only; operation-specific server budget |

The first instrumented baseline may adjust the data-ready targets, but never
the immediate-feedback budgets.

## Root causes found

### 1. Repeated authorization floor

Every list/search API request performs live authentication, session lookup,
shop-admin lookup, and package/permission lookup before the business query.
These checks protect live revocation and tenant boundaries, so they must not be
removed. They should be combined or safely parallelized in
`src/lib/api-auth.ts` and `src/lib/server/shop-access.ts`.

### 2. Client-only first-load waterfalls

Sotuvlar, Mijozlar, Xodimlar, and Settings render the route and only then fetch
their first useful data from the browser. This creates:

`route/auth -> JS/hydration -> API/auth again -> business query -> render`

Each should server-render a bounded first page/DTO and seed the exact client
query key, as Qurilmalar and Nasiyalar already do.

### 3. Invisible background refetches

Qurilmalar, Nasiyalar, Mijozlar, and Logs retain old rows with
`keepPreviousData`, but their loading UI generally checks only
`isPending && !data`. During a tab/search/page refetch, `isFetching` is true
while no feedback is shown. This is the main reason the interface appears
frozen.

### 4. Full server navigations for local tab changes

To'lovlar cohort tabs and some profile sections are links that rerun the whole
server page. Convert list-like tabs to client query state, preserve the URL,
retain previous rows, and prefetch likely next tabs.

### 5. Expensive query shapes

- Sotuvlar starts from Device, runs the broad device search, fetches the latest
  Sale, exact-counts, caps at 50, and then filters in the browser. It needs a
  dedicated paginated Sale query.
- Device search has a wide OR across device, IMEI, supplier, sale customer, and
  Nasiya customer relations. Some OR branches do not have matching search
  indexes.
- Nasiya cohort tabs aggregate schedules across the active contract set before
  pagination.
- To'lovlar repeats an aggregate CTE and exact window count for each cohort
  navigation.
- Mijozlar calculates a second trust aggregate after the customer list/count.
- Logs runs list/count, then actor enrichment and target-link resolution.
- Currency refresh can synchronously wait on an external CBU request with no
  hard timeout when the stored rate is old.

### 6. Navigation is deliberately not prefetched

The sidebar sets `prefetch: false` for Sotuvlar, To'lovlar, Mijozlar, Loglar,
Xodimlar, and Sozlamalar. Prefetch should be restored selectively after each
destination has a bounded initial query and a safe skeleton.

## Phase 0 - measurement and guardrails

1. Add privacy-safe timing spans around:
   - authentication/session lookup;
   - permission/package lookup;
   - database query;
   - DTO derivation/serialization;
   - external currency refresh;
   - Nasiya payment transaction phases.
2. Emit `Server-Timing` for internal testing and structured duration logs for
   Vercel. Never log search terms, customer data, passport data, tokens, or
   connection details.
3. Add browser marks for click/input -> pending feedback -> settled data.
4. Confirm Vercel function region, database region, and effective pool size.
   Current code defaults to a pool of five; do not assume a region or pool
   problem without measurements.
5. Build one repeatable owner/staff benchmark covering all reported routes,
   tabs, searches, and the Nasiya payment dialog.
6. Capture `EXPLAIN (ANALYZE, BUFFERS)` on production-shaped restored data for
   Device search/count, Sale list/search, Nasiya cohorts, receivables, customer
   search/trust, and logs.

Deliverable: before-report with p50/p75/p95, query counts, query plans, and the
top three contributors per slow interaction.

## Phase 1 - immediate feedback everywhere

### Route feedback

1. Add a generic `src/app/(shop)/shop/loading.tsx` using
   `src/components/route-loading.tsx`.
2. Keep page-shaped overrides for Dashboard, Qurilmalar, Nasiyalar, Logs, and
   Hisobot.
3. Add page-shaped loaders for Sotuvlar, To'lovlar, Mijozlar, Xodimlar, and
   Settings first; then cover secondary operational routes.
4. Make all loaders accessible with `role="status"`, `aria-live="polite"`, and
   a meaningful label.
5. Add route-link pending feedback using Next.js `useLinkStatus`, with a fixed
   layout so navigation does not shift the sidebar.

### List/tab/search feedback

Create a shared `QueryActivity` pattern:

- keep previous rows visible;
- show a small progress bar/spinner when `isFetching`;
- mark the results container `aria-busy`;
- update the selected tab immediately;
- do not replace the whole table with a blank screen;
- expose retry on error;
- distinguish initial skeleton from background refresh.

Apply it to Qurilmalar, Nasiyalar, Mijozlar, Logs, Sotuvlar, To'lovlar, Olib
sotdim, and action/return queues.

### Every save/create/payment button

Create a shared `AsyncButton` or `LoadingButton` on top of the existing Button:

- `pending` and `pendingLabel`;
- animated spinner;
- `disabled={disabled || pending}`;
- `aria-busy`;
- stable icon/label width;
- one-submit protection;
- all existing variants and sizes.

Adopt it for every async action, including:

- device create/edit/delete/restock/return;
- sale create/edit/payment;
- Nasiya create/edit/payment/defer/reminder/archive/write-off/reopen;
- customer create/edit/passport upload;
- staff create/edit/password/status/delete/permissions/notifications;
- settings/profile saves;
- Olib sotdim create/payment;
- imports and exports where a request is involved.

Financial mutations must not optimistically invent balances. Show pending
feedback immediately, then update from the confirmed server response.

## Phase 2 - search and list architecture

### Sotuvlar

1. Replace the Device action-picker backend with a dedicated paginated Sales
   endpoint/query that starts from Sale and joins only the needed Device and
   Customer fields.
2. Filter `deletedAt`/`returnedAt`, order by Sale creation date, and use a
   bounded `take + 1`/`hasNext` strategy unless the exact total is genuinely
   needed.
3. Server-render the first page and seed the exact authenticated query key.
4. Replace `committedSearch` and the Qidirish button with 250-300 ms debounced,
   abortable live search.
5. Retain previous rows and show `isFetching` feedback.
6. Add real pagination; never silently cap the visible sales set at 50.

### Mijozlar

1. Server-render the bounded unfiltered first page and seed the exact query.
2. Remove the Qidirish button and search after a 250-300 ms debounce.
3. Keep sensitive search in the POST body. Never place passport/name/phone
   search text in the URL, browser history, query key, or logs.
4. Abort stale requests and use a revision-only privacy-safe query key.
5. Measure the customer-trust aggregate. If it dominates, load badge data
   separately or maintain a summary; do not block first paint on it.

### Qurilmalar

Live search and client tabs already exist. Improve them by:

1. showing background-fetch feedback;
2. prefetching likely tab queries on hover/focus/touch;
3. measuring the broad OR search and exact count;
4. adding only evidence-backed missing indexes or replacing the OR with a
   candidate UNION/search-document strategy;
5. adding an active tenant/created-date index if the plan confirms the sort is
   scanning;
6. converting staff action-queue search to the same live-search behavior.

### Nasiyalar

Live search already exists. Improve it by:

1. showing background-fetch feedback and immediately selected tabs;
2. prefetching adjacent/high-frequency tab queries;
3. after the ledger-enforcement migration is safely live, using parent status
   for terminal cohorts and starting due cohorts from open schedules/effective
   due dates so the partial index can serve the query;
4. preserving the incremental snapshot/cursor correctness boundary;
5. measuring before changing schedule aggregation or exact count behavior.

### Logs

1. Parse filters before the server query and seed the exact filtered client
   key; do not fetch an unfiltered initial page and then immediately refetch.
2. Show `isFetching` feedback for categories/search/pages.
3. Measure actor enrichment and target-link resolution; consolidate fixed
   follow-up queries or denormalize safe display/route snapshots if needed.
4. Consider `take + 1`/`hasNext` or cached counts for large histories.

## Phase 3 - tabs, settings, staff, and payment modal

### To'lovlar

1. Convert cohort and pagination links into client query state backed by
   `/api/receivables` and reflected in the URL without a full RSC navigation.
2. Seed the initial cohort, keep previous rows, and prefetch the other cohort.
3. Push the cohort predicate into the source query.
4. Align the open-schedule predicate with the partial index only if the ledger
   semantics agree; validate with EXPLAIN and integration tests.
5. Reconsider `count(*) OVER()` on the critical path.

### Xodimlar

1. Server-render a permission-scoped roster DTO and seed the staff query.
2. Avoid the route -> hydration -> API authorization waterfall.
3. Standardize delete/status/password pending feedback with AsyncButton.
4. Test owner and restricted staff views separately.

### Settings

1. Split the 692-line all-client page into a server page and smaller client
   sections.
2. Fetch one permission-scoped initial settings DTO with parallel helpers.
3. Reuse currency/shop data already available in the authenticated layout.
4. Seed the query cache so revisits do not always refetch.
5. Give each section its own skeleton, error/retry, dirty-state, and pending
   save button.

### Nasiya payment/defer modal

1. Extract shared operation-context query options.
2. Prefetch context for visible rows on payment-button hover, focus, touch, or
   pointer-down.
3. Open the dialog shell immediately.
4. Replace plain `Yuklanmoqda...` with schedule-shaped skeletons and an
   accessible status.
5. Use AsyncButton with `To'lov saqlanmoqda...` and prevent duplicate submit
   or accidental close while unresolved.
6. Keep the confirmed-response cache patch; never optimistically alter
   financial balances.
7. Use existing phase timings to remove measured transaction waste. Remove
   redundant reads first; batch schedule writes only with serializable,
   idempotency, and ledger-invariant integration coverage.

## Phase 4 - backend floor and database work

1. Combine/parallelize authorization lookups without weakening live session
   revocation, permissions, package checks, or tenant scoping.
2. Make currency refresh stale-while-revalidate with a hard external timeout;
   list navigation should use the last valid stored rate rather than block on
   CBU.
3. Add indexes only after query-plan evidence. Candidate gaps include:
   - Device note/supplier search;
   - active Device tenant + created-date ordering;
   - normalized secondary IMEI substring search;
   - Customer additional-phone search;
   - customer/Nasiya notes and normalized IMEI search;
   - Nasiya schedule effective-due predicate alignment.
4. Remove exact counts from interactions that only need next/previous paging,
   or cache counts separately.
5. Use short, permission-scoped caching only for low-cardinality non-search
   first pages. Do not cache sensitive search text, and invalidate every domain
   on confirmed mutations.

## Page-by-page completion matrix

| Page/interaction | Required completion |
| --- | --- |
| Dashboard | Keep fast; verify shared shell changes do not regress it |
| Yangi operatsiya | Route feedback and standardized pending actions |
| Qurilmalar | Visible refetch, tab prefetch, measured search/index work |
| Sotuvlar | SSR first page, dedicated Sales query, live search, pagination |
| Nasiyalar | Visible refetch, query/tab optimization, fast payment intent |
| To'lovlar | Client cohort tabs, prefetch, query/index optimization |
| Mijozlar | SSR first page, private debounced live search, visible refetch |
| Logs | Exact filtered seed, visible category/search/page refresh |
| Xodimlar | SSR roster, route skeleton, all mutations pending-safe |
| Settings | Server seed, section split, cache, skeleton/error/save states |
| Nasiya payment | Immediate shell, prefetch/skeleton, pending-safe submit |

## Testing and acceptance

### Component/guard tests

- AsyncButton spinner, pending label, disabled state, `aria-busy`, and single
  invocation.
- Sotuvlar and Mijozlar debounce, abort, no search button, and one request per
  settled input.
- Customer search privacy: no search text in URL/history/query metadata/logs.
- QueryActivity: old rows retained, selected tab immediate, progress visible,
  results `aria-busy`, retry works.
- Route skeleton coverage for every shop route.
- Nasiya payment intent prefetch, skeleton, pending submit, and confirmed cache
  update.

### Integration tests

- owner/staff tenant and permission parity for every optimized endpoint;
- dedicated Sales pagination/search correctness;
- Device/Nasiya/receivable query parity before and after rewrites;
- payment idempotency, serializable races, allocations, and ledger invariants;
- no duplicate request from double-clicking any mutation.

### Browser performance tests

Run owner and representative staff roles on desktop and throttled mobile:

1. dashboard -> each sidebar route;
2. every reported tab switch;
3. settled live search and rapid typing/cancellation;
4. Nasiya payment modal open and submit;
5. each save/create/delete/status flow;
6. back/forward and warm-cache revisit.

Fail CI/release verification when immediate feedback is absent or when agreed
p75/p95 budgets regress beyond tolerance.

## Delivery order

1. **Release A - feedback foundation:** instrumentation, generic/specific route
   loaders, QueryActivity, AsyncButton, and link pending state.
2. **Release B - high-pain lists:** dedicated/SSR Sotuvlar, live Mijozlar,
   client To'lovlar tabs, and exact Logs seed.
3. **Release C - query floor:** authorization consolidation, currency SWR,
   measured indexes/query rewrites, Nasiya cohort work.
4. **Release D - completion:** Xodimlar/Settings server seed, all remaining
   mutation adoption, full owner/staff performance regression suite.

Each release must be verified independently. Do not combine unreviewed
financial-data repair with performance schema/query changes.

## Production constraint

Production is still on `75a15fb`, while current `main` is `d77b09d`. The guarded
release is blocked by one existing Nasiya parent/schedule ledger mismatch.
Performance work can continue on `main`, but production verification cannot be
claimed until the separately approved, backed-up deterministic cache repair is
completed and the guarded release succeeds.

## Definition of done

The project is complete only when:

- all reported routes meet agreed p75/p95 budgets;
- every tab/search shows immediate feedback and never looks frozen;
- Sotuvlar and Mijozlar search automatically after typing, with no search
  button;
- every async save/create/payment/delete action uses the shared pending
  contract and cannot double-submit;
- owner and staff permissions/data visibility remain unchanged;
- query plans are recorded for every database change;
- no financial ledger, idempotency, audit, or tenant invariant regresses;
- the exact verified commit is promoted through the guarded production
  workflow and re-measured on production.
