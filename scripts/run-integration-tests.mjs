#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { Client } from 'pg'

const databaseUrl = process.env.TEST_DATABASE_URL
const RESET_CONFIRMATION = 'reset-disposable-integration-database'

function fail(message) {
  console.error(`[integration-db] ${message}`)
  process.exit(1)
}

if (!databaseUrl) fail('TEST_DATABASE_URL is required')

let parsed
try {
  parsed = new URL(databaseUrl)
} catch {
  fail('TEST_DATABASE_URL is not a valid PostgreSQL URL')
}

if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  fail('TEST_DATABASE_URL must use postgres:// or postgresql://')
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
const isLocal = localHosts.has(parsed.hostname.toLowerCase())
const remoteExplicitlyAllowed = process.env.ALLOW_REMOTE_TEST_DATABASE === 'yes'
if (!isLocal && !remoteExplicitlyAllowed) {
  fail('Remote test databases require ALLOW_REMOTE_TEST_DATABASE=yes')
}

if (process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production') {
  fail('Integration database reset is forbidden in a Vercel production environment')
}

const shouldReset = process.env.INTEGRATION_DB_RESET === 'yes'
if (shouldReset && process.env.TEST_DATABASE_CONFIRM !== RESET_CONFIRMATION) {
  fail(`Reset requires TEST_DATABASE_CONFIRM=${RESET_CONFIRMATION}`)
}

if (shouldReset) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('DROP SCHEMA public CASCADE')
    await client.query('CREATE SCHEMA public')
  } finally {
    await client.end()
  }
  console.log('[integration-db] disposable public schema reset')
}

const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: 'test',
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  'prisma',
  'migrate',
  'deploy',
  '--config',
  'prisma.integration.config.ts',
])
run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', '--config', 'vitest.integration.config.ts'])
