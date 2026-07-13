#!/usr/bin/env node

/**
 * Repeatable disposable-PostgreSQL benchmark for the set-based Shop stats and
 * due/overdue queries in src/lib/server/shop-stats-queries.ts.
 *
 * The fixture is inserted inside one transaction and ALWAYS rolled back. The
 * script refuses an unmarked database and requires an explicit confirmation:
 *
 * TEST_DATABASE_URL=postgresql://.../oryx_stats_benchmark \
 * PERF_DB_CONFIRM=benchmark-disposable-obligation-database \
 * npm run benchmark:shop-stats
 */

import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { Client } from 'pg'

const CONFIRMATION = 'benchmark-disposable-obligation-database'
const DEFAULT_OBLIGATIONS = 100_000
const MIN_OBLIGATIONS = 50_000
const MAX_OBLIGATIONS = 100_000
const DEFAULT_ITERATIONS = 5
const FIXTURE = 'perf_stats_20260713'

function fail(message) {
  console.error(`[shop-stats-benchmark] ${message}`)
  process.exit(1)
}

function boundedInteger(raw, fallback, minimum, maximum) {
  const parsed = Number(raw ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`expected an integer between ${minimum} and ${maximum}, received ${raw ?? fallback}`)
  }
  return parsed
}

const connectionString = process.env.TEST_DATABASE_URL
if (!connectionString) fail('TEST_DATABASE_URL is required')
if (process.env.PERF_DB_CONFIRM !== CONFIRMATION) {
  fail(`PERF_DB_CONFIRM=${CONFIRMATION} is required`)
}
if (process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
  fail('benchmark execution is forbidden in production/Vercel environments')
}

let databaseUrl
try {
  databaseUrl = new URL(connectionString)
} catch {
  fail('TEST_DATABASE_URL must be a valid PostgreSQL URL')
}
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  fail('TEST_DATABASE_URL must use postgres:// or postgresql://')
}

const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
const isLocal = localHosts.has(databaseUrl.hostname.toLowerCase())
if (!isLocal && process.env.ALLOW_REMOTE_PERF_DATABASE !== 'yes') {
  fail('remote benchmark databases require ALLOW_REMOTE_PERF_DATABASE=yes')
}
if (!/(test|perf|bench|benchmark|disposable|integration)/i.test(databaseName)) {
  fail(`database name "${databaseName}" is not marked test/perf/benchmark/disposable`)
}

const obligationCount = boundedInteger(
  process.env.PERF_OBLIGATION_COUNT,
  DEFAULT_OBLIGATIONS,
  MIN_OBLIGATIONS,
  MAX_OBLIGATIONS,
)
const iterations = boundedInteger(process.env.PERF_ITERATIONS, DEFAULT_ITERATIONS, 1, 20)
const maxMedianMs = boundedInteger(process.env.PERF_MAX_MEDIAN_MS, 2_000, 1, 60_000)
const saleCount = Math.floor(obligationCount / 2)
const nasiyaCount = obligationCount - saleCount

const ownerId = `${FIXTURE}_owner`
const shopId = `${FIXTURE}_shop`
const customerId = `${FIXTURE}_customer`
const benchmarkNow = new Date('2026-07-13T00:00:00.000Z')
const monthStart = new Date('2026-06-30T19:00:00.000Z')
const monthEnd = new Date('2026-07-31T19:00:00.000Z')
const todayStart = new Date('2026-07-12T19:00:00.000Z')

const accrualSql = `
  WITH sale_agg AS (
    SELECT
      count(*)::integer AS sale_count,
      coalesce(sum(s."salePrice"), 0)::numeric AS sale_revenue_uzs,
      coalesce(sum(d."purchasePrice"), 0)::numeric AS sale_device_cost_uzs
    FROM "Sale" s
    JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId"
    WHERE s."shopId" = $1
      AND s."deletedAt" IS NULL
      AND s."createdAt" >= $2
      AND s."createdAt" < $3
  ), nasiya_agg AS (
    SELECT
      coalesce(sum(n."totalAmount"), 0)::numeric AS nasiya_revenue_uzs,
      coalesce(sum(n."interestAmount"), 0)::numeric AS nasiya_interest_uzs,
      coalesce(sum(d."purchasePrice"), 0)::numeric AS nasiya_device_cost_uzs
    FROM "Nasiya" n
    JOIN "Device" d ON d."id" = n."deviceId" AND d."shopId" = n."shopId"
    WHERE n."shopId" = $1
      AND n."deletedAt" IS NULL
      AND n."isImported" = false
      AND n."createdAt" >= $2
      AND n."createdAt" < $3
  )
  SELECT * FROM sale_agg CROSS JOIN nasiya_agg
`

const obligationSql = `
  WITH schedule_rows AS (
    SELECT
      n."id" AS nasiya_id,
      n."status" AS nasiya_status,
      n."contractCurrency" AS currency,
      coalesce(s."delayedUntil", s."dueDate") AS effective_due,
      CASE
        WHEN n."contractCurrency" = 'USD'
          AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
          THEN s."contractExpectedAmount" - s."contractPaidAmount"
        WHEN n."contractCurrency" = 'UZS'
          AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
          THEN s."contractExpectedAmount" - s."contractPaidAmount"
        ELSE 0
      END AS outstanding
    FROM "NasiyaSchedule" s
    JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
    WHERE s."shopId" = $1
      AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
      AND n."deletedAt" IS NULL
      AND n."status" <> 'CANCELLED'
  ), schedule_agg AS (
    SELECT
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'UZS' AND effective_due >= $2 AND effective_due < $3
      ), 0)::numeric AS expected_uzs,
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'USD' AND effective_due >= $2 AND effective_due < $3
      ), 0)::numeric AS expected_usd,
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'UZS' AND effective_due < $4
      ), 0)::numeric AS overdue_uzs,
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'USD' AND effective_due < $4
      ), 0)::numeric AS overdue_usd,
      count(*) FILTER (WHERE outstanding > 0 AND effective_due < $4)::integer AS overdue_count,
      count(DISTINCT nasiya_id) FILTER (
        WHERE nasiya_status = 'COMPLETED' AND outstanding > 0
      )::integer AS false_completed_count
    FROM schedule_rows
  ), sale_rows AS (
    SELECT s."contractCurrency" AS currency,
           s."dueDate" AS effective_due,
           s."contractRemainingAmount" AS outstanding
    FROM "Sale" s
    WHERE s."shopId" = $1
      AND s."deletedAt" IS NULL
      AND s."returnedAt" IS NULL
      AND s."paidFully" = false
      AND s."contractRemainingAmount" > 0
  ), sale_agg AS (
    SELECT
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'UZS' AND effective_due >= $2 AND effective_due < $3
      ), 0)::numeric AS expected_uzs,
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'USD' AND effective_due >= $2 AND effective_due < $3
      ), 0)::numeric AS expected_usd,
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'UZS' AND effective_due < $4
      ), 0)::numeric AS overdue_uzs,
      coalesce(sum(outstanding) FILTER (
        WHERE currency = 'USD' AND effective_due < $4
      ), 0)::numeric AS overdue_usd,
      count(*) FILTER (WHERE effective_due < $4)::integer AS overdue_count
    FROM sale_rows
  )
  SELECT
    schedule_agg.expected_uzs + sale_agg.expected_uzs AS expected_uzs,
    schedule_agg.expected_usd + sale_agg.expected_usd AS expected_usd,
    schedule_agg.overdue_uzs + sale_agg.overdue_uzs AS overdue_uzs,
    schedule_agg.overdue_usd + sale_agg.overdue_usd AS overdue_usd,
    schedule_agg.overdue_count + sale_agg.overdue_count AS overdue_count,
    schedule_agg.false_completed_count AS false_completed_count
  FROM schedule_agg CROSS JOIN sale_agg
`

const overdueSummarySql = `
  WITH nasiya_deals AS (
    SELECT
      'nasiya'::text AS deal_type,
      n."id" AS deal_id,
      n."contractCurrency" AS currency,
      sum(CASE
        WHEN n."contractCurrency" = 'USD'
          AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
          THEN s."contractExpectedAmount" - s."contractPaidAmount"
        WHEN n."contractCurrency" = 'UZS'
          AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
          THEN s."contractExpectedAmount" - s."contractPaidAmount"
        ELSE 0
      END)::numeric AS outstanding
    FROM "NasiyaSchedule" s
    JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
    WHERE s."shopId" = $1
      AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
      AND coalesce(s."delayedUntil", s."dueDate") < $2
      AND n."deletedAt" IS NULL
      AND n."returnedAt" IS NULL
      AND n."status" <> 'CANCELLED'
    GROUP BY n."id", n."contractCurrency"
    HAVING sum(CASE
      WHEN n."contractCurrency" = 'USD'
        AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01
        THEN s."contractExpectedAmount" - s."contractPaidAmount"
      WHEN n."contractCurrency" = 'UZS'
        AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1
        THEN s."contractExpectedAmount" - s."contractPaidAmount"
      ELSE 0
    END) > 0
  ), sale_deals AS (
    SELECT
      'sale'::text AS deal_type,
      s."id" AS deal_id,
      s."contractCurrency" AS currency,
      s."contractRemainingAmount"::numeric AS outstanding
    FROM "Sale" s
    WHERE s."shopId" = $1
      AND s."deletedAt" IS NULL
      AND s."returnedAt" IS NULL
      AND s."paidFully" = false
      AND s."contractRemainingAmount" > 0
      AND s."dueDate" < $2
  ), overdue_deals AS (
    SELECT * FROM nasiya_deals
    UNION ALL
    SELECT * FROM sale_deals
  )
  SELECT
    coalesce(sum(outstanding) FILTER (WHERE currency = 'UZS'), 0)::numeric AS overdue_native_uzs,
    coalesce(sum(outstanding) FILTER (WHERE currency = 'USD'), 0)::numeric AS overdue_native_usd,
    count(*)::integer AS deal_count,
    CASE WHEN count(*) = 1 THEN min(deal_type) END AS single_type,
    CASE WHEN count(*) = 1 THEN min(deal_id) END AS single_id
  FROM overdue_deals
`

const upcomingSql = `
  SELECT s."id"
  FROM "NasiyaSchedule" s
  JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
  WHERE s."shopId" = $1
    AND s."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
    AND n."deletedAt" IS NULL
    AND n."returnedAt" IS NULL
    AND n."status" <> 'CANCELLED'
    AND (
      (n."contractCurrency" = 'USD' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 0.01)
      OR (n."contractCurrency" = 'UZS' AND s."contractExpectedAmount" - s."contractPaidAmount" >= 1)
    )
  ORDER BY coalesce(s."delayedUntil", s."dueDate") ASC, s."id" ASC
  LIMIT 5
`

const hydrateSql = `
  SELECT s."id", s."dueDate", s."delayedUntil", s."expectedAmount", s."paidAmount",
         s."status", s."contractExpectedAmount", s."contractPaidAmount",
         n."id" AS nasiya_id, n."contractCurrency"
  FROM "NasiyaSchedule" s
  JOIN "Nasiya" n ON n."id" = s."nasiyaId" AND n."shopId" = s."shopId"
  WHERE s."shopId" = $1 AND s."id" = ANY($2::text[])
`

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function planEvidence(explainRow) {
  const document = explainRow['QUERY PLAN'][0]
  const indexes = new Set()
  const nodeTypes = new Set()
  const sequentialScans = []

  function visit(node) {
    nodeTypes.add(node['Node Type'])
    if (node['Index Name']) indexes.add(node['Index Name'])
    if (node['Node Type'] === 'Seq Scan') {
      sequentialScans.push({
        relation: node['Relation Name'],
        actualRows: node['Actual Rows'],
        rowsRemovedByFilter: node['Rows Removed by Filter'] ?? 0,
      })
    }
    for (const child of node.Plans ?? []) visit(child)
  }
  visit(document.Plan)

  return {
    planningMs: document['Planning Time'],
    executionMs: document['Execution Time'],
    actualRows: document.Plan['Actual Rows'],
    sharedHitBlocks: document.Plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: document.Plan['Shared Read Blocks'] ?? 0,
    indexes: [...indexes].sort(),
    nodeTypes: [...nodeTypes].sort(),
    sequentialScans,
  }
}

async function benchmarkQuery(client, definition) {
  const warm = await client.query(definition.sql, definition.params)
  if (definition.expectedRows !== undefined && warm.rowCount !== definition.expectedRows) {
    throw new Error(`${definition.name}: expected ${definition.expectedRows} wire rows, got ${warm.rowCount}`)
  }

  const samples = []
  let latest = warm
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now()
    latest = await client.query(definition.sql, definition.params)
    samples.push(performance.now() - startedAt)
  }

  const explained = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF, SUMMARY ON) ${definition.sql}`,
    definition.params,
  )
  const plan = planEvidence(explained.rows[0])
  const medianMs = percentile(samples, 0.5)
  if (medianMs > maxMedianMs) {
    throw new Error(`${definition.name}: median ${medianMs.toFixed(3)} ms exceeded ${maxMedianMs} ms`)
  }

  for (const requiredIndex of definition.requiredIndexes ?? []) {
    if (!plan.indexes.includes(requiredIndex)) {
      throw new Error(`${definition.name}: expected plan to use ${requiredIndex}; used ${plan.indexes.join(', ') || 'no index'}`)
    }
  }

  return {
    name: definition.name,
    wireRows: latest.rowCount,
    medianMs: Number(medianMs.toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    minMs: Number(Math.min(...samples).toFixed(3)),
    maxMs: Number(Math.max(...samples).toFixed(3)),
    plan,
    sample: definition.summarize(latest.rows),
  }
}

const client = new Client({ connectionString, application_name: 'oryx-shop-stats-benchmark' })
const startedAt = performance.now()
let rolledBack = false

try {
  await client.connect()
  const version = await client.query('SELECT version() AS version')
  await client.query("SET statement_timeout = '120s'")
  await client.query("SET lock_timeout = '5s'")
  await client.query('BEGIN')

  await client.query(`
    INSERT INTO "SuperAdmin" ("id", "name", "login", "passwordHash", "createdAt", "updatedAt")
    VALUES ($1, 'Performance owner', $1, 'benchmark-only', $2, $2)
  `, [ownerId, benchmarkNow])
  await client.query(`
    INSERT INTO "Shop" (
      "id", "name", "ownerName", "ownerPhone", "shopNumber", "address",
      "subscriptionDue", "createdById", "createdAt", "updatedAt"
    ) VALUES ($1, 'Performance shop', 'Performance owner', '+998901234567', $1,
      'Disposable benchmark', '2099-01-01T00:00:00.000Z', $2, $3, $3)
  `, [shopId, ownerId, benchmarkNow])
  await client.query(`
    INSERT INTO "Customer" ("id", "shopId", "name", "phone", "normalizedPhone", "createdAt")
    VALUES ($1, $2, 'Performance customer', '+998909999999', '998909999999', $3)
  `, [customerId, shopId, benchmarkNow])

  const seedStartedAt = performance.now()
  await client.query(`
    INSERT INTO "Device" (
      "id", "shopId", "model", "purchasePrice", "purchaseInputAmount",
      "purchaseAmountUzsSnapshot", "imei", "imageUrls", "status", "addedBy",
      "createdAt", "updatedAt"
    )
    SELECT
      '${FIXTURE}_device_' || lpad(g::text, 6, '0'), $1, 'Performance device ' || g,
      600000, 600000, 600000, '${FIXTURE}_imei_' || lpad(g::text, 6, '0'),
      ARRAY[]::text[],
      (CASE WHEN g <= $2 THEN 'SOLD_DEBT' ELSE 'SOLD_NASIYA' END)::"DeviceStatus",
      $3,
      $4::timestamp + make_interval(days => (g % 28)::int),
      $4::timestamp + make_interval(days => (g % 28)::int)
    FROM generate_series(1, $5) AS g
  `, [shopId, saleCount, ownerId, monthStart, obligationCount])

  await client.query(`
    INSERT INTO "Sale" (
      "id", "shopId", "deviceId", "customerId", "salePrice", "paymentMethod",
      "paidFully", "amountPaid", "remainingAmount", "dueDate", "reminderEnabled",
      "contractCurrency", "contractExchangeRateAtCreation", "contractSalePrice",
      "contractAmountPaid", "contractRemainingAmount", "createdAt", "createdBy"
    )
    SELECT
      '${FIXTURE}_sale_' || lpad(g::text, 6, '0'),
      $1,
      '${FIXTURE}_device_' || lpad(g::text, 6, '0'),
      $2,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      'CASH'::"PaymentMethod", false, 0,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      $3::timestamp + make_interval(days => ((g % 60)::int - 30)),
      true,
      (CASE WHEN g % 2 = 0 THEN 'USD' ELSE 'UZS' END)::"CurrencyCode",
      CASE WHEN g % 2 = 0 THEN 12500 ELSE NULL END,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      0,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      $4::timestamp + make_interval(days => (g % 28)::int),
      $5
    FROM generate_series(1, $6) AS g
  `, [shopId, customerId, todayStart, monthStart, ownerId, saleCount])

  await client.query(`
    INSERT INTO "Nasiya" (
      "id", "shopId", "deviceId", "customerId", "totalAmount", "downPayment",
      "baseRemainingAmount", "interestPercent", "interestAmount", "finalNasiyaAmount",
      "remainingAmount", "months", "monthlyPayment", "startDate", "status",
      "contractCurrency", "contractExchangeRateAtCreation", "contractTotalAmount",
      "contractDownPayment", "contractBaseRemainingAmount", "contractInterestAmount",
      "contractFinalAmount", "contractMonthlyPayment", "contractRemainingAmount",
      "contractPaidAmount", "createdAt", "createdBy", "updatedAt"
    )
    SELECT
      '${FIXTURE}_nasiya_' || lpad(g::text, 6, '0'),
      $1,
      '${FIXTURE}_device_' || lpad(($2 + g)::text, 6, '0'),
      $3,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      0,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      0, 0,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      1,
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      $4,
      (CASE WHEN (g % 60) < 30 THEN 'OVERDUE' ELSE 'ACTIVE' END)::"NasiyaStatus",
      (CASE WHEN g % 2 = 0 THEN 'USD' ELSE 'UZS' END)::"CurrencyCode",
      CASE WHEN g % 2 = 0 THEN 12500 ELSE NULL END,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      0,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      0,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      0,
      $5::timestamp + make_interval(days => (g % 28)::int),
      $6,
      $5::timestamp + make_interval(days => (g % 28)::int)
    FROM generate_series(1, $7) AS g
  `, [shopId, saleCount, customerId, monthStart, monthStart, ownerId, nasiyaCount])

  await client.query(`
    INSERT INTO "NasiyaSchedule" (
      "id", "nasiyaId", "shopId", "monthNumber", "dueDate", "expectedAmount",
      "paidAmount", "status", "contractCurrency", "contractExpectedAmount",
      "contractPaidAmount", "contractRemainingAmount", "createdAt"
    )
    SELECT
      '${FIXTURE}_schedule_' || lpad(g::text, 6, '0'),
      '${FIXTURE}_nasiya_' || lpad(g::text, 6, '0'),
      $1,
      1,
      $2::timestamp + make_interval(days => ((g % 60)::int - 30)),
      CASE WHEN g % 2 = 0 THEN 1250000 ELSE 1000000 END,
      0,
      (CASE WHEN (g % 60) < 30 THEN 'OVERDUE' ELSE 'PENDING' END)::"NasiyaScheduleStatus",
      (CASE WHEN g % 2 = 0 THEN 'USD' ELSE 'UZS' END)::"CurrencyCode",
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      0,
      CASE WHEN g % 2 = 0 THEN 100 ELSE 1000000 END,
      $3
    FROM generate_series(1, $4) AS g
  `, [shopId, todayStart, monthStart, nasiyaCount])

  await client.query('ANALYZE "Device", "Sale", "Nasiya", "NasiyaSchedule"')
  const seedMs = performance.now() - seedStartedAt

  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM "Sale" WHERE "shopId" = $1) AS sales,
      (SELECT count(*) FROM "Nasiya" WHERE "shopId" = $1) AS nasiyas,
      (SELECT count(*) FROM "NasiyaSchedule" WHERE "shopId" = $1) AS schedules
  `, [shopId])
  if (Number(counts.rows[0].sales) + Number(counts.rows[0].schedules) !== obligationCount) {
    throw new Error('fixture obligation count does not match PERF_OBLIGATION_COUNT')
  }

  const accrual = await benchmarkQuery(client, {
    name: 'getShopAccrualAggregate',
    sql: accrualSql,
    params: [shopId, monthStart, monthEnd],
    expectedRows: 1,
    summarize: (rows) => ({ saleCount: Number(rows[0].sale_count) }),
  })
  if (accrual.sample.saleCount !== saleCount) throw new Error('accrual sale count is incomplete')

  const obligations = await benchmarkQuery(client, {
    name: 'getShopObligationAggregate',
    sql: obligationSql,
    params: [shopId, monthStart, monthEnd, todayStart],
    expectedRows: 1,
    summarize: (rows) => ({
      overdueCount: Number(rows[0].overdue_count),
      expectedUzs: Number(rows[0].expected_uzs),
      expectedUsd: Number(rows[0].expected_usd),
    }),
  })

  const overdue = await benchmarkQuery(client, {
    name: 'getCurrentOverdueSummary',
    sql: overdueSummarySql,
    params: [shopId, todayStart],
    expectedRows: 1,
    summarize: (rows) => ({ overdueDealCount: Number(rows[0].deal_count) }),
  })
  if (overdue.sample.overdueDealCount !== obligations.sample.overdueCount) {
    throw new Error('dashboard overdue count and banner deal count diverged for one-schedule fixtures')
  }

  const upcoming = await benchmarkQuery(client, {
    name: 'getUpcomingScheduleIds',
    sql: upcomingSql,
    params: [shopId],
    expectedRows: 5,
    requiredIndexes: ['NasiyaSchedule_shopId_effectiveDue_open_idx'],
    summarize: (rows) => ({ ids: rows.map((row) => row.id) }),
  })

  const hydration = await benchmarkQuery(client, {
    name: 'boundedUpcomingHydration',
    sql: hydrateSql,
    params: [shopId, upcoming.sample.ids],
    expectedRows: 5,
    requiredIndexes: ['NasiyaSchedule_pkey'],
    summarize: (rows) => ({ hydratedRows: rows.length }),
  })

  const report = {
    environment: {
      host: databaseUrl.hostname,
      database: databaseName,
      postgres: version.rows[0].version,
      node: process.version,
    },
    fixture: {
      obligations: obligationCount,
      sales: saleCount,
      nasiyas: nasiyaCount,
      schedules: nasiyaCount,
      seedMs: Number(seedMs.toFixed(3)),
      transactionPolicy: 'rollback-on-exit',
    },
    policy: {
      iterations,
      maxMedianMs,
      aggregateWireRows: 1,
      boundedUpcomingRows: 5,
    },
    results: [accrual, obligations, overdue, upcoming, hydration],
    totalWallMs: Number((performance.now() - startedAt).toFixed(3)),
  }

  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error('[shop-stats-benchmark] failed', error)
  process.exitCode = 1
} finally {
  try {
    await client.query('ROLLBACK')
    rolledBack = true
  } catch (error) {
    console.error('[shop-stats-benchmark] rollback failed', error)
    process.exitCode = 1
  }
  await client.end().catch(() => {})
  if (!rolledBack) process.exitCode = 1
}
