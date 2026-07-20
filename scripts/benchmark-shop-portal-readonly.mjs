#!/usr/bin/env node

/**
 * Read-only, privacy-safe Shop portal query benchmark.
 *
 * Loads no row values into the report. It discovers the busiest active shop,
 * runs SELECT/EXPLAIN only inside a READ ONLY transaction, and emits timings
 * plus plan summaries. The explicit confirmation makes accidental use clear:
 *
 * PERF_READONLY_CONFIRM=development-read-only npm run benchmark:shop-portal
 */

import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { parse } from 'dotenv'

const CONFIRMATION = 'development-read-only'
const iterations = Math.min(Math.max(Number(process.env.PERF_ITERATIONS ?? 15), 5), 50)

function fail(message) {
  console.error(`[shop-portal-benchmark] ${message}`)
  process.exit(1)
}

if (process.env.PERF_READONLY_CONFIRM !== CONFIRMATION) {
  fail(`PERF_READONLY_CONFIRM=${CONFIRMATION} is required`)
}
if (process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
  fail('benchmark execution is forbidden in production/Vercel environments')
}

let connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL
if (!connectionString) {
  try {
    const local = parse(readFileSync('.env.development.local'))
    connectionString = local.DATABASE_URL || local.DIRECT_URL
  } catch {
    // The error below explains the supported configuration.
  }
}
if (!connectionString) fail('DATABASE_URL or DIRECT_URL is required')

const queries = {
  old_sales_rows: `
    SELECT d."id", d."model", d."imei", d."updatedAt", latest_sale."sale_id"
    FROM "Device" d
    LEFT JOIN LATERAL (
      SELECT s."id" AS sale_id
      FROM "Sale" s
      WHERE s."deviceId" = d."id" AND s."deletedAt" IS NULL AND s."returnedAt" IS NULL
      ORDER BY s."createdAt" DESC
      LIMIT 1
    ) latest_sale ON true
    WHERE d."shopId" = $1 AND d."deletedAt" IS NULL
      AND d."status" IN ('SOLD_CASH', 'SOLD_DEBT')
    ORDER BY d."updatedAt" DESC
    LIMIT 50
  `,
  old_sales_count: `
    SELECT count(*)
    FROM "Device" d
    WHERE d."shopId" = $1 AND d."deletedAt" IS NULL
      AND d."status" IN ('SOLD_CASH', 'SOLD_DEBT')
  `,
  new_sales_page: `
    SELECT s."id", s."createdAt", s."contractSalePrice", s."contractRemainingAmount",
           d."id" AS device_id, d."model", d."imei", c."id" AS customer_id
    FROM "Sale" s
    JOIN "Device" d ON d."id" = s."deviceId" AND d."deletedAt" IS NULL
    JOIN "Customer" c ON c."id" = s."customerId"
    WHERE s."shopId" = $1 AND s."deletedAt" IS NULL AND s."returnedAt" IS NULL
    ORDER BY s."createdAt" DESC, s."id" DESC
    LIMIT 26
  `,
  devices_page: `
    SELECT d."id", d."model", d."imei", d."createdAt"
    FROM "Device" d
    WHERE d."shopId" = $1 AND d."deletedAt" IS NULL
    ORDER BY d."createdAt" DESC, d."id" DESC
    LIMIT 26
  `,
  nasiya_due_cohort: `
    SELECT n."id", min(coalesce(ns."delayedUntil", ns."dueDate")) AS next_due
    FROM "Nasiya" n
    JOIN "NasiyaSchedule" ns ON ns."nasiyaId" = n."id" AND ns."shopId" = n."shopId"
    WHERE n."shopId" = $1 AND n."deletedAt" IS NULL AND n."returnedAt" IS NULL
      AND n."status" <> 'CANCELLED'
      AND ns."status" IN ('PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED')
    GROUP BY n."id"
    ORDER BY next_due ASC, n."id" ASC
    LIMIT 26
  `,
  receivables_page: `
    SELECT s."id", s."dueDate", s."contractRemainingAmount"
    FROM "Sale" s
    WHERE s."shopId" = $1 AND s."deletedAt" IS NULL AND s."returnedAt" IS NULL
      AND s."paidFully" = false AND s."contractRemainingAmount" > 0
    ORDER BY s."dueDate" ASC NULLS LAST, s."id" ASC
    LIMIT 26
  `,
  supplier_payables_page: `
    SELECT p."id", p."dueDate", p."contractRemainingAmount", p."contractCurrency",
           d."id" AS device_id, d."model"
    FROM "SupplierPayable" p
    JOIN "Device" d ON d."id" = p."deviceId" AND d."shopId" = p."shopId" AND d."deletedAt" IS NULL
    WHERE p."shopId" = $1 AND p."deletedAt" IS NULL
      AND p."status" NOT IN ('PAID', 'CANCELLED')
      AND p."contractRemainingAmount" > 0
    ORDER BY p."dueDate" ASC, p."id" ASC
    LIMIT 19
  `,
  incoming_pay_later_page: `
    SELECT s."id", s."dueDate", s."contractRemainingAmount", s."contractCurrency",
           d."id" AS device_id, d."model", c."id" AS customer_id
    FROM "Sale" s
    JOIN "Device" d ON d."id" = s."deviceId" AND d."shopId" = s."shopId" AND d."deletedAt" IS NULL
    JOIN "Customer" c ON c."id" = s."customerId" AND c."shopId" = s."shopId" AND c."deletedAt" IS NULL
    WHERE s."shopId" = $1 AND s."deletedAt" IS NULL AND s."returnedAt" IS NULL
      AND s."paidFully" = false AND s."contractRemainingAmount" > 0
    ORDER BY s."dueDate" ASC, s."id" ASC
    LIMIT 19
  `,
  customers_page_with_counts: `
    SELECT c."id", c."createdAt",
      (SELECT count(*) FROM "Sale" s WHERE s."customerId" = c."id" AND s."deletedAt" IS NULL) AS sale_count,
      (SELECT count(*) FROM "Nasiya" n WHERE n."customerId" = c."id" AND n."deletedAt" IS NULL AND n."status" <> 'CANCELLED') AS nasiya_count
    FROM "Customer" c
    WHERE c."shopId" = $1 AND c."deletedAt" IS NULL
    ORDER BY c."createdAt" DESC, c."id" DESC
    LIMIT 25
  `,
  logs_page: `
    SELECT l."id", l."createdAt", l."action", l."actorId", l."targetType", l."targetId"
    FROM "Log" l
    WHERE l."shopId" = $1
    ORDER BY l."createdAt" DESC, l."id" DESC
    LIMIT 25
  `,
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function round(value) {
  return Math.round(value * 100) / 100
}

function planSummary(explainResult) {
  const document = explainResult.rows[0]['QUERY PLAN'][0]
  const indexes = new Set()
  const sequentialScans = []
  function visit(node) {
    if (node['Index Name']) indexes.add(node['Index Name'])
    if (node['Node Type'] === 'Seq Scan') sequentialScans.push(node['Relation Name'])
    for (const child of node.Plans ?? []) visit(child)
  }
  visit(document.Plan)
  return {
    planningMs: round(document['Planning Time']),
    executionMs: round(document['Execution Time']),
    indexes: [...indexes].sort(),
    sequentialScans: [...new Set(sequentialScans)].sort(),
  }
}

const client = new Client({ connectionString, application_name: 'oryx-shop-portal-readonly-benchmark' })
try {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  await client.query("SET LOCAL statement_timeout = '15000ms'")
  const shopResult = await client.query(`
    SELECT sh."id"
    FROM "Shop" sh
    LEFT JOIN "Sale" s ON s."shopId" = sh."id" AND s."deletedAt" IS NULL
    WHERE sh."deletedAt" IS NULL
    GROUP BY sh."id"
    ORDER BY count(s."id") DESC
    LIMIT 1
  `)
  const shopId = shopResult.rows[0]?.id
  if (!shopId) fail('no active Shop fixture was found')

  const debtSchemaResult = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'SupplierPayable'
        AND column_name = 'contractRemainingAmount'
    ) AS ready
  `)
  const skippedQueries = []
  if (!debtSchemaResult.rows[0]?.ready) {
    skippedQueries.push('supplier_payables_page', 'incoming_pay_later_page')
    delete queries.supplier_payables_page
    delete queries.incoming_pay_later_page
  }
  const report = { iterations, mode: 'READ ONLY', skippedQueries, queries: {} }
  for (const [name, sql] of Object.entries(queries)) {
    await client.query(sql, [shopId])
    const samples = []
    for (let index = 0; index < iterations; index += 1) {
      const start = performance.now()
      await client.query(sql, [shopId])
      samples.push(performance.now() - start)
    }
    const explain = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF, SUMMARY ON) ${sql}`,
      [shopId],
    )
    report.queries[name] = {
      p50Ms: round(percentile(samples, 0.5)),
      p75Ms: round(percentile(samples, 0.75)),
      p95Ms: round(percentile(samples, 0.95)),
      plan: planSummary(explain),
    }
  }
  const oldRows = report.queries.old_sales_rows
  const oldCount = report.queries.old_sales_count
  report.comparison = {
    oldSalesEstimatedParallelCriticalPathMs: {
      p50: Math.max(oldRows.p50Ms, oldCount.p50Ms),
      p75: Math.max(oldRows.p75Ms, oldCount.p75Ms),
      p95: Math.max(oldRows.p95Ms, oldCount.p95Ms),
    },
    newSalesMs: {
      p50: report.queries.new_sales_page.p50Ms,
      p75: report.queries.new_sales_page.p75Ms,
      p95: report.queries.new_sales_page.p95Ms,
    },
    oldQueryCount: 2,
    newQueryCount: 1,
  }
  console.log(JSON.stringify(report, null, 2))
  await client.query('ROLLBACK')
} catch (error) {
  try { await client.query('ROLLBACK') } catch {}
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await client.end()
}
