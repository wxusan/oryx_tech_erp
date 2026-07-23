import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(resolve(
  process.cwd(),
  'prisma/migrations/202607180001_telegram_disable_lifecycle/migration.sql',
), 'utf8')

describe('Telegram reminder dedupe migration SQL', () => {
  it('rewrites exactly the nine stable-actor reminder formats', () => {
    for (const type of [
      'REMINDER',
      'OVERDUE',
      'EARLY_REMINDER',
      'SALE_REMINDER',
      'SALE_OVERDUE',
      'SALE_EARLY_REMINDER',
      'SUPPLIER_PAYABLE_REMINDER',
      'SUPPLIER_PAYABLE_OVERDUE',
      'SUPPLIER_PAYABLE_EARLY_REMINDER',
    ]) {
      expect(migration).toContain(`'${type}'`)
    }
    expect(migration).toContain("|| ':' || notification.\"recipientShopAdminId\"")
    expect(migration).toContain('split_part(notification."dedupeKey", \':\', 5) = \'\'')
  })

  it('preflights collisions, preserves history, and cancels redundant actionable rows', () => {
    expect(migration).toContain('CREATE TEMP TABLE "_ReminderDedupeRewrite"')
    expect(migration).toContain('ROW_NUMBER() OVER')
    expect(migration).toContain("WHEN member.\"status\" = 'SENT' THEN 0")
    expect(migration).toContain("rewrite.\"status\" = 'PROCESSING'")
    expect(migration).toContain('Fresh reminder delivery collision; retry migration after processing lease expires')
    expect(migration).toContain("USING ERRCODE = 'P0001'")
    expect(migration).toContain('rewrite."targetRank" > 1')
    expect(migration).toContain('Duplicate reminder cancelled during Telegram recipient dedupe migration')
    expect(migration).toContain('SET "dedupeKey" = NULL')
    expect(migration).not.toContain('DELETE FROM "Notification"')
  })

  it('stores lifecycle warning state on Notification instead of coupling purge to OpsEvent', () => {
    expect(migration).toContain('ADD COLUMN "recipientUnavailableReason" TEXT')
    expect(migration).toContain('ADD COLUMN "cancelledAt" TIMESTAMP(3)')
    expect(migration).toContain('"recipientUnavailableReason" = actor."warningReason"')
    expect(migration).toContain('"cancelledAt" = CURRENT_TIMESTAMP')
    expect(migration).toContain('staff_reason_feature."featureCode" = \'STAFF_ACCESS\'')
    expect(migration).toContain("ELSE 'unlinked_or_unverified'")
    expect(migration).not.toContain('migration-telegram-warning:')
  })

  it('allows only strict durable gap markers while preserving legacy cleanup updates', () => {
    expect(migration).toContain('NEW."dedupeKey" ~ \'^TELEGRAM_GAP:[0-9a-f]{64}$\'')
    expect(migration).toContain("IF TG_OP = 'UPDATE' AND old_is_gap_marker THEN")
    expect(migration).toContain('Telegram recipient gap markers are immutable')
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "Notification"')
    expect(migration).toContain(
      'OLD."recipientShopAdminId" IS NOT NULL AND NEW."recipientShopAdminId" IS NULL AND NOT new_is_gap_marker',
    )
    expect(migration).toContain('OR (old_is_gap_marker AND NOT new_is_gap_marker)')
    expect(migration).toContain('END;\n$$;')
  })
})
