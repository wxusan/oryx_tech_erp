# Performance audit — Oryx Tech ERP

Date: 2026-07-08. See `full-production-audit.md` for the overall scorecard.

## What was checked

`src/lib/server/shop-stats.ts` and `shop-lists.ts` (dashboard/report/list
query patterns), `unstable_cache` usage and invalidation, `getUsdUzsRate()`
caching, and every `findMany` across `src/lib/server/**` and
`src/app/api/**` for a missing row cap.

## Findings

### Query batching (good)

`getShopStatsFresh()` fires its ~13 independent Prisma queries inside a
single `Promise.all([...])` — no serial waterfall. No N+1 pattern was found
in the dashboard/report code path: nested `select`s (e.g. `device: { select:
{ purchasePrice: true } }`) are genuine one-level joins handled by Prisma in
a single query, not a loop of individual queries.

### Hardcoded row caps instead of true pagination (P1, deferred)

`getShopDevicesListFresh()` and `getShopNasiyalarListFresh()`
(`shop-lists.ts`) cap at `take: 500` with no `skip`/page parameter, and the
`qurilmalar` list page filters/searches that fixed batch entirely
client-side. At the demo/onboarding scale this ships for (new shops
starting empty), this is a non-issue. It becomes a real problem once a
shop accumulates 500+ devices or nasiyas: the 501st+ row silently
disappears from the list, and the client-side filter has to process
however many rows were fetched. **Why deferred**: real pagination is a
matched API+UI feature (list endpoint needs `skip`/`take` params, the page
needs a "load more"/page-control UI, and search needs to move server-side
to stay correct against the full dataset) — a moderate feature, not a safe
one-line fix, and risky to rush across three list pages (devices, nasiyas,
customers) in this pass.

`shop-stats.ts`'s `nasiyaSchedulesForStats` query (used for
`expectedThisMonth`/`overdueMoney`) also has no explicit `take` limit — for
a shop with very many overdue installments this could pull a large row set
into memory. The `upcomingPayments` preview query is already capped at
`take: 50`. Not fixed this pass for the same reason as above (would need
to define a sensible cap without breaking the aggregate's own correctness,
which sums across *every* pending/overdue schedule by design — capping it
would silently under-report the total rather than just being slow).

### Currency-rate fetch (P2, minor, not fixed)

`getUsdUzsRate()` is cached with a 12-hour TTL at the data-access layer
(`src/lib/server/currency.ts`), so repeated calls within that window hit
the cache, not an external API or a fresh DB round-trip. `shop-stats.ts`
calls it once per invocation; page-level `getShopCurrencyContext()` calls
are separate but also hit the same cache. This is a minor duplication
(two cache reads instead of one shared value within a single request), not
a real latency problem given the cache TTL — left as-is.

### Cache invalidation (good)

Spot-checked the sale payment, nasiya payment, and device-sell mutation
routes against `src/lib/server/cache-tags.ts`: each calls the matching
`invalidateShop*Mutation()` helper immediately after its transaction
commits, and `unstable_cache` tags are tied to the same shop-scoped keys
read by the list/stats functions. No stale-financial-data risk found.

## Summary table

| ID | Severity | Area | Issue | Fixed? |
|---|---|---|---|---|
| PERF-1 | P1 | Lists | Hardcoded `take: 500` instead of true pagination (devices, nasiyas) | No — feature-sized, deferred |
| PERF-2 | P2 | Dashboard | No row cap on the `nasiyaSchedulesForStats` aggregate query | No — capping would break aggregate correctness; needs a different fix shape |
| PERF-3 | P3 | Currency rate | Rate fetched twice per request in some code paths (both within cache TTL) | No — negligible given 12h cache |

No performance issue found is severe enough to affect the demo (data
volumes at onboarding are small); the pagination gap is the one item worth
prioritizing before a shop grows past a few hundred devices/nasiyas.
