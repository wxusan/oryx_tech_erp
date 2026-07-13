#!/usr/bin/env node
/**
 * DB command safety guard.
 *
 * Prevents the two classic footguns against the shared/production database:
 *   - `prisma db push`     (drops the raw-SQL partial unique indexes as "drift")
 *   - `prisma migrate dev` (rewrites migration history; not for prod)
 *
 * Usage (wired via package.json):
 *   node scripts/check-db-safety.mjs push               -> always blocks
 *   node scripts/check-db-safety.mjs push --allow-local -> allows ONLY a local DB
 *   node scripts/check-db-safety.mjs migrate-dev        -> blocks in prod
 *
 * Exit 0 = safe to proceed, exit 1 = blocked (with a clear message).
 */

const command = process.argv[2] ?? ''
const allowLocal = process.argv.includes('--allow-local')

// Load .env files the same way the app does, best-effort (no hard dependency).
async function loadEnv() {
  try {
    const dotenv = await import('dotenv')
    const explicitDatabaseUrl = process.env.DATABASE_URL
    const explicitDirectUrl = process.env.DIRECT_URL
    dotenv.config({ path: '.env' })
    dotenv.config({ path: '.env.local', override: true })
    if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl
    if (explicitDirectUrl !== undefined) process.env.DIRECT_URL = explicitDirectUrl
  } catch {
    // dotenv not available — rely on the already-exported environment.
  }
}

function hostOf(url) {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

function isLocalHost(host) {
  return host != null && LOCAL_HOSTS.has(host)
}

function isProdEnv() {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    Boolean(process.env.VERCEL_ENV)
  )
}

function block(lines) {
  console.error('\n\x1b[41m\x1b[97m BLOCKED \x1b[0m ' + lines[0])
  for (const line of lines.slice(1)) console.error('          ' + line)
  console.error('')
  process.exit(1)
}

await loadEnv()

const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
const host = hostOf(dbUrl)
const local = isLocalHost(host)

if (command === 'push') {
  if (!allowLocal) {
    block([
      '`prisma db push` is disabled for this project.',
      'It would drop the raw-SQL partial unique indexes (active IMEI / phone) as drift.',
      'For a LOCAL dev database:  npm run db:push:local',
      'For staging / production:  npm run prisma:migrate:deploy',
    ])
  }
  if (isProdEnv()) {
    block([
      '`db push` blocked: production environment detected (NODE_ENV / VERCEL).',
      'Use migrations:  npm run prisma:migrate:deploy',
    ])
  }
  if (!local) {
    block([
      `\`db push\` blocked: DATABASE_URL host "${host ?? 'unknown'}" is not local.`,
      'db:push:local only permits localhost / 127.0.0.1.',
      'For shared/prod DBs use:  npm run prisma:migrate:deploy',
    ])
  }
  console.log(`[db-safety] OK: local db push permitted (host=${host}).`)
  process.exit(0)
}

if (command === 'migrate-dev') {
  if (isProdEnv() || (!local && host !== null)) {
    block([
      '`prisma migrate dev` is not allowed against a shared/production database.',
      `Detected host: ${host ?? 'unknown'}${isProdEnv() ? ' (production env)' : ''}.`,
      'Create migrations locally, then deploy with:  npm run prisma:migrate:deploy',
    ])
  }
  console.log(`[db-safety] OK: migrate dev permitted (host=${host ?? 'unknown'}).`)
  process.exit(0)
}

block([
  `Unknown db-safety command: "${command}".`,
  'Expected one of: push | push --allow-local | migrate-dev',
])
