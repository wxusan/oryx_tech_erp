import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level regression GUARDS for Telegram fixes that need a live bot / DB
// to test behaviourally (see integration.todo.test.ts). These fail loudly if a
// fix is reverted.

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('telegram webhook /start recognition guard', () => {
  const src = read('src/app/api/telegram/webhook/route.ts')

  it('initialises the bot before handleUpdate (grammy throws otherwise)', () => {
    // The root cause of the "bot never welcomes" bug: handleUpdate was called
    // on an uninitialised bot, which throws before any handler runs.
    expect(src).toContain('bot.init()')
    expect(src).toContain('isInited()')
    expect(src).toContain('ensureWebhookBot')
  })

  it('looks up manually-entered IDs in both admin tables via findTelegramOwner', () => {
    expect(src).toContain('findTelegramOwner(telegramId)')
  })

  it('stamps telegramVerifiedAt on first /start when it is still null', () => {
    expect(src).toContain('telegramVerifiedAt: null')
    expect(src).toContain('telegramVerifiedAt: new Date()')
  })

  it('replies with role-specific welcome templates and an unknown-user reply', () => {
    expect(src).toContain('startSuperAdminMessage(owner.user.name)')
    expect(src).toContain('startShopAdminMessage(owner.user.name, owner.user.shop.name)')
    expect(src).toContain('startUnknownMessage()')
  })

  it('has no /link command handler and never mentions /link or link codes', () => {
    expect(src).not.toContain("bot.command('link'")
    expect(src).not.toContain('/link')
    expect(src).not.toContain('telegramLinkCode')
  })
})

describe('telegram link-code flow fully removed', () => {
  it('the ShopAdmin schema no longer has telegramLinkCode', () => {
    expect(read('prisma/schema.prisma')).not.toContain('telegramLinkCode')
  })

  it('a migration drops the telegramLinkCode column', () => {
    const sql = read('prisma/migrations/202607030004_remove_telegram_link_code/migration.sql')
    expect(sql).toContain('DROP COLUMN IF EXISTS "telegramLinkCode"')
  })

  it('provisioning routes no longer generate link codes', () => {
    expect(read('src/app/api/shops/route.ts')).not.toContain('telegramLinkCode')
    expect(read('src/app/api/shops/[id]/admins/route.ts')).not.toContain('telegramLinkCode')
  })

  it('the shop settings UI no longer shows a link command', () => {
    const ui = read('src/app/(shop)/shop/settings/page.tsx')
    expect(ui).not.toContain('telegramLinkCode')
    expect(ui).not.toContain('/link')
  })
})

describe('device return notification guard', () => {
  const src = read('src/app/api/devices/[id]/return/route.ts')

  it('queues a RETURN notification for verified shop admins inside the txn', () => {
    expect(src).toContain('deviceReturnedMessage')
    expect(src).toContain("type: 'RETURN'")
    // Recipient isolation: shop-scoped, active, non-deleted, verified only.
    expect(src).toContain('telegramVerifiedAt: { not: null }')
    expect(src).toContain('isActive: true')
    expect(src).toContain('deletedAt: null')
  })

  it('flushes notifications after the response (non-blocking)', () => {
    expect(src).toContain('after(() => processPendingNotifications()')
  })
})

describe('device restock notification guard', () => {
  const src = read('src/app/api/devices/[id]/restock/route.ts')

  it('queues a RESTOCK notification for verified shop admins inside the txn', () => {
    expect(src).toContain('deviceRestockedMessage')
    expect(src).toContain("type: 'RESTOCK'")
    expect(src).toContain('telegramVerifiedAt: { not: null }')
    expect(src).toContain('isActive: true')
    expect(src).toContain('deletedAt: null')
  })

  it('flushes notifications after the response (non-blocking)', () => {
    expect(src).toContain('after(() => processPendingNotifications()')
  })
})
