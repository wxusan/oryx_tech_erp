#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { Client } from 'pg'

const MIGRATION = '202607150004_complete_accounting_redesign'
const CONFIRMATION = `resolve-failed-${MIGRATION}`

function fail(message) {
  console.error(`[migration-resolution] ${message}`)
  process.exit(1)
}

if (process.env.GITHUB_ACTIONS !== 'true') {
  fail('This one-time resolver may run only inside the guarded GitHub Actions release environment')
}
if (process.env.ORYX_FAILED_MIGRATION_RESOLUTION !== CONFIRMATION) {
  fail(`Explicit confirmation ${CONFIRMATION} is required`)
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) fail('DIRECT_URL or DATABASE_URL is required')

async function inspect() {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const [failed, artifacts] = await Promise.all([
      client.query(
        `SELECT "id"
         FROM "_prisma_migrations"
         WHERE "migration_name" = $1
           AND "finished_at" IS NULL
           AND "rolled_back_at" IS NULL`,
        [MIGRATION],
      ),
      client.query(
        `SELECT COUNT(*)::integer AS count
         FROM (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (
               (table_name = 'SuperAdmin' AND column_name = 'preferredCurrency')
               OR (table_name = 'Sale' AND column_name IN ('creationIdempotencyKey', 'creationCommandHash'))
               OR (table_name = 'ShopPayment' AND column_name IN (
                 'exchangeRateAtPayment',
                 'amountUzsSnapshot',
                 'amountUsdSnapshot',
                 'currencyReconstructionStatus'
               ))
             )
           UNION ALL
           SELECT 1
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'Sale_shopId_creationIdempotencyKey_key'
         ) release_artifacts`,
      ),
    ])
    return {
      activeFailedRows: failed.rowCount ?? 0,
      releaseArtifactCount: Number(artifacts.rows[0]?.count ?? 0),
    }
  } finally {
    await client.end()
  }
}

const before = await inspect()
if (before.activeFailedRows !== 1) {
  fail(`Expected exactly one active failed ${MIGRATION} record; found ${before.activeFailedRows}`)
}
if (before.releaseArtifactCount !== 0) {
  fail(`Refusing resolution because ${before.releaseArtifactCount} release schema artifacts survived the failed transaction`)
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const resolved = spawnSync(command, [
  'prisma',
  'migrate',
  'resolve',
  '--rolled-back',
  MIGRATION,
  '--config',
  'prisma.config.ts',
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false,
})

if (resolved.error) fail(resolved.error.message)
if (resolved.status !== 0) process.exit(resolved.status ?? 1)

const after = await inspect()
if (after.activeFailedRows !== 0 || after.releaseArtifactCount !== 0) {
  fail('Post-resolution verification failed')
}

console.log(JSON.stringify({
  event: 'migration_resolution_complete',
  migration: MIGRATION,
  resolvedFailedRows: 1,
  releaseArtifactCount: 0,
}))
