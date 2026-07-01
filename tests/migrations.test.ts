import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// These are regression GUARDS, not behavioural tests: active-only uniqueness is
// enforced by raw-SQL partial indexes that Prisma's schema cannot express, so
// we assert the migration SQL still contains them (reqs 9 & 10 constraint side).
// A DB-backed behavioural test is listed in integration.todo.test.ts.

const migrationsDir = resolve(process.cwd(), 'prisma/migrations')

function readMigration(folder: string) {
  return readFileSync(resolve(migrationsDir, folder, 'migration.sql'), 'utf8').replace(/\s+/g, ' ')
}

describe('migration guards', () => {
  const integrity = readMigration('202607020002_integrity_return_ledger')

  it('active-only IMEI uniqueness is a partial unique index WHERE deletedAt IS NULL (req 9)', () => {
    expect(integrity).toContain('CREATE UNIQUE INDEX "Device_shopId_imei_active_key"')
    expect(integrity).toMatch(/Device_shopId_imei_active_key"[^;]*WHERE "deletedAt" IS NULL/)
  })

  it('active-only customer phone uniqueness is a partial unique index (req 10)', () => {
    expect(integrity).toContain('CREATE UNIQUE INDEX "Customer_shopId_normalizedPhone_active_key"')
    expect(integrity).toMatch(
      /Customer_shopId_normalizedPhone_active_key"[^;]*WHERE "deletedAt" IS NULL AND "normalizedPhone" IS NOT NULL/,
    )
  })

  it('normalizedPhone column + backfill exist', () => {
    expect(integrity).toContain('ADD COLUMN "normalizedPhone"')
    expect(integrity).toContain("regexp_replace(\"phone\", '\\D', '', 'g')")
  })

  it('cross-shop cron indexes migration exists (item 5)', () => {
    const cron = readMigration('202607020003_cron_indexes')
    expect(cron).toContain('CREATE INDEX "NasiyaSchedule_status_dueDate_idx"')
    expect(cron).toContain('CREATE INDEX "Sale_paidFully_dueDate_idx"')
  })

  it('migration_lock.toml is committed with the postgres provider', () => {
    const lockPath = resolve(migrationsDir, 'migration_lock.toml')
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, 'utf8')).toContain('provider = "postgresql"')
  })
})
