/**
 * One-time production-only Nasiya parent-cache repair.
 *
 * It is deliberately unavailable to local/preview builds. Before the cache
 * update, a checksum-verified ledger snapshot is written to the private
 * Supabase backup bucket; the normal reconciliation script then creates the
 * database audit Log and OpsEvent entries. Schedules, payments, allocations,
 * rates, and contract terms are never modified.
 */

import { readFileSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import sharp from 'sharp'

const enabled = process.env.ORYX_NASIYA_LEDGER_REPAIR === '1'

if (!enabled) process.exit(0)

if (process.env.VERCEL_ENV !== 'production' || process.env.ORYX_GUARDED_RELEASE !== 'github-actions') {
  throw new Error('Nasiya ledger repair may run only in a guarded Vercel production release')
}

const approverLogin = process.env.ORYX_NASIYA_LEDGER_REPAIR_APPROVER_LOGIN
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const backupBucket = process.env.SUPABASE_PRIVATE_BUCKET

if (!approverLogin || !databaseUrl || !supabaseUrl || !supabaseServiceRoleKey || !backupBucket) {
  throw new Error('Guarded Nasiya ledger repair is missing its required production configuration')
}

function runNode(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Guarded Nasiya ledger command failed: ${args[1] ?? args[0]}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`Guarded Nasiya ledger command returned invalid JSON: ${args[1] ?? args[0]}`)
  }
}

const audit = runNode(['scripts/reconcile-nasiya-ledgers.mjs', '--verbose'])
if (audit.repairable !== 1 || audit.ambiguous !== 0 || audit.examples?.length !== 1) {
  throw new Error('Guarded Nasiya ledger repair requires exactly one repairable and no ambiguous ledgers')
}

const nasiyaId = audit.examples[0]?.id
if (typeof nasiyaId !== 'string' || !nasiyaId) {
  throw new Error('Guarded Nasiya ledger repair could not identify the reviewed ledger')
}

const snapshot = runNode(['scripts/create-nasiya-ledger-recovery-snapshot.mjs', `--nasiya-id=${nasiyaId}`])
const localReference = snapshot.backupReference
const [snapshotFile, checksum] = typeof localReference === 'string' ? localReference.split('#') : []
if (!snapshot.verified || !snapshotFile || !checksum) {
  throw new Error('Guarded Nasiya ledger repair could not create a verified recovery snapshot')
}

const snapshotBytes = readFileSync(snapshotFile)
if (snapshotBytes.length > 4 * 1024 * 1024) {
  throw new Error('Guarded Nasiya ledger recovery snapshot exceeds the private archive size limit')
}

// The configured private bucket is intentionally image-only. Store the gzip
// bytes losslessly in a real PNG RGBA envelope: the first eight bytes encode
// the original payload length, and the source snapshot checksum remains the
// integrity proof recorded in the ledger audit row.
const payload = Buffer.alloc(8 + snapshotBytes.length)
payload.writeBigUInt64BE(BigInt(snapshotBytes.length))
snapshotBytes.copy(payload, 8)
const width = 256
const height = Math.ceil(payload.length / (width * 4))
const pixels = Buffer.alloc(width * height * 4)
payload.copy(pixels)
const archivedBytes = await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toBuffer()

const remotePath = `operations/nasiya-ledger-recovery/${basename(snapshotFile)}.png`
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: uploadError } = await supabase.storage
  .from(backupBucket)
  .upload(remotePath, archivedBytes, { contentType: 'image/png', upsert: false })
if (uploadError) {
  // Storage error text contains no ledger data; retaining it in the protected
  // release log is necessary for an operator to correct the backup target.
  throw new Error(`Guarded Nasiya ledger repair could not archive its recovery snapshot: ${uploadError.message}`)
}
rmSync(snapshotFile, { force: true })

const archiveReference = `supabase-storage://${backupBucket}/${remotePath}#${checksum};encoding=png-rgba-v1`
const client = new pg.Client({ connectionString: databaseUrl })
let actorId
try {
  await client.connect()
  const actor = await client.query(
    `SELECT id FROM "SuperAdmin" WHERE login = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 2`,
    [approverLogin],
  )
  if (actor.rowCount !== 1) {
    throw new Error('Guarded Nasiya ledger repair requires exactly one active approving super-admin')
  }
  actorId = actor.rows[0].id
} finally {
  await client.end().catch(() => undefined)
}

const repaired = runNode([
  'scripts/reconcile-nasiya-ledgers.mjs',
  '--apply',
  `--actor-id=${actorId}`,
  '--actor-type=SUPER_ADMIN',
  `--backup-reference=${archiveReference}`,
], { ORYX_NASIYA_LEDGER_REPAIR_PITR_CONFIRMED: 'YES' })

if (repaired.applied !== 1 || repaired.concurrentSkips !== 0 || repaired.ambiguous !== 0) {
  throw new Error('Guarded Nasiya ledger repair did not apply exactly one uncontested cache update')
}

const verified = runNode(['scripts/reconcile-nasiya-ledgers.mjs'])
if (verified.repairable !== 0 || verified.ambiguous !== 0) {
  throw new Error('Guarded Nasiya ledger repair did not leave a clean ledger audit')
}

console.log(JSON.stringify({
  repaired: repaired.applied,
  remainingRepairable: verified.repairable,
  remainingAmbiguous: verified.ambiguous,
  snapshotArchived: true,
}))
