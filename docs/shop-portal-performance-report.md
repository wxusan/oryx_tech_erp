# Shop portal performance execution report

Date: 2026-07-17

Plan: `docs/shop-portal-performance-plan.md`
Execution target: production commit `b2b7e21`

## Executive result

The performance plan is implemented, deployed, and verified at
`https://oryx-tech-erp.vercel.app`. The live alias resolves to ready deployment
`dpl_C1iYkvHwsyGxeVrnqk3qJB51i5nC`, health reports commit `b2b7e21` and
`database: ok`, and Vercel reports Mumbai function placement (`bom1`). The
implementation score is **98/100** and the production-verification score is
**96/100**.

The release used an unaliased artifact, mandatory preflight, exact-commit
health verification, and promotion only after the checks passed. The optional
one-row Nasiya repair was not applied because production no longer matched its
strict exactly-one-row assumption; the successful artifact instead passed the
mandatory clean-database preflight with repair disabled.

No schema or index change was made. Read-only `EXPLAIN (ANALYZE, BUFFERS)` on
the development-shaped data showed database execution of the sampled queries
at 0.05-0.22 ms; remote connection/request latency dominated. An index would
not have been evidence-backed on this data set.

## Before and after route speed

The before values are the original production observations recorded in the
plan. Route after-values are three authenticated owner runs against the live
production deployment in Chrome. They are full-page navigation durations;
with three samples, p75 and p95 use the highest observed value. The client-tab
measurement retains the browser driver's repeatable 3.0-second action floor
and reports its adjusted diagnostic value separately.

| Interaction | Before | After p50 / p75 / p95 | Change | Score |
| --- | ---: | ---: | ---: | ---: |
| Dashboard route | not captured | 0.610 / 0.883 / 0.883 s | production baseline | 96/100 |
| Qurilmalar route | ~5.40 s | 0.626 / 2.104 / 2.104 s | 4.774 s faster at p50 (88.4%) | 96/100 |
| Sotuvlar shell | ~4.40 s | 0.551 / 0.809 / 0.809 s | 3.849 s faster at p50 (87.5%) | 98/100 |
| Sotuvlar usable rows | >9.00 s | 0.551 / 0.809 / 0.809 s | >8.449 s faster at p50 (>93.9%) | 99/100 |
| Nasiyalar route | ~12.20 s | 0.498 / 0.792 / 0.792 s | 11.702 s faster at p50 (95.9%) | 99/100 |
| To'lovlar route | ~4.80 s | 0.462 / 0.484 / 0.484 s | 4.338 s faster at p50 (90.4%) | 99/100 |
| Qurilmalar client tab | ~3.10 s raw | 3.097 s raw; ~97 ms adjusted | immediate selected state retained | 95/100 |
| Mijozlar route | not captured | 0.503 / 0.537 / 0.537 s | production baseline | 96/100 |
| Logs route | not captured | 0.482 / 0.483 / 0.483 s | production baseline | 96/100 |
| Xodimlar route | client waterfall | 0.576 / 0.604 / 0.604 s | initial waterfall removed | 96/100 |
| Settings route | client waterfall | 0.466 / 0.530 / 0.530 s | all owner sections server-seeded | 98/100 |
| Nasiya payment shell/context | ~0.281 s / >5.00 s | 0.679 / 0.761 s cold; 0.307 s warm shell | context >4.239 s faster (>84.8%) | 96/100 |
| Nasiya defer shell/context | not captured | 0.327 / 0.478 s | production baseline | 98/100 |

All nine measured owner routes rendered without application or server errors.
The Nasiya payment and defer dialogs were opened and fully loaded, but no
payment, deferral, export, or other financial mutation was submitted.

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
| Route feedback and prefetch | several links had prefetch disabled; routes could look frozen | accessible generic plus page-shaped high-pain, form, detail, import/export, and queue loaders; `useLinkStatus`; all bounded destinations prefetched | live owner route p50 462-626 ms; client tab ~97 ms adjusted | 98/100 |
| Retained list feedback | old rows stayed visible with no indication that a refetch was running | shared `QueryActivity`, `aria-busy`, progress, retry, retained rows | visual state changes in the initiating render; no blank table | 95/100 |
| Mutation feedback | mixed labels/spinners and uneven double-submit guards | shared `AsyncButton` adopted for core device, Sale, Nasiya, customer, staff, settings, import, return, supplier-payment, passport, and export actions | pending state <=100 ms contract; same-tick double click invokes once | 96/100 |
| Export feedback | direct browser navigation with no request state | shared request-backed download button with pending label, error state, blob delivery, and duplicate guard | feedback begins in initiating render and lasts through response body receipt | 96/100 |
| Sotuvlar | Device-first, count, client filter, capped at 50, manual search | SSR seed, Sale-first endpoint, private bounded page, debounce, abort, retained rows, pagination | usable route >9.0 s -> 0.551 s production p50; SQL p95 303.22 -> 230.53 ms | 99/100 |
| Mijozlar | hydration then API waterfall; submit search | permission-scoped SSR seed, POST-only live search, revision-only cache key, abort | ~441 ms debounce + measured p75 query; search text absent from URL/key/log | 94/100 |
| Qurilmalar/Nasiyalar/Logs | invisible background work; inconsistent initial keys | visible fetch state, adjacent-tab prefetch, exact Logs seed, immediate selected tabs | production p50 0.626 / 0.498 / 0.482 s | 97/100 |
| To'lovlar | full server navigation for every cohort tab | client state, URL reflection, retained rows, adjacent prefetch | route 4.80 -> 0.462 s p50; fixed-floor tab ~97 ms adjusted | 98/100 |
| Nasiya payment/defer intent | shell ~281 ms; context still loading after >5 s | shared query options, hover/focus/touch/pointer prefetch, immediate shell, schedule skeleton, pending-safe submit | payment cold shell/context 679/761 ms; defer 327/478 ms; both error-free | 96/100 |
| Xodimlar | route -> hydration -> authorized API | permission-scoped server roster seed and standardized saves/deletes | duplicate initial authorization waterfall removed; representative staff login/route boundary verified | 95/100 |
| Settings | all-client first-load fetch in one ~600-line client component | permission-scoped server seed, five-minute TanStack query cache, four isolated client sections, section pending actions | duplicate initial browser fetch removed; owner/staff final pass ~43/~33 ms adjusted | 96/100 |
| Authorization/currency floor | sequential admin/package work; stale rate could block on CBU | admin/package parallelized; stored-rate SWR; external timeout = 2,000 ms | valid fallback removes external network from list critical path | 94/100 |
| Production database pool | standalone production sweep exhausted connections (`P2037`) | one process-global Prisma client/pool in all environments | eight-route normal-pool sweep completed with no connection error | 97/100 |
| Function/data region | 216 application functions in Washington `iad1`; development database endpoint in AWS `ap-south-1` | live deployment reports Mumbai `bom1`; middleware remains global | region change is online; high-pain production p50 is now 462-626 ms | 100/100 |
| Measurement and regression safety | no request-duration evidence or repeatable route benchmark | Server-Timing including database/DTO phases for Sales, Customers, and Logs; structured safe logs, browser marks, read-only SQL benchmark, component/guard tests | reproducible p50/p75/p95 and plan summaries | 98/100 |

### Region audit

The previous production deployment (`dpl_6hZG89KeW1QH6EN1oPfn1rLG6V7v`) ran
216 application functions in Washington (`iad1`). The promoted deployment
`dpl_C1iYkvHwsyGxeVrnqk3qJB51i5nC` reports `regions: ["bom1"]`, is `READY`,
is assigned to the live alias, and carries exact release metadata for
`b2b7e21474cce793314a2cae7ce31057fddd7791`. Middleware remains globally
replicated. The repository's observed database endpoint is in AWS
`ap-south-1`, so Mumbai follows
[Vercel's recommendation](https://vercel.com/docs/functions/configuring-functions/region)
to run functions close to the data source.

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
- Live public health: HTTP 200, `ok: true`, `database: ok`, commit `b2b7e21`.
- Live owner route sweep: three full-page runs each; all nine routes rendered
  without application/server errors, with p50 462-626 ms.
- Live Nasiya payment modal: 679 ms cold shell, 761 ms complete context; no
  submit performed.
- Live Nasiya defer modal: 327 ms shell, 478 ms complete context; no submit
  performed.
- Deployment safety: artifact was unaliased until exact health passed; two
  delayed duplicate queued artifacts were canceled before they built.
- Final Settings browser pass: owner rendered account, shop, Telegram, and
  password sections; representative staff rendered only personal profile and
  password. The staff navigation also omitted owner-only routes.
- Disposable integration and browser databases were removed after testing.
- No financial mutation was performed during browser measurement.

## Remaining measurement limits

The production rollout gate is complete. Two evidence gaps remain and account
for the production score being 96 rather than 100:

1. production timing used an existing owner session; representative-staff
   authorization was verified locally but was not re-timed in production;
2. production route samples were desktop Chrome runs, not throttled-mobile
   runs, and three samples provide limited tail-latency confidence.

These are measurement-depth gaps, not deployment, database-health, or live
functionality blockers.
