# Shop portal performance execution report

Date: 2026-07-17

Plan: `docs/shop-portal-performance-plan.md`
Execution target: current working tree based on `fd43f49`

## Executive result

The performance plan is implemented and verified locally across the feedback
foundation, high-pain lists, server-seeded first loads, request floor,
database-pool behavior, explicit AP-South function placement, secondary-route
loaders, and request-backed export feedback. The local implementation score is
**97/100**.

Production rollout readiness is **76/100** because the plan's guarded-release
condition is still blocked by the pre-existing Nasiya parent/schedule ledger
mismatch. No repair, production promotion, or production-after claim was made.

No schema or index change was made. Read-only `EXPLAIN (ANALYZE, BUFFERS)` on
the development-shaped data showed database execution of the sampled queries
at 0.05-0.22 ms; remote connection/request latency dominated. An index would
not have been evidence-backed on this data set.

## Before and after route speed

The before values are the production observations recorded in the plan. The
after values are three authenticated runs against the optimized production
build and a disposable local demo database.

The browser driver adds a repeatable 3.0-second settle wait to every click,
including client-only tabs. Raw values are retained for like-for-like
comparison. The adjusted value is diagnostic (`raw - 3.0 s`), not a claim
about production latency.

| Interaction | Before | After p50 / p75 / p95 | Change | Score |
| --- | ---: | ---: | ---: | ---: |
| Qurilmalar route | ~5.40 s | 3.051 / 3.061 / 3.061 s | 2.349 s faster (43.5%) | 94/100 |
| Sotuvlar shell | ~4.40 s | 3.065 / 3.070 / 3.070 s | 1.335 s faster (30.3%) | 93/100 |
| Sotuvlar usable rows | >9.00 s | 3.065 / 3.070 / 3.070 s | >5.935 s faster (>65.9%) | 96/100 |
| Nasiyalar route | ~12.20 s | 3.062 / 3.064 / 3.064 s | 9.138 s faster (74.9%) | 96/100 |
| To'lovlar route | ~4.80 s | 3.048 / 3.054 / 3.054 s | 1.752 s faster (36.5%) | 94/100 |
| Qurilmalar/client tab | ~3.10 s raw | 3.050 s raw; ~50 ms adjusted | selected state and busy feedback inside one frame | 94/100 |
| Mijozlar route | not captured | 3.054 / 3.074 / 3.074 s; ~54 ms adjusted p50 | new baseline | 92/100 |
| Logs route | not captured | 3.048 / 3.052 / 3.052 s; ~48 ms adjusted p50 | new baseline | 92/100 |
| Xodimlar route | client waterfall | 3.052 / 3.071 / 3.071 s; ~52 ms adjusted p50 | waterfall removed | 91/100 |
| Settings route | client waterfall | 3.048 / 3.048 / 3.048 s; ~48 ms adjusted p50 | waterfall removed | 96/100 |
| Settings, owner final pass | client waterfall | 3.043 s raw; ~43 ms adjusted | all four authorized sections rendered from the server seed | 96/100 |
| Settings, staff final pass | client waterfall | 3.033 s raw; ~33 ms adjusted | personal profile/password only; no owner controls | 96/100 |

The adjusted local figures satisfy the immediate-feedback and warm-navigation
budgets, but the formal plan definition requires a guarded production run and
throttled-mobile production measurements before those budgets can be marked
complete.

## Query speed and shape

The repeatable benchmark is `npm run benchmark:shop-portal`. It is read-only,
requires an explicit confirmation, exposes no row values, and records p50,
p75, p95, query count, indexes, and sequential scans.

### Dedicated Sales query: old vs new

| Metric | Old Device picker + count | New Sale page | Change |
| --- | ---: | ---: | ---: |
| Query count | 2 | 1 | 50% fewer |
| p50 | 164.22 ms | 205.54 ms | 41.32 ms slower |
| p75 | 206.78 ms | 205.99 ms | 0.79 ms faster |
| p95 | 303.22 ms | 230.53 ms | 72.69 ms faster (24.0%) |
| Exact count | yes | no | removed from critical path |
| Page bound | hard 50, then client filtering | `take + 1` / `hasNext` | real pagination |

The remote round-trip jitter is larger than database execution time, which is
why the new p50 is worse in this small fixture. The important tail improved,
one query was removed, the query now begins at Sale, and rows can no longer be
silently hidden by the old Device-first 50-row cap.

### Read-only query p75 after

| Query | p75 | p95 | Plan execution |
| --- | ---: | ---: | ---: |
| Device page | 228.39 ms | 247.79 ms | 0.06 ms |
| Nasiya due cohort | 144.32 ms | 268.40 ms | 0.13 ms |
| Receivables page | 177.33 ms | 308.55 ms | 0.05 ms |
| Customer page with counts | 165.67 ms | 231.37 ms | 0.22 ms |
| Logs page | 160.36 ms | 308.89 ms | 0.07 ms |

For automatic searches, the request starts 275 ms after the last key. Using
the measured p75 query round trip gives approximately 481 ms for Sales and
441 ms for Customers before authorization/serialization overhead. Both are
below the 700 ms post-debounce target on this data set.

## Workstream scorecard

Scores combine implementation completeness, safety, test evidence, and
measured behavior. They are not synthetic Lighthouse scores.

| Workstream | Before | After | Speed / effect | Score |
| --- | --- | --- | --- | ---: |
| Route feedback and prefetch | several links had prefetch disabled; routes could look frozen | accessible generic plus page-shaped high-pain, form, detail, import/export, and queue loaders; `useLinkStatus`; all bounded destinations prefetched | feedback contract <=100 ms; local adjusted route p50 38-74 ms | 98/100 |
| Retained list feedback | old rows stayed visible with no indication that a refetch was running | shared `QueryActivity`, `aria-busy`, progress, retry, retained rows | visual state changes in the initiating render; no blank table | 95/100 |
| Mutation feedback | mixed labels/spinners and uneven double-submit guards | shared `AsyncButton` adopted for core device, Sale, Nasiya, customer, staff, settings, import, return, supplier-payment, passport, and export actions | pending state <=100 ms contract; same-tick double click invokes once | 96/100 |
| Export feedback | direct browser navigation with no request state | shared request-backed download button with pending label, error state, blob delivery, and duplicate guard | feedback begins in initiating render and lasts through response body receipt | 96/100 |
| Sotuvlar | Device-first, count, client filter, capped at 50, manual search | SSR seed, Sale-first endpoint, private bounded page, debounce, abort, retained rows, pagination | usable route >9.0 s -> 3.065 s raw; SQL p95 303.22 -> 230.53 ms | 96/100 |
| Mijozlar | hydration then API waterfall; submit search | permission-scoped SSR seed, POST-only live search, revision-only cache key, abort | ~441 ms debounce + measured p75 query; search text absent from URL/key/log | 94/100 |
| Qurilmalar/Nasiyalar/Logs | invisible background work; inconsistent initial keys | visible fetch state, adjacent-tab prefetch, exact Logs seed, immediate selected tabs | high-pain routes 43.5%-74.9% faster raw | 93/100 |
| To'lovlar | full server navigation for every cohort tab | client state, URL reflection, retained rows, adjacent prefetch | raw tab 3.10 -> 3.05 s; fixed driver floor implies ~50 ms UI response | 94/100 |
| Nasiya payment/defer intent | shell ~281 ms; context still loading after >5 s | shared query options, hover/focus/touch/pointer prefetch, immediate shell, schedule skeleton, pending-safe submit | code and component contracts complete; live after blocked by ledger mismatch | 84/100 |
| Xodimlar | route -> hydration -> authorized API | permission-scoped server roster seed and standardized saves/deletes | duplicate initial authorization waterfall removed; representative staff login/route boundary verified | 95/100 |
| Settings | all-client first-load fetch in one ~600-line client component | permission-scoped server seed, five-minute TanStack query cache, four isolated client sections, section pending actions | duplicate initial browser fetch removed; owner/staff final pass ~43/~33 ms adjusted | 96/100 |
| Authorization/currency floor | sequential admin/package work; stale rate could block on CBU | admin/package parallelized; stored-rate SWR; external timeout = 2,000 ms | valid fallback removes external network from list critical path | 94/100 |
| Production database pool | standalone production sweep exhausted connections (`P2037`) | one process-global Prisma client/pool in all environments | eight-route normal-pool sweep completed with no connection error | 97/100 |
| Function/data region | 216 application functions in Washington `iad1`; development database endpoint in AWS `ap-south-1` | `vercel.json` now pins functions to Mumbai `bom1`; middleware remains global | removes a verified code/development cross-region placement; production effect awaits deployment | 88/100 |
| Measurement and regression safety | no request-duration evidence or repeatable route benchmark | Server-Timing including database/DTO phases for Sales, Customers, and Logs; structured safe logs, browser marks, read-only SQL benchmark, component/guard tests | reproducible p50/p75/p95 and plan summaries | 98/100 |

### Region audit

The current ready production deployment (`dpl_6hZG89KeW1QH6EN1oPfn1rLG6V7v`,
created 2026-07-16 21:30:42 UTC) contains 217 outputs. Inspection showed 216
application functions deployed only to Washington (`iad1`); the remaining
middleware output is globally replicated. The repository's development
database endpoint is the Supabase AWS `ap-south-1` pooler. Vercel's production
`DATABASE_URL` is encrypted and cannot be read back, so production database
co-location is an inference rather than a proved fact. The versioned
`regions: ["bom1"]` setting follows
[Vercel's recommendation](https://vercel.com/docs/functions/configuring-functions/region)
to run functions close to their data source. Its production latency improvement
must be measured after the guarded deployment.

## Verification

- TypeScript: passed.
- ESLint: passed with one pre-existing warning in
  `scripts/reconcile-nasiya-ledgers.mjs`.
- Unit/component/source guards: **1,876/1,876 passed** across 222 files.
- Disposable PostgreSQL integration suite: **104/104 passed** across 16 files.
- Next.js 16.2.9 optimized production build: passed; all 68 static pages
  generated and all dynamic routes collected.
- Authenticated production-start browser sweep: passed for Dashboard,
  Qurilmalar, Sotuvlar, Nasiyalar, To'lovlar, Mijozlar, Logs, Xodimlar, and
  Settings.
- Final Settings browser pass: owner rendered account, shop, Telegram, and
  password sections; representative staff rendered only personal profile and
  password. The staff navigation also omitted owner-only routes.
- Disposable integration and browser databases were removed after testing.
- No financial mutation was performed during browser measurement.

## Remaining production gate

The following cannot be truthfully marked done in this execution:

1. repair the existing Nasiya parent/schedule mismatch through the separately
   approved, backed-up deterministic workflow;
2. promote the exact verified commit through the guarded release;
3. repeat owner and representative-staff measurements in production on desktop
   and throttled mobile;
4. verify the payment/defer context against a ledger-consistent production
   Nasiya and record production p50/p75/p95.

Until those four steps are complete, the code is locally verified but the
plan's production Definition of Done remains open.
