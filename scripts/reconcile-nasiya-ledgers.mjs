/**
 * Read-only by default Nasiya ledger audit and cache repair.
 *
 * This never rewrites schedules, payment rows, allocations, rates, or frozen
 * contract terms. `--apply` changes only deterministic parent caches after a
 * human has confirmed a PITR/backup reference. Run it once in dry-run mode,
 * review its count-only output, then run the approved scoped apply command.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import pg from 'pg'

// Make the command usable from `npm run` during local development while
// preserving explicitly exported CI/production values.
async function loadEnv() {
  const explicitDatabaseUrl = process.env.DATABASE_URL
  const explicitDirectUrl = process.env.DIRECT_URL
  try {
    const dotenv = await import('dotenv')
    const environment = process.env.NODE_ENV || 'development'
    // Prefer a populated `.env.local`, but allow this repo's intentionally
    // blank local placeholders to fall back to `.env.development.local`.
    for (const file of ['.env.local', `.env.${environment}.local`, `.env.${environment}`, '.env']) {
      try {
        const parsed = dotenv.parse(readFileSync(file))
        for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
          const candidate = parsed[key]?.trim()
          const unquoted = candidate?.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2').trim()
          if (unquoted && process.env[key] === undefined) process.env[key] = unquoted
        }
      } catch {
        // This environment file is optional.
      }
    }
  } catch {
    // The command can still run when the caller supplies the URL directly.
  }
  if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl
  if (explicitDirectUrl !== undefined) process.env.DIRECT_URL = explicitDirectUrl
}

await loadEnv()

const apply = process.argv.includes('--apply')
const verbose = process.argv.includes('--verbose')
const option = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) || null
const shopId = option('shop-id')
const actorId = option('actor-id')
const actorType = option('actor-type')
const backupReference = option('backup-reference')
const rawDatabaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!rawDatabaseUrl) throw new Error('DIRECT_URL or DATABASE_URL is required')
if (apply) {
  if (!actorId || !['SUPER_ADMIN', 'SHOP_ADMIN'].includes(actorType ?? '')) {
    throw new Error('--apply requires --actor-id and --actor-type=SUPER_ADMIN|SHOP_ADMIN')
  }
  if (!backupReference || process.env.ORYX_NASIYA_LEDGER_REPAIR_PITR_CONFIRMED !== 'YES') {
    throw new Error('--apply requires --backup-reference plus ORYX_NASIYA_LEDGER_REPAIR_PITR_CONFIRMED=YES')
  }
  if (actorType === 'SHOP_ADMIN' && !shopId) {
    throw new Error('SHOP_ADMIN repair scope requires --shop-id')
  }
}

const databaseUrl = new URL(rawDatabaseUrl)
databaseUrl.searchParams.delete('schema')
const client = new pg.Client({ connectionString: databaseUrl.toString() })
const runId = randomUUID()

const scale = (currency) => currency === 'USD' ? 100 : 1
const units = (value, currency) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const result = Math.round(number * scale(currency))
  return Math.abs(number * scale(currency) - result) <= 1e-8 ? result : null
}
const amount = (minorUnits, currency) => minorUnits / scale(currency)
const isEqual = (left, right) => left != null && right != null && left === right

function tashkentDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(date))
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function classify(nasiya, today) {
  const currency = nasiya.contractCurrency
  const reasons = []
  const final = units(nasiya.contractFinalAmount, currency)
  const parentPaid = units(nasiya.contractPaidAmount, currency)
  const parentRemaining = units(nasiya.contractRemainingAmount, currency)
  if (final == null || parentPaid == null || parentRemaining == null || final <= 0) {
    return { kind: 'AMBIGUOUS', reasons: ['invalid parent native money'] }
  }
  const schedules = Array.isArray(nasiya.schedules) ? nasiya.schedules : []
  if (schedules.length === 0) return { kind: 'AMBIGUOUS', reasons: ['no schedules'] }

  let expected = 0
  let paid = 0
  let remaining = 0
  let legacyPaid = 0
  let legacyExpected = 0
  let hasOpenPastDue = false
  const allocationBySchedule = new Map()
  for (const allocation of nasiya.allocations ?? []) {
    if (!allocation.nasiyaScheduleId) continue
    const allocationUnits = units(allocation.contractAmount, currency)
    if (allocation.contractCurrency !== currency || allocationUnits == null) {
      reasons.push('allocation currency or precision mismatch')
      continue
    }
    allocationBySchedule.set(allocation.nasiyaScheduleId, (allocationBySchedule.get(allocation.nasiyaScheduleId) ?? 0) + allocationUnits)
  }

  for (const schedule of schedules) {
    const scheduleExpected = units(schedule.contractExpectedAmount, currency)
    const schedulePaid = units(schedule.contractPaidAmount, currency)
    const scheduleRemaining = units(schedule.contractRemainingAmount, currency)
    const scheduleLegacyExpected = units(schedule.expectedAmount, 'UZS')
    const scheduleLegacyPaid = units(schedule.paidAmount, 'UZS')
    if (schedule.contractCurrency !== currency) reasons.push('schedule currency mismatch')
    if (scheduleExpected == null || schedulePaid == null || scheduleRemaining == null || scheduleExpected <= 0 || schedulePaid < 0 || scheduleRemaining < 0) {
      reasons.push('invalid schedule native money')
      continue
    }
    if (scheduleExpected !== schedulePaid + scheduleRemaining) reasons.push('schedule expected/paid/remaining mismatch')
    if (schedule.status === 'CANCELLED' && scheduleRemaining > 0) reasons.push('cancelled schedule has remaining debt')
    if (schedule.status !== 'CANCELLED') {
      const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
      const expectedScheduleStatus = scheduleRemaining === 0
        ? 'PAID'
        : tashkentDate(effectiveDue) < today
          ? 'OVERDUE'
          : schedule.status === 'DEFERRED' && schedule.delayedUntil
            ? 'DEFERRED'
            : schedulePaid > 0
              ? 'PARTIAL'
              : 'PENDING'
      if (schedule.status !== expectedScheduleStatus) {
        reasons.push('schedule status differs from schedule-derived status')
      }
    }
    if (schedule.status !== 'CANCELLED' && scheduleRemaining > 0) {
      const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
      if (tashkentDate(effectiveDue) < today) hasOpenPastDue = true
    }
    if (nasiya.accountingReconstructionStatus === 'COMPLETE' && (allocationBySchedule.get(schedule.id) ?? 0) !== schedulePaid) {
      reasons.push('complete allocation evidence disagrees with schedule payment')
    }
    expected += scheduleExpected
    paid += schedulePaid
    remaining += scheduleRemaining
    if (scheduleLegacyExpected == null || scheduleLegacyPaid == null || scheduleLegacyExpected < scheduleLegacyPaid) {
      reasons.push('invalid legacy schedule cache')
    } else {
      legacyExpected += scheduleLegacyExpected
      legacyPaid += scheduleLegacyPaid
    }
  }

  if (expected !== final) reasons.push('schedule total differs from financed contract amount')
  if (expected !== paid + remaining) reasons.push('schedule aggregate mismatch')
  if (reasons.length) return { kind: 'AMBIGUOUS', reasons: [...new Set(reasons)] }

  // Cancellation is an operational/return decision, never a cache repair
  // target. Its historical balance needs manual review if it is inconsistent.
  if (nasiya.status === 'CANCELLED') {
    return isEqual(parentPaid, paid) && isEqual(parentRemaining, remaining)
      ? { kind: 'HEALTHY', reasons: [] }
      : { kind: 'AMBIGUOUS', reasons: ['cancelled parent cache differs from schedules'] }
  }

  const expectedStatus = remaining === 0 ? 'COMPLETED' : hasOpenPastDue ? 'OVERDUE' : 'ACTIVE'
  const parentMatches = parentPaid === paid && parentRemaining === remaining && nasiya.status === expectedStatus
  if (parentMatches) return { kind: 'HEALTHY', reasons: [] }

  // The UZS parent cache is deterministically repairable only for a UZS
  // contract whose legacy schedules still reconcile to its legacy total.
  const legacyRemaining = currency === 'UZS' && legacyExpected === units(nasiya.finalNasiyaAmount, 'UZS')
    ? Math.max(0, legacyExpected - legacyPaid)
    : null
  return {
    kind: 'REPAIRABLE',
    reasons: ['parent cache differs from valid schedule ledger'],
    repair: {
      currency,
      contractPaid: paid,
      contractRemaining: remaining,
      status: expectedStatus,
      legacyRemaining,
    },
  }
}

async function assertActor() {
  if (!apply) return
  const table = actorType === 'SUPER_ADMIN' ? 'SuperAdmin' : 'ShopAdmin'
  const actor = await client.query(`SELECT id, "shopId" FROM "${table}" WHERE id = $1 AND "deletedAt" IS NULL`, [actorId])
  if (actor.rowCount !== 1) throw new Error('repair actor is not active')
  if (actorType === 'SHOP_ADMIN' && actor.rows[0].shopId !== shopId) {
    throw new Error('SHOP_ADMIN actor does not belong to the requested shop')
  }
}

async function loadNasiyas() {
  const result = await client.query(`
    SELECT
      n.*,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s."monthNumber", s.id)
        FROM "NasiyaSchedule" s
        WHERE s."nasiyaId" = n.id
      ), '[]'::jsonb) AS schedules,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'nasiyaScheduleId', a."nasiyaScheduleId",
          'contractCurrency', a."contractCurrency",
          'contractAmount', a."contractAmount"
        ) ORDER BY a.id)
        FROM "NasiyaPaymentAllocation" a
        WHERE a."nasiyaId" = n.id
      ), '[]'::jsonb) AS allocations
    FROM "Nasiya" n
    WHERE n."deletedAt" IS NULL
      AND ($1::text IS NULL OR n."shopId" = $1)
    ORDER BY n."shopId", n."createdAt", n.id
  `, [shopId])
  return result.rows
}

const summary = {
  runId,
  mode: apply ? 'apply' : 'dry-run',
  shopScoped: Boolean(shopId),
  total: 0,
  healthy: 0,
  repairable: 0,
  ambiguous: 0,
  applied: 0,
  concurrentSkips: 0,
  examples: [],
}

await client.connect()
try {
  await assertActor()
  // Some pre-release production databases have the historic Log shape without
  // shopId. Keep the cache repair auditable there as well; the Nasiya target
  // and before/after values remain fully recorded, and the normal schema
  // migration will restore tenant-scoped Log rows afterward.
  const logColumnResult = apply
    ? await client.query(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'Log'
            AND column_name = 'shopId'
        ) AS "hasShopId"
      `)
    : null
  const logHasShopId = logColumnResult?.rows[0]?.hasShopId === true
  const today = tashkentDate(new Date())
  const nasiyas = await loadNasiyas()
  summary.total = nasiyas.length

  for (const nasiya of nasiyas) {
    const result = classify(nasiya, today)
    if (result.kind === 'HEALTHY') {
      summary.healthy += 1
      continue
    }
    if (result.kind === 'AMBIGUOUS') {
      summary.ambiguous += 1
      if (verbose && summary.examples.length < 20) summary.examples.push({ id: nasiya.id, classification: 'AMBIGUOUS', reasons: result.reasons })
      continue
    }
    summary.repairable += 1
    if (verbose && summary.examples.length < 20) {
      summary.examples.push({
        id: nasiya.id,
        classification: 'REPAIRABLE',
        reasons: result.reasons,
        proposedCache: {
          currency: result.repair.currency,
          paidMinorUnits: result.repair.contractPaid,
          remainingMinorUnits: result.repair.contractRemaining,
          status: result.repair.status,
        },
      })
    }
    if (!apply) continue

    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    try {
      const oldValue = {
        runId,
        contractPaidAmount: String(nasiya.contractPaidAmount),
        contractRemainingAmount: String(nasiya.contractRemainingAmount),
        remainingAmount: String(nasiya.remainingAmount),
        status: nasiya.status,
      }
      const updated = await client.query(`
        UPDATE "Nasiya"
        SET
          "contractPaidAmount" = $2,
          "contractRemainingAmount" = $3,
          status = $4::"NasiyaStatus",
          "remainingAmount" = CASE WHEN $5::numeric IS NULL THEN "remainingAmount" ELSE $5::numeric END
        WHERE id = $1
          AND "contractPaidAmount" = $6::numeric
          AND "contractRemainingAmount" = $7::numeric
          AND status = $8::"NasiyaStatus"
        RETURNING id
      `, [
        nasiya.id,
        amount(result.repair.contractPaid, result.repair.currency),
        amount(result.repair.contractRemaining, result.repair.currency),
        result.repair.status,
        result.repair.legacyRemaining == null ? null : amount(result.repair.legacyRemaining, 'UZS'),
        nasiya.contractPaidAmount,
        nasiya.contractRemainingAmount,
        nasiya.status,
      ])
      if (updated.rowCount !== 1) {
        summary.concurrentSkips += 1
        await client.query('ROLLBACK')
        continue
      }
      const newValue = {
        runId,
        contractPaidAmount: String(amount(result.repair.contractPaid, result.repair.currency)),
        contractRemainingAmount: String(amount(result.repair.contractRemaining, result.repair.currency)),
        remainingAmount: result.repair.legacyRemaining == null ? null : String(amount(result.repair.legacyRemaining, 'UZS')),
        status: result.repair.status,
        backupReference,
      }
      if (logHasShopId) {
        await client.query('SAVEPOINT nasiya_ledger_audit')
        try {
          await client.query(`
            INSERT INTO "Log" (id, "shopId", "actorId", "actorType", action, "targetType", "targetId", "oldValue", "newValue", note)
            VALUES ($1, $2, $3, $4::"ActorType", 'RECONCILE_NASIYA_LEDGER_CACHE', 'Nasiya', $5, $6::jsonb, $7::jsonb, $8)
          `, [
            randomUUID(), nasiya.shopId, actorId, actorType, nasiya.id,
            JSON.stringify(oldValue), JSON.stringify(newValue),
            `Nasiya ledger cache repair run ${runId}`,
          ])
          await client.query('RELEASE SAVEPOINT nasiya_ledger_audit')
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT nasiya_ledger_audit')
          if (error?.code !== '42703') throw error
          await client.query(`
            INSERT INTO "Log" (id, "actorId", "actorType", action, "targetType", "targetId", "oldValue", "newValue", note)
            VALUES ($1, $2, $3::"ActorType", 'RECONCILE_NASIYA_LEDGER_CACHE', 'Nasiya', $4, $5::jsonb, $6::jsonb, $7)
          `, [
            randomUUID(), actorId, actorType, nasiya.id,
            JSON.stringify(oldValue), JSON.stringify(newValue),
            `Nasiya ledger cache repair run ${runId}`,
          ])
        }
      } else {
        await client.query(`
          INSERT INTO "Log" (id, "actorId", "actorType", action, "targetType", "targetId", "oldValue", "newValue", note)
          VALUES ($1, $2, $3::"ActorType", 'RECONCILE_NASIYA_LEDGER_CACHE', 'Nasiya', $4, $5::jsonb, $6::jsonb, $7)
        `, [
          randomUUID(), actorId, actorType, nasiya.id,
          JSON.stringify(oldValue), JSON.stringify(newValue),
          `Nasiya ledger cache repair run ${runId}`,
        ])
      }
      await client.query('COMMIT')
      summary.applied += 1
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  if (apply) {
    await client.query(`
      INSERT INTO "OpsEvent" (id, level, event, message, status, "actorId", "actorType", metadata)
      VALUES ($1, 'INFO', 'currency.nasiya_ledger_reconciliation', $2, 'APPLIED', $3, $4::"ActorType", $5::jsonb)
    `, [
      randomUUID(),
      'Nasiya ledger cache repair completed',
      actorId,
      actorType,
      JSON.stringify({ runId, shopScoped: Boolean(shopId), healthy: summary.healthy, repairable: summary.repairable, applied: summary.applied, ambiguous: summary.ambiguous, concurrentSkips: summary.concurrentSkips, backupReference }),
    ])
  }

  // Default output is count-only: safe for CI/deployment logs. `--verbose`
  // is an explicit operator choice and returns only record IDs/reasons.
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
} finally {
  await client.end().catch(() => undefined)
}
