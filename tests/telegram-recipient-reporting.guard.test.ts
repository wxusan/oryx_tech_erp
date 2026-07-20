import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Telegram producer coverage', () => {
  const transactionalProducers = [
    'src/app/api/devices/route.ts',
    'src/app/api/devices/[id]/restock/route.ts',
    'src/app/api/devices/[id]/sell/route.ts',
    'src/app/api/devices/[id]/nasiya/route.ts',
    'src/app/api/devices/[id]/return/route.ts',
    'src/app/api/sales/[id]/payment/route.ts',
    'src/app/api/nasiya/[id]/payment/route.ts',
    'src/app/api/nasiya/import/route.ts',
    'src/app/api/olib-sotdim/route.ts',
    'src/app/api/supplier-payables/[id]/payments/route.ts',
  ]

  it('routes every transactional producer through the shared resolver and row contract', () => {
    for (const path of transactionalProducers) {
      const source = (path.includes('/supplier-payables/') ? read('src/lib/server/supplier-payable-payments.ts') : '') + read(path)
      expect(source, path).toContain('resolveTelegramRecipients')
      expect(source, path).toContain('telegramNotificationRows')
      expect(source, path).toContain('telegramUnavailableMarkerRows')
      expect(source, path).toContain('flushQueuedTelegramWork')
      expect(source, path).toContain('after(')
      expect(source.includes('.catch(') || source.includes('after(async () => {')).toBe(true)
      expect(source.indexOf('after('), path).toBeGreaterThan(source.indexOf('$transaction'))
    }
  })

  it('keeps all nine reminder types on the bounded batch-primed resolver', () => {
    const cron = read('src/app/api/cron/reminders/route.ts')
    expect(cron).toContain('recipientCache.primeMany')
    expect(cron).toContain('telegramUnavailableMarkerRows')
    expect(cron).toContain('gapDedupeScope:')
    expect(cron).not.toContain('afterPage: flushRecipientWarnings')
    expect(cron).toContain('checkpointReminderGeneration(')
    expect(cron).not.toContain('shop.admins')
    expect(cron.match(/type: '(REMINDER|OVERDUE|EARLY_REMINDER|SALE_REMINDER|SALE_OVERDUE|SALE_EARLY_REMINDER|SUPPLIER_PAYABLE_REMINDER|SUPPLIER_PAYABLE_OVERDUE|SUPPLIER_PAYABLE_EARLY_REMINDER)'/g)).toHaveLength(9)
    expect(cron).toContain("type: 'OVERDUE',\n              dedupeScope: `OVERDUE:${dayKey}:${schedule.id}`")
  })

  it('passes Nasiya overdue gap markers through the guarded transition transaction', () => {
    const cron = read('src/app/api/cron/reminders/route.ts')
    const transition = cron.indexOf('const transition = await transitionNasiyaToOverdue({')
    const markerInput = cron.indexOf('gapMarkers: overdueGapMarkers', transition)
    expect(transition).toBeGreaterThan(-1)
    expect(markerInput).toBeGreaterThan(transition)
  })

  it('preserves owner-only financial audiences', () => {
    for (const path of [
      'src/app/api/devices/route.ts',
      'src/app/api/devices/[id]/sell/route.ts',
      'src/app/api/olib-sotdim/route.ts',
    ]) {
      expect(read(path), path).toContain('audience: TELEGRAM_AUDIENCES.OWNER_ONLY')
    }
  })
})

describe('Tizim recipient warning privacy and bounds', () => {
  it('reads at most 20 joined warning rows by post-ack occurrence time', () => {
    const api = read('src/app/api/admin/ops/route.ts')
    expect(api).toContain('LEFT JOIN "Shop"')
    expect(api).toContain('event."lastOccurredAt" >= ${activeSince}')
    expect(api).toContain('LIMIT 20')
    expect(api).toContain('take: 101')
    expect(api).toContain('recipientUnavailableReason: true')
    expect(api).toContain('safeTelegramNotificationType(row.status)')
  })

  it('uses the acknowledge boundary and a private-field-free cancellation projection', () => {
    const api = read('src/app/api/admin/ops/route.ts')
    expect(api).toContain('alertState?.alertWindowStartsAt.getTime()')
    expect(api).toContain('cancelledAt: { gte: activeSince }')
    const start = api.indexOf("status: 'CANCELLED',\n            cancelledAt: { gte: activeSince }")
    const end = api.indexOf('\n      ])', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const cancellationProjection = api.slice(start, end)
    for (const privateField of [
      'message: true',
      'telegramId: true',
      'recipientShopAdminId: true',
      'relatedId: true',
      'relatedType: true',
      'customer:',
    ]) {
      expect(cancellationProjection).not.toContain(privateField)
    }
    expect(cancellationProjection).toContain('shop: { select: { name: true } }')
  })

  it('derives cancellation-row audience only from the central type policy', () => {
    const api = read('src/app/api/admin/ops/route.ts')
    expect(api).toContain('audience: telegramAudienceForNotificationType(notificationType)')
    expect(api).not.toContain("notificationType === 'SALE'")
  })

  it('backs both bounded Tizim warning scans with matching descending indexes', () => {
    const schema = read('prisma/schema.prisma')
    const migration = read('prisma/migrations/202607180001_telegram_disable_lifecycle/migration.sql')
    expect(schema).toContain('@@index([event, lastOccurredAt(sort: Desc)])')
    expect(schema).toContain('@@index([status, cancelledAt(sort: Desc), id(sort: Desc)])')
    expect(migration).toContain('"OpsEvent_event_lastOccurredAt_idx"')
    expect(migration).toContain('"Notification_status_cancelledAt_id_idx"')
    expect(migration).toContain('ON "Notification"("status", "cancelledAt" DESC, "id" DESC)')
  })

  it('allows only immutable, replay-safe null-recipient gap markers at the database boundary', () => {
    const migration = read('prisma/migrations/202607180001_telegram_disable_lifecycle/migration.sql')
    expect(migration).toContain("NEW.\"dedupeKey\" ~ '^TELEGRAM_GAP:[0-9a-f]{64}$'")
    expect(migration).toContain('NEW."type" IN (')
    expect(migration).toContain("'SUPPLIER_PAYABLE_EARLY_REMINDER'")
    expect(migration).not.toContain("NEW.\"type\" ~ '^[A-Z0-9_]{1,64}$'")
    expect(migration).not.toContain('CUSTOMER_LOLA')
    expect(migration).toContain('NEW."message" = \'\'')
    expect(migration).toContain('NEW."telegramId" = \'\'')
    expect(migration).toContain("NEW.\"lastError\" = 'Cancelled before delivery: ' || NEW.\"recipientUnavailableReason\"")
    expect(migration).toContain('NEW."relatedId" IS NULL')
    expect(migration).toContain('NEW."relatedType" IS NULL')
    expect(migration).toContain('NEW."mediaKeys" = ARRAY[]::TEXT[]')
    expect(migration).toContain('NEW."mediaSentPositions" = ARRAY[]::INTEGER[]')
    expect(migration).toContain('NEW."attemptCount" = 0')
    for (const nullableProgress of [
      'sentAt',
      'lastAttemptAt',
      'nextAttemptAt',
      'mediaSnapshotAt',
      'textSentAt',
    ]) {
      expect(migration).toContain(`NEW."${nullableProgress}" IS NULL`)
    }
    expect(migration).toContain("IF TG_OP = 'UPDATE' AND old_is_gap_marker THEN")
    expect(migration).toContain('Telegram recipient gap markers are immutable')
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "Notification"')
  })

  it('displays only shop, type, audience, safe reason, count and time', () => {
    const page = read('src/app/(admin)/admin/ops/page.tsx')
    expect(page).toContain('Telegram qabul qiluvchi ogohlantirishlari')
    expect(page).toContain('notificationCancellationLabel(warning.reason)')
    expect(page).toContain('telegramAudienceLabel(warning.audience)')
    expect(page).not.toContain('warning.telegramId')
    expect(page).not.toContain('warning.message')
  })
})
