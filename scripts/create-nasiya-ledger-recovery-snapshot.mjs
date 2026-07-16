/**
 * Create a verified, read-only recovery snapshot for one Nasiya before a
 * ledger-cache repair. The snapshot is deliberately scoped: the repair can
 * modify only parent cache fields, and this captures that parent plus all
 * direct ledger evidence needed to review or restore it.
 *
 * It writes a mode-0600 gzipped JSON file under .local-backups (gitignored),
 * then immediately re-reads and checksum-verifies it. No database row is
 * changed by this command.
 */

import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { gzipSync, gunzipSync } from 'node:zlib'
import pg from 'pg'

async function loadEnv() {
  const explicitDatabaseUrl = process.env.DATABASE_URL?.trim() || null
  const explicitDirectUrl = process.env.DIRECT_URL?.trim() || null
  try {
    const dotenv = await import('dotenv')
    const environment = process.env.NODE_ENV || 'development'
    for (const file of ['.env.local', `.env.${environment}.local`, `.env.${environment}`, '.env']) {
      try {
        const parsed = dotenv.parse(readFileSync(file))
        for (const key of ['DIRECT_URL', 'DATABASE_URL']) {
          const candidate = parsed[key]?.trim()
          const value = candidate?.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2').trim()
          if (value && !process.env[key]) process.env[key] = value
        }
      } catch {
        // Optional local environment file.
      }
    }
  } catch {
    // Explicit environment variables are still supported without dotenv.
  }
  if (explicitDatabaseUrl) process.env.DATABASE_URL = explicitDatabaseUrl
  if (explicitDirectUrl) process.env.DIRECT_URL = explicitDirectUrl
}

function option(name) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) || null
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function tableCounts(tables) {
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]))
}

await loadEnv()

const nasiyaId = option('nasiya-id')
if (!nasiyaId || !/^[A-Za-z0-9_-]+$/.test(nasiyaId)) {
  throw new Error('--nasiya-id must be a non-empty Oryx identifier')
}

const rawDatabaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!rawDatabaseUrl) throw new Error('DIRECT_URL or DATABASE_URL is required')

const databaseUrl = new URL(rawDatabaseUrl)
databaseUrl.searchParams.delete('schema')
const client = new pg.Client({ connectionString: databaseUrl.toString() })

const outputDirectory = '.local-backups'
const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
const outputFile = `${outputDirectory}/nasiya-ledger-pre-repair-${nasiyaId}-${stamp}.json.gz`

await client.connect()
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  // pg.Client intentionally serializes statements on one connection. Keep
  // these reads sequential inside the read-only repeatable-read transaction,
  // rather than using Promise.all and risking a driver-version behavior change.
  const metadata = await client.query('SELECT current_database() AS database_name, current_setting(\'server_version\') AS server_version')
  const nasiya = await client.query('SELECT to_jsonb(n)::text AS row FROM "Nasiya" n WHERE n.id = $1', [nasiyaId])
  const schedules = await client.query('SELECT to_jsonb(s)::text AS row FROM "NasiyaSchedule" s WHERE s."nasiyaId" = $1 ORDER BY s."monthNumber", s.id', [nasiyaId])
  const payments = await client.query('SELECT to_jsonb(p)::text AS row FROM "NasiyaPayment" p WHERE p."nasiyaId" = $1 ORDER BY p."paidAt", p.id', [nasiyaId])
  const allocations = await client.query('SELECT to_jsonb(a)::text AS row FROM "NasiyaPaymentAllocation" a WHERE a."nasiyaId" = $1 ORDER BY a.id', [nasiyaId])
  const deferrals = await client.query('SELECT to_jsonb(d)::text AS row FROM "NasiyaDeferral" d WHERE d."nasiyaId" = $1 ORDER BY d."createdAt", d.id', [nasiyaId])
  const resolutionEvents = await client.query('SELECT to_jsonb(e)::text AS row FROM "NasiyaResolutionEvent" e WHERE e."nasiyaId" = $1 ORDER BY e."createdAt", e.id', [nasiyaId])
  const logs = await client.query('SELECT to_jsonb(l)::text AS row FROM "Log" l WHERE l."targetType" = $2 AND l."targetId" = $1 ORDER BY l."createdAt", l.id', [nasiyaId, 'Nasiya'])
  await client.query('COMMIT')

  const tables = {
    Nasiya: nasiya.rows.map(({ row }) => JSON.parse(row)),
    NasiyaSchedule: schedules.rows.map(({ row }) => JSON.parse(row)),
    NasiyaPayment: payments.rows.map(({ row }) => JSON.parse(row)),
    NasiyaPaymentAllocation: allocations.rows.map(({ row }) => JSON.parse(row)),
    NasiyaDeferral: deferrals.rows.map(({ row }) => JSON.parse(row)),
    NasiyaResolutionEvent: resolutionEvents.rows.map(({ row }) => JSON.parse(row)),
    Log: logs.rows.map(({ row }) => JSON.parse(row)),
  }
  if (tables.Nasiya.length !== 1) throw new Error('Nasiya was not found exactly once; snapshot was not written')

  const unsigned = {
    format: 'oryx-nasiya-ledger-recovery-snapshot/v1',
    takenAt: new Date().toISOString(),
    database: {
      host: databaseUrl.hostname,
      port: databaseUrl.port || 'default',
      name: metadata.rows[0]?.database_name ?? null,
      serverVersion: metadata.rows[0]?.server_version ?? null,
    },
    scope: { nasiyaId },
    tables,
  }
  const payload = { ...unsigned, checksum: `sha256:${hash(JSON.stringify(unsigned))}` }

  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
  chmodSync(outputDirectory, 0o700)
  writeFileSync(outputFile, gzipSync(JSON.stringify(payload)), { mode: 0o600 })
  chmodSync(outputFile, 0o600)

  const verified = JSON.parse(gunzipSync(readFileSync(outputFile)).toString('utf8'))
  const { checksum, ...verifiedUnsigned } = verified
  if (checksum !== `sha256:${hash(JSON.stringify(verifiedUnsigned))}`) {
    throw new Error('snapshot checksum verification failed')
  }
  if (verified.scope?.nasiyaId !== nasiyaId || verified.tables?.Nasiya?.length !== 1) {
    throw new Error('snapshot scope verification failed')
  }

  const bytes = statSync(outputFile).size
  console.log(JSON.stringify({
    mode: 'read-only-recovery-snapshot',
    verified: true,
    backupReference: `${outputFile}#${checksum}`,
    bytes,
    tableCounts: tableCounts(tables),
  }))
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
