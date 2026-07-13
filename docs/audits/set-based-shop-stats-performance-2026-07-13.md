# Set-based Shop stats performance evidence — 2026-07-13

## Scope and conclusion

This is local PostgreSQL evidence for the set-based SQL in
`src/lib/server/shop-stats-queries.ts`. It does not claim production browser,
Vercel, network, Prisma, React rendering, or production-data latency.

At 100,000 open obligations (50,000 Qarz Sales plus 50,000 Nasiya schedules),
the five measured paths stayed below 130 ms median in run 1 and below 67 ms
median for the three aggregate paths in run 2. After synchronizing the harness
with the authoritative native-contract/returned-contract predicates, runs 3
and 4 kept all three aggregates below 92 ms median. Aggregate/banner queries returned
one row. The upcoming list returned five IDs and hydrated only those five rows.
The ordered upcoming path used
`NasiyaSchedule_shopId_effectiveDue_open_idx`; bounded hydration used
`NasiyaSchedule_pkey`.

This closes the local database-evidence portion of PERF-02. It does not close
live-production or end-to-end browser verification.

## Reproduction

The executable harness is `scripts/benchmark-shop-stats.mjs`, exposed as
`npm run benchmark:shop-stats`. It accepts only 50,000–100,000 obligations,
refuses production/Vercel, requires an explicitly marked disposable database,
and inserts the fixture inside a transaction that is rolled back on exit.

```sh
TEST_DATABASE_URL='postgresql://USER@127.0.0.1:5432/oryx_stats_benchmark' \
PERF_DB_CONFIRM='benchmark-disposable-obligation-database' \
PERF_OBLIGATION_COUNT=100000 \
PERF_ITERATIONS=5 \
npm run benchmark:shop-stats
```

The harness executes plan-equivalent parameterized SQL for the four helpers,
plus the bounded five-row hydration that follows the upcoming-ID query. If the
application SQL changes, the harness must be reviewed at the same time.

## Test environment

- Apple Silicon local machine
- PostgreSQL 16.14 (Homebrew, arm64)
- Node.js v24.13.1
- Dedicated local database: `oryx_stats_benchmark_20260713`
- All 36 checked-in Prisma migrations applied with `prisma migrate deploy` for
  the final run (the earlier recorded runs preceded later release migrations)
- Deterministic fixture: 50,000 open Sales, 50,000 Nasiya parents, 50,000 open schedules, mixed USD/UZS and past/current/future due dates
- PostgreSQL `ANALYZE` run after fixture insertion
- Query timings measured after one warm-up; plans captured with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF, SUMMARY ON)`

After both runs, direct counts confirmed `Shop = 0`, `Sale = 0`, and
`NasiyaSchedule = 0`, proving the fixture transaction was rolled back.

## Measured results

Run 1 used five timed iterations after warm-up:

| Path | Wire rows | Median | P95 | Plan evidence |
|---|---:|---:|---:|---|
| `getShopAccrualAggregate` | 1 | 37.608 ms | 51.934 ms | Set aggregate; dominant-tenant sequential scans |
| `getShopObligationAggregate` | 1 | 121.871 ms | 126.865 ms | Set aggregate; full open-obligation scan stays in PostgreSQL |
| `getCurrentOverdueSummary` | 1 | 71.115 ms | 71.707 ms | Uses effective-due and Sale due-date open indexes |
| `getUpcomingScheduleIds` | 5 | 9.721 ms | 10.115 ms | Uses `NasiyaSchedule_shopId_effectiveDue_open_idx`; no sequential scan |
| bounded upcoming hydration | 5 | 0.480 ms | 0.497 ms | Uses `NasiyaSchedule_pkey`; no sequential scan |

Run 2 repeated the same deterministic 100,000-obligation fixture with three
timed iterations:

| Path | Wire rows | Median | P95 |
|---|---:|---:|---:|
| `getShopAccrualAggregate` | 1 | 31.327 ms | 32.059 ms |
| `getShopObligationAggregate` | 1 | 66.566 ms | 66.573 ms |
| `getCurrentOverdueSummary` | 1 | 66.530 ms | 66.808 ms |
| `getUpcomingScheduleIds` | 5 | 9.373 ms | 9.845 ms |
| bounded upcoming hydration | 5 | 0.396 ms | 0.399 ms |

Both runs also asserted that dashboard and banner overdue counts agreed for the
one-schedule-per-deal fixture (`50,020` overdue deals), and that the accrual
aggregate counted all 50,000 Sales.

Run 3 used the then-current 35-migration schema and five timed iterations after the
benchmark predicates were synchronized with `shop-stats-queries.ts`:

| Path | Wire rows | Median | P95 |
|---|---:|---:|---:|
| `getShopAccrualAggregate` | 1 | 30.330 ms | 30.684 ms |
| `getShopObligationAggregate` | 1 | 87.039 ms | 89.265 ms |
| `getCurrentOverdueSummary` | 1 | 55.796 ms | 56.387 ms |
| `getUpcomingScheduleIds` | 5 | 6.877 ms | 7.112 ms |
| bounded upcoming hydration | 5 | 0.727 ms | 0.744 ms |

Run 3 again returned `50,020` overdue deals, used the effective-due index for
the ordered preview, hydrated exactly five schedules by primary key, and rolled
the entire 100,000-obligation fixture back on exit.

Run 4 used the final 36-migration schema and five timed iterations after the
request-audit migration was added:

| Path | Wire rows | Median | P95 |
|---|---:|---:|---:|
| `getShopAccrualAggregate` | 1 | 30.590 ms | 31.330 ms |
| `getShopObligationAggregate` | 1 | 90.037 ms | 91.659 ms |
| `getCurrentOverdueSummary` | 1 | 55.229 ms | 57.534 ms |
| `getUpcomingScheduleIds` | 5 | 6.689 ms | 6.909 ms |
| bounded upcoming hydration | 5 | 0.685 ms | 0.731 ms |

Run 4 again returned one row per aggregate, five preview IDs, five hydrated
rows, and rolled the entire fixture back on exit. Every measured path stayed
below the harness's 2,000 ms acceptance budget.

Run 5 repeated the final-tree benchmark after release, retry, and queue
hardening. It used the same 36-migration schema and five timed iterations:

| Path | Wire rows | Median | P95 |
|---|---:|---:|---:|
| `getShopAccrualAggregate` | 1 | 30.761 ms | 31.086 ms |
| `getShopObligationAggregate` | 1 | 91.047 ms | 94.834 ms |
| `getCurrentOverdueSummary` | 1 | 54.377 ms | 56.918 ms |
| `getUpcomingScheduleIds` | 5 | 6.599 ms | 6.804 ms |
| bounded upcoming hydration | 5 | 0.704 ms | 0.735 ms |

Run 5 again returned `50,020` overdue deals, used the effective-due index,
hydrated exactly five schedules, and rolled back all 100,000 obligations.

Run 6 repeated the benchmark on the final Oryx ERP 2.0 tree after all 40
migrations, with normal fixture constraints enforced. Both fixtures used five
timed iterations after warm-up:

| Path | 50,000 median / P95 | 100,000 median / P95 | Wire rows |
|---|---:|---:|---:|
| `getShopAccrualAggregate` | 25.139 / 26.153 ms | 41.995 / 42.365 ms | 1 |
| `getShopObligationAggregate` | 34.048 / 34.484 ms | 114.116 / 115.885 ms | 1 |
| `getCurrentOverdueSummary` | 27.592 / 27.886 ms | 73.429 / 74.292 ms | 1 |
| `getUpcomingScheduleIds` | 3.950 / 4.131 ms | 9.417 / 9.596 ms | 5 |
| bounded upcoming hydration | 0.472 / 0.624 ms | 0.541 / 0.857 ms | 5 |

Run 6 returned the expected `25,018` and `50,020` overdue deal counts,
used the effective-due and Sale open-due indexes for the shared banner path,
and rolled both deterministic fixtures back. The results are still far below
the 2,000 ms guard and do not justify a general Redis page or financial cache.

## Before versus this evidence

The adversarial audit recorded the previous hydration-heavy query shapes at
50,000 rows as 43.9 ms for open schedules, 10.52 ms for unpaid Sales, and
28.58 ms for current-month Sale/device cost. Those database timings excluded
the much larger cost of returning and processing every row in Node. With 100,000
open obligations, the browser-level Shop Hisobot response was 7.4 seconds and
the shared banner was 3.3–8.8 seconds.

The new evidence is materially different in the important way: expensive
full-set work remains inside PostgreSQL, aggregates cross the database boundary
as one row, and the ordered preview crosses it as five IDs plus five hydrated
rows. Sequential scans in the aggregate plans are not automatically defects:
for a fixture where one shop owns the entire 100,000-row set, PostgreSQL can
correctly choose a sequential scan. Bounded result cardinality, measured time,
and selective preview index use are the relevant checks.

## Remaining proof gaps

- Run the same benchmark against a disposable database with production-like
  tenant distribution and hardware; remote execution is intentionally blocked
  unless `ALLOW_REMOTE_PERF_DATABASE=yes` is explicitly provided.
- Capture Vercel function duration, database time, response size, and browser
  navigation timings after deployment.
- Exercise production-like concurrent load; this harness is single-client and
  does not prove pool behavior or P95/P99 under contention.
- Track query plans after material production data growth. Plan selection varied
  harmlessly between the two local runs for full-set aggregates.
- Keep the plan-equivalent benchmark SQL synchronized with
  `shop-stats-queries.ts`; the real integration tests remain the semantic guard.
