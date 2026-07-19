# Customer profile analytics dashboard

## Product and metric contract

- The dashboard supports 6, 12, and 24 complete Tashkent calendar-month ranges.
- UZS and USD remain separate native-currency series and totals. The UI never creates a mixed-currency grand total or an inferred conversion.
- Current obligations are split into overdue, today, next 7 days, days 8–30, and later. Deferred Nasiya schedules use their effective delayed due date.
- Cancelled, returned, deleted, imported-as-new-activity, and non-active resolution records are excluded where the accounting contract requires it.
- Payment discipline uses completed schedule payments, the existing one-day tolerance, on-time/late counts, on-time ratio, maximum days late, and the current overdue-schedule count.
- Shop owners receive payment, refund, write-off, profit, interest, and legacy-payment caveat fields. Staff with `CUSTOMER_VIEW` receive only operational obligations, contract activity, discipline, counts, and allowed history. Restricted fields are omitted server-side.

## Request and rendering architecture

- The server page resolves authorization once and seeds overview, 12-month analytics, and bounded history in parallel.
- Analytics are returned by one tenant-scoped, set-based PostgreSQL statement with at most 24 zero-filled rows.
- Overview, analytics ranges, and history pages use separate React Query cache keys. Existing data stays mounted during refresh and requests use abort signals.
- History uses `take + 1` pagination, so tab changes no longer run an exact total-count query.
- Recharts is isolated behind a client-only dynamic import with a fixed-height skeleton; chart animation is disabled and exact values remain available as text.

## Local performance evidence

Measured on 2026-07-19 against the same production build mode and disposable local PostgreSQL database. Each percentile set has seven runs and uses nearest-rank percentiles. The baseline was commit `45b9686`; the after sample is this change. Results include a coldest sample in p95.

| User path | Version | p50 | p75 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Initial customer data ready | Before: blank route plus combined profile API lower bound | 27.3 ms | 33.3 ms | 65.5 ms |
| Initial customer data ready | After: server-seeded route TTFB | 12.0 ms | 13.0 ms | 36.1 ms |
| History-tab data request | Before: combined profile API | 19.1 ms | 22.7 ms | 31.7 ms |
| History-tab data request | After: bounded history-only API | 6.0 ms | 6.1 ms | 6.8 ms |
| 24-month range UI settle | After: browser User Timing | 29.8 ms | 51.6 ms | 52.6 ms |

Initial data readiness saves 15.3 ms at p50 (56.1%), 20.3 ms at p75 (60.9%), and 29.4 ms at p95 (44.9%). History-only requests save 13.1 ms at p50 (68.6%), 16.6 ms at p75 (73.0%), and 24.9 ms at p95 (78.5%). The range transition has no before value because that interaction did not exist.

`EXPLAIN (ANALYZE, BUFFERS)` on the 24-month aggregate reported 12.640 ms planning time, 5.124 ms execution time, 193 shared-buffer hits, and zero reads on the warm demo data. Existing customer, sale, Nasiya, schedule, payment, return, and resolution indexes cover the filter and join shapes; the tiny demo tables correctly preferred sequential scans in several nodes. No new index or migration was added without larger-scale evidence.

## Verification coverage

- 2,028 unit, component, security, architectural, and guard tests pass.
- 118 disposable-PostgreSQL integration tests pass.
- ESLint passes with one pre-existing warning outside this change; TypeScript and the optimized Next.js production build pass.
- Owner and limited-staff browser sessions were checked independently. Staff JSON contained only `month` and `contracts` activity keys and no financial caveat keys.
- Browser checks passed at 320, 375, 768, and 1,440 CSS pixels with no horizontal overflow, error overlay, page error, or console error. The 320-pixel reflow also covers the layout condition produced by 200% zoom on a 640-pixel CSS canvas.

## Remaining measurement limits

- Local demo data validates query shape and correctness, but production-scale cardinality and production regional/network latency must be confirmed after the guarded deployment.
- Browser zoom itself was not programmatically set to 200%; the equivalent 320-pixel CSS reflow condition was tested directly.
- The dashboard adds no mixed-currency valuation or prediction. Any future conversion, cohort comparison, or risk score needs a separate accounting and product contract.
