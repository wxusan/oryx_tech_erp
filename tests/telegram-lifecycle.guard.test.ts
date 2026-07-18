import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\s+/g, ' ')
}

describe('Telegram lifecycle wiring guards', () => {
  it('creates false-package transitions and schedules the Tashkent-midnight cron', () => {
    const packageRoute = read('src/app/api/shops/[id]/package/route.ts')
    const vercel = read('vercel.json')
    expect(packageRoute).toContain('createTelegramDisableTransitionInTransaction')
    expect(packageRoute).toContain("!nextEnabledFeatures.has('TELEGRAM')")
    expect(vercel).toContain('/api/cron/telegram-disable-transitions')
    expect(vercel).toContain('"schedule": "0 19 * * *"')
  })

  it('hooks package, shop-master, staff, self-unlink, and delete transactions into the purge helper', () => {
    for (const path of [
      'src/app/api/shops/[id]/package/route.ts',
      'src/app/api/shop/profile/route.ts',
      'src/app/api/shop/staff/[id]/route.ts',
      'src/app/api/shops/[id]/route.ts',
      'src/app/api/shops/[id]/admins/route.ts',
    ]) {
      expect(read(path), path).toContain('purgeTelegramIdentityInTransaction')
    }
    const selfProfile = read('src/app/api/shop-admin/profile/route.ts')
    expect(selfProfile).toContain('linkShopAdminTelegramIdentityInTransaction')
    expect(selfProfile).toContain('unlinkShopAdminTelegramIdentityInTransaction')
  })

  it('runs the retryable backstop before ID claims, webhook recognition, and delivery', () => {
    const identity = read('src/lib/telegram-id.ts')
    const delivery = read('src/lib/notification-service.ts')
    expect(identity).toContain('reconcileLinkedTelegramIdentity')
    expect(read('src/lib/server/telegram-lifecycle.ts')).toContain('processDueTelegramDisableTransitions')
    expect(delivery).toContain('processDueTelegramDisableTransitions({ limit: 100, now })')
    expect(delivery).toContain('telegram_disable_transition_pending')
  })

  it('reconciles another shop stale holder before both profile claim transactions', () => {
    for (const path of [
      'src/app/api/shop-admin/profile/route.ts',
      'src/app/api/admin/profile/route.ts',
    ]) {
      const source = read(path)
      const reconcile = source.indexOf('reconcileLinkedTelegramIdentity(telegramId)')
      const transaction = source.indexOf('prisma.$transaction', reconcile)
      expect(reconcile, path).toBeGreaterThan(-1)
      expect(transaction, path).toBeGreaterThan(reconcile)
    }
  })

  it('migration cleans ineligible identities, cancels actionable rows, and seeds every future false version', () => {
    const migration = read('prisma/migrations/202607180001_telegram_disable_lifecycle/migration.sql')
    expect(migration).toContain('CREATE TABLE "TelegramDisableTransition"')
    expect(migration).toContain("notification.\"status\" IN ('PENDING', 'FAILED')")
    expect(migration).toContain('admin."id" IS DISTINCT FROM shop."ownerAdminId"')
    expect(migration).toContain('package."effectiveOn" >')
    expect(migration).toContain('ON CONFLICT ("packageVersionId") DO NOTHING')
  })

  it('reserves privacy-safe OpsEvent aggregation fields without notification content', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toContain('dedupeKey String? @unique')
    expect(schema).toContain('occurrenceCount Int @default(1)')
    expect(schema).toContain('lastOccurredAt DateTime @default(now())')
    const lifecycle = read('src/lib/server/telegram-lifecycle.ts')
    expect(lifecycle).toContain('recipientUnavailableReason: purgeWarningReason(input.reason)')
    expect(lifecycle).toContain('cancelledAt: now')
    expect(lifecycle).toContain('cancelLegacyStaffNotificationsInTransaction')
    expect(lifecycle).toContain('staff."id" <> ${input.ownerAdminId}')
    expect(lifecycle).not.toContain('persistTelegramRecipientWarnings')
    expect(lifecycle).not.toContain('message: notification.message')
    expect(lifecycle).not.toContain('metadata: { telegramId')
  })
})
