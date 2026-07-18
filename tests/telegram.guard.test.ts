import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level regression guards for Telegram wiring. HTTP and persistence
// behavior also run in tests/integration/telegram-http.integration.test.ts.

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

  it('verifies manually-entered IDs under lifecycle locks before replying', () => {
    expect(src).toContain('verifyTelegramOwnerForStart(telegramId)')
  })

  it('does not compose a welcome unless the locked verification succeeds', () => {
    expect(src).toContain('if (!owner)')
    expect(read('src/lib/server/telegram-lifecycle.ts')).toContain('verifyTelegramOwnerForStart')
  })

  it('stamps verification only for the exact current Telegram owner', () => {
    const lifecycle = read('src/lib/server/telegram-lifecycle.ts')
    expect(lifecycle).toContain('state.actor.telegramId !== telegramId')
    expect(lifecycle).toContain('where: { id: state.actor.id, shopId: state.actor.shopId, telegramId }')
  })

  it('replies with role-specific welcome templates and an unknown-user reply', () => {
    expect(src).toContain('startSuperAdminMessage(owner.user.name)')
    expect(src).toContain('startShopAdminMessage(owner.user.name, owner.user.shop.name)')
    expect(src).toContain('startUnknownMessage(telegramId)')
    expect(src).toContain("parse_mode: 'HTML'")
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

describe('telegram manual ID save verification guard', () => {
  const manualSetters = [
    'src/app/api/shop-admin/profile/route.ts',
    'src/app/api/admin/profile/route.ts',
    'src/app/api/shops/[id]/admins/route.ts',
    'src/app/api/shops/route.ts',
  ]

  it('manual Telegram ID saves never stamp verification immediately', () => {
    for (const file of manualSetters) {
      expect(read(file), file).not.toContain('telegramVerifiedAt: telegramId ? new Date() : null')
      expect(read(file), file).not.toContain('telegramVerifiedAt: admin.telegramId ? new Date() : null')
    }
  })

  it('profile updates preserve verification only from a locked live actor', () => {
    expect(read('src/lib/server/telegram-lifecycle.ts')).toContain('state.actor.telegramId === input.telegramId')
    expect(read('src/app/api/shop-admin/profile/route.ts')).toContain('linkShopAdminTelegramIdentityInTransaction')
    expect(read('src/app/api/admin/profile/route.ts')).toContain('nextTelegramVerifiedAt(')
  })

  it('newly provisioned admins with Telegram IDs start unverified until /start', () => {
    expect(read('src/app/api/shops/[id]/admins/route.ts')).toContain('telegramVerifiedAt: null')
    expect(read('src/app/api/shops/route.ts')).toContain('telegramVerifiedAt: null')
  })
})

describe('device return notification guard', () => {
  const src = read('src/app/api/devices/[id]/return/route.ts')
  const resolver = read('src/lib/server/telegram-recipients.ts')

  it('queues a RETURN notification for verified shop admins inside the txn', () => {
    expect(src).toContain('deviceReturnedMessage')
    expect(src).toContain("type: 'RETURN'")
    expect(src).toContain('resolveTelegramRecipients(tx')
    expect(src).toContain('audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF')
    // Recipient isolation lives in the one shared resolver.
    expect(resolver).toContain('telegramVerifiedAt: true')
    expect(resolver).toContain('where: { isActive: true, deletedAt: null }')
  })

  it('flushes notifications after the response (non-blocking)', () => {
    expect(src).toContain('after(() => flushQueuedTelegramWork()')
    expect(src).toContain('telegramUnavailableMarkerRows')
  })
})

describe('device restock notification guard', () => {
  const src = read('src/app/api/devices/[id]/restock/route.ts')
  const resolver = read('src/lib/server/telegram-recipients.ts')

  it('queues a RESTOCK notification for verified shop admins inside the txn', () => {
    expect(src).toContain('deviceRestockedMessage')
    expect(src).toContain("type: 'RESTOCK'")
    expect(src).toContain('resolveTelegramRecipients(tx')
    expect(src).toContain('audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF')
    expect(resolver).toContain('telegramVerifiedAt: true')
    expect(resolver).toContain('where: { isActive: true, deletedAt: null }')
  })

  it('flushes notifications after the response (non-blocking)', () => {
    expect(src).toContain('after(() => flushQueuedTelegramWork()')
    expect(src).toContain('telegramUnavailableMarkerRows')
  })
})

describe('item 14 — Telegram message design polish', () => {
  const templates = read('src/lib/telegram-templates.ts')

  it('no template ever embeds a raw URL (passport/storage links must never leak into a message)', () => {
    expect(templates).not.toMatch(/https?:\/\//)
    expect(templates).not.toContain('passportPhotoUrl')
    expect(templates).not.toContain('supabase')
  })

  it('every message-building function formats money through the shared helpers, never a raw toLocaleString', () => {
    // formatMoney/telegramMoney/formatContractMoneyWithDisplay/formatNativeAmount
    // are the only money formatters in this file — the single occurrence of
    // `.toLocaleString('ru-RU')` must be formatMoney's own implementation;
    // no other template should bypass it with an ad-hoc copy.
    const occurrences = templates.split(".toLocaleString('ru-RU')").length - 1
    expect(occurrences).toBe(1)
  })

  it('deviceSoldMessage shows Foyda (profit) when the sell route can compute it', () => {
    const route = read('src/app/api/devices/[id]/sell/route.ts')
    expect(route).toContain('computeSaleContractMargin( contractSalePrice, contractCurrency, salePriceInput.exchangeRateUsed,')
    expect(templates).toContain("typeof data.profit === 'number' ? `📊 Foyda: ${money(data.profit)}` : null")
  })
})

describe('canonical device identity in Telegram producers', () => {
  const producers = [
    'src/app/api/devices/[id]/sell/route.ts',
    'src/app/api/devices/[id]/nasiya/route.ts',
    'src/app/api/devices/[id]/return/route.ts',
    'src/app/api/devices/[id]/restock/route.ts',
    'src/app/api/nasiya/[id]/payment/route.ts',
    'src/app/api/sales/[id]/payment/route.ts',
    'src/app/api/olib-sotdim/[id]/pay/route.ts',
    'src/app/api/cron/reminders/route.ts',
  ]

  it('uses one shared mapper wherever an existing device is messaged', () => {
    for (const file of producers) {
      expect(read(file), file).toContain('presentDeviceSpecs(')
    }
  })

  it('the shared mapper exposes structured storage, approved condition wording, and both active IMEIs', () => {
    const specs = read('src/lib/device-specs.ts')
    expect(specs).toContain('storage: formatDeviceStorage(device) || null')
    expect(specs).toContain("entry.slot === 'SECONDARY'")
    expect(specs).toContain('conditionLabel: deviceConditionLabel(device.conditionCode)')
  })
})
