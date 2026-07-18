import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

vi.mock('server-only', () => ({}))

import {
  createTelegramDisableTransitionInTransaction,
  linkShopAdminTelegramIdentityInTransaction,
  processDueTelegramDisableTransitions,
  purgeTelegramIdentityInTransaction,
  reconcileLinkedTelegramIdentity,
  TELEGRAM_PURGE_REASON,
  telegramLinkAllowedInTransaction,
  unlinkShopAdminTelegramIdentityInTransaction,
  verifyTelegramOwnerForStart,
} from '@/lib/server/telegram-lifecycle'
import { isTelegramIdTaken } from '@/lib/telegram-id'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 3 }) })

const ACTIVE_FEATURE_CODES = [
  'INVENTORY', 'CASH_SALES', 'NASIYA', 'OLIB_SOTDIM', 'CUSTOMER_CRM',
  'TELEGRAM', 'REMINDERS', 'REPORTS', 'IMPORTS', 'EXPORTS', 'STAFF_ACCESS',
] as const

function packageFeatures(overrides: Partial<Record<(typeof ACTIVE_FEATURE_CODES)[number], boolean>> = {}) {
  return ACTIVE_FEATURE_CODES.map((featureCode) => ({
    featureCode,
    enabled: overrides[featureCode] ?? true,
    recurringPrice: 0,
  }))
}

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification",
      "ShopAdmin", "ShopPayment", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedLinkedOwner(suffix: string) {
  const platformAdmin = await prisma.superAdmin.create({
    data: { name: `Platform ${suffix}`, login: `platform_${suffix}`, passwordHash: 'integration-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Lifecycle ${suffix}`,
      ownerName: `Owner ${suffix}`,
      ownerPhone: '+998901111111',
      shopNumber: `lifecycle-${suffix}`,
      address: 'Disposable lifecycle integration',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: platformAdmin.id,
      telegramNotificationsEnabled: true,
    },
  })
  const owner = await prisma.shopAdmin.create({
    data: {
      shopId: shop.id,
      name: `Owner ${suffix}`,
      phone: '+998902222222',
      login: `owner_${suffix}`,
      passwordHash: 'integration-only',
      telegramId: '700000001',
      telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
      telegramNotificationsEnabled: true,
    },
  })
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      ownerAdminId: owner.id,
      ownershipStatus: 'RESOLVED',
      ownershipResolvedAt: new Date('2026-07-01T00:00:00.000Z'),
      ownershipResolvedById: platformAdmin.id,
    },
  })
  await prisma.shopPackageVersion.create({
    data: {
      shopId: shop.id,
      effectiveOn: new Date('2026-01-01T00:00:00.000Z'),
      basePrice: 0,
      discountAmount: 0,
      note: 'Telegram enabled baseline',
      createdById: platformAdmin.id,
      features: {
        create: packageFeatures(),
      },
    },
  })
  return { platformAdmin, shop, owner }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(resetBusinessData)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Telegram identity lifecycle against PostgreSQL', () => {
  it('atomically purges identity, cancels pending delivery, and releases the ID for reuse', async () => {
    const { shop, owner } = await seedLinkedOwner('purge')
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        recipientShopAdminId: owner.id,
        telegramId: '700000001',
        type: 'LIFECYCLE_TEST',
        message: 'Private content must not enter ops telemetry',
        scheduledAt: new Date('2026-07-18T00:00:00.000Z'),
      },
    })

    await prisma.$transaction((tx) => purgeTelegramIdentityInTransaction(
      tx,
      { type: 'SHOP', shopId: shop.id },
      { reason: TELEGRAM_PURGE_REASON.SHOP_DISABLED },
    ))

    const [storedOwner, storedNotification] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } }),
      prisma.notification.findUniqueOrThrow({ where: { id: notification.id } }),
    ])
    expect(storedOwner.telegramId).toBeNull()
    expect(storedOwner.telegramVerifiedAt).toBeNull()
    expect(storedOwner.telegramNotificationsEnabled).toBe(true)
    expect(storedNotification.status).toBe('CANCELLED')
    expect(storedNotification.lastError).toBe('Telegram delivery cancelled: telegram_shop_disabled')
    expect(storedNotification.recipientUnavailableReason).toBe('shop_disabled')
    expect(storedNotification.cancelledAt).not.toBeNull()

    const replacement = await prisma.superAdmin.create({
      data: {
        name: 'Replacement claimant',
        login: 'replacement_claimant',
        passwordHash: 'integration-only',
        telegramId: '700000001',
      },
    })
    expect(replacement.telegramId).toBe('700000001')
  })

  it('staff-wide purge cancels only staff legacy rows and preserves the owner legacy delivery', async () => {
    const { shop, owner } = await seedLinkedOwner('legacy_staff_scope')
    const staff = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Legacy staff',
        phone: '+998909999991',
        login: 'legacy_staff_scope',
        passwordHash: 'integration-only',
        telegramId: '700000002',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        telegramNotificationsEnabled: true,
      },
    })
    const [ownerLegacy, staffLegacy] = await Promise.all([
      prisma.notification.create({
        data: {
          shopId: shop.id,
          recipientShopAdminId: owner.id,
          telegramId: owner.telegramId!,
          type: 'REMINDER',
          message: 'Owner legacy delivery',
          scheduledAt: new Date('2026-07-18T00:00:00.000Z'),
        },
      }),
      prisma.notification.create({
        data: {
          shopId: shop.id,
          recipientShopAdminId: staff.id,
          telegramId: staff.telegramId!,
          type: 'REMINDER',
          message: 'Staff legacy delivery',
          scheduledAt: new Date('2026-07-18T00:00:00.000Z'),
        },
      }),
    ])
    // Recreate the pre-trigger legacy shape inside one DDL transaction. ALTER
    // TABLE holds an exclusive lock, so no concurrent test/session can write
    // while the trigger is disabled; ENABLE commits atomically with the rows.
    // If anything throws, PostgreSQL rolls the DISABLE back as well.
    await prisma.$transaction(async (tx) => {
      let triggerDisabled = false
      try {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "Notification" DISABLE TRIGGER "Notification_recipient_required"',
        )
        triggerDisabled = true
        await tx.notification.updateMany({
          where: { id: { in: [ownerLegacy.id, staffLegacy.id] } },
          data: { recipientShopAdminId: null },
        })
      } finally {
        if (triggerDisabled) {
          await tx.$executeRawUnsafe(
            'ALTER TABLE "Notification" ENABLE TRIGGER "Notification_recipient_required"',
          )
        }
      }
    })

    const triggerState = await prisma.$queryRaw<Array<{ enabled: string; definition: string }>>`
      SELECT trigger."tgenabled"::text AS "enabled", pg_get_triggerdef(trigger.oid) AS "definition"
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'Notification'
        AND trigger.tgname = 'Notification_recipient_required'
        AND NOT trigger.tgisinternal
    `
    expect(triggerState).toHaveLength(1)
    expect(triggerState[0]?.enabled).toBe('O')
    expect(triggerState[0]?.definition).toContain('BEFORE INSERT OR UPDATE')

    await prisma.$transaction((tx) => purgeTelegramIdentityInTransaction(
      tx,
      { type: 'SHOP_STAFF', shopId: shop.id, ownerAdminId: owner.id },
      { reason: TELEGRAM_PURGE_REASON.ACCOUNT_INACTIVE },
    ))

    const [storedOwner, storedStaff, ownerNotification, staffNotification] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } }),
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: staff.id } }),
      prisma.notification.findUniqueOrThrow({ where: { id: ownerLegacy.id } }),
      prisma.notification.findUniqueOrThrow({ where: { id: staffLegacy.id } }),
    ])
    expect(storedOwner.telegramId).toBe('700000001')
    expect(storedStaff.telegramId).toBeNull()
    expect(ownerNotification.status).toBe('PENDING')
    expect(ownerNotification.recipientUnavailableReason).toBeNull()
    expect(staffNotification.status).toBe('CANCELLED')
    expect(staffNotification.recipientUnavailableReason).toBe('unlinked_or_unverified')
  })

  it('purges a missed false-package transition even after a newer package re-enables Telegram', async () => {
    const { platformAdmin, shop, owner } = await seedLinkedOwner('future')
    await prisma.$transaction(async (tx) => {
      const disabled = await tx.shopPackageVersion.create({
        data: {
          shopId: shop.id,
          effectiveOn: new Date('2026-07-20T00:00:00.000Z'),
          basePrice: 0,
          discountAmount: 0,
          note: 'Future disable',
          createdById: platformAdmin.id,
          features: { create: packageFeatures({ TELEGRAM: false }) },
        },
        select: { id: true, effectiveOn: true },
      })
      await createTelegramDisableTransitionInTransaction(tx, {
        packageVersionId: disabled.id,
        shopId: shop.id,
        effectiveOn: disabled.effectiveOn,
        now: new Date('2026-07-18T12:00:00.000Z'),
      })
      await tx.shopPackageVersion.create({
        data: {
          shopId: shop.id,
          effectiveOn: new Date('2026-07-21T00:00:00.000Z'),
          basePrice: 0,
          discountAmount: 0,
          note: 'Later re-enable',
          createdById: platformAdmin.id,
          features: { create: packageFeatures() },
        },
      })
    })

    const before = await prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } })
    expect(before.telegramVerifiedAt).not.toBeNull()

    const run = await processDueTelegramDisableTransitions({
      shopId: shop.id,
      limit: 10,
      now: new Date('2026-07-22T19:00:00.000Z'),
    })
    expect(run).toMatchObject({ selected: 1, processed: 1, failed: 0, identitiesCleared: 1 })

    const [after, transition] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } }),
      prisma.telegramDisableTransition.findFirstOrThrow({ where: { shopId: shop.id } }),
    ])
    expect(after.telegramId).toBeNull()
    expect(after.telegramVerifiedAt).toBeNull()
    expect(transition.processedAt).not.toBeNull()
    expect(transition.attemptCount).toBe(1)

    await prisma.shopAdmin.update({
      where: { id: owner.id },
      data: { telegramId: '700000001', telegramVerifiedAt: null },
    })
    const allowed = await prisma.$transaction((tx) => telegramLinkAllowedInTransaction(tx, {
      shopId: shop.id,
      shopAdminId: owner.id,
      now: new Date('2026-07-22T19:00:00.000Z'),
    }))
    expect(allowed).toBe(true)
    expect((await prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } })).telegramVerifiedAt).toBeNull()
  })

  it('releases due-disabled stale IDs immediately for shop-admin and super-admin profile claimants', async () => {
    const prepareDueHolder = async (suffix: string, telegramId: string) => {
      const state = await seedLinkedOwner(suffix)
      await prisma.shopAdmin.update({
        where: { id: state.owner.id },
        data: { telegramId },
      })
      await prisma.$transaction(async (tx) => {
        const disabled = await tx.shopPackageVersion.create({
          data: {
            shopId: state.shop.id,
            effectiveOn: new Date('2026-07-20T00:00:00.000Z'),
            basePrice: 0,
            discountAmount: 0,
            note: 'Due profile-claim disable',
            createdById: state.platformAdmin.id,
            features: {
              create: packageFeatures({ TELEGRAM: false }),
            },
          },
          select: { id: true, effectiveOn: true },
        })
        await createTelegramDisableTransitionInTransaction(tx, {
          packageVersionId: disabled.id,
          shopId: state.shop.id,
          effectiveOn: disabled.effectiveOn,
          now: new Date('2026-07-18T12:00:00.000Z'),
        })
      })
      return state
    }

    const oldShopHolder = await prepareDueHolder('profile_shop_old', '700000041')
    const oldSuperHolder = await prepareDueHolder('profile_super_old', '700000042')
    const claimant = await seedLinkedOwner('profile_claimant')
    await prisma.shopAdmin.update({
      where: { id: claimant.owner.id },
      data: { telegramId: null, telegramVerifiedAt: null },
    })
    const superClaimant = await prisma.superAdmin.create({
      data: { name: 'Profile super claimant', login: 'profile_super_claimant', passwordHash: 'integration-only' },
    })
    const claimNow = new Date('2026-07-22T12:00:00.000Z')

    await reconcileLinkedTelegramIdentity('700000041', claimNow)
    await prisma.$transaction((tx) => linkShopAdminTelegramIdentityInTransaction(tx, {
      shopId: claimant.shop.id,
      shopAdminId: claimant.owner.id,
      telegramId: '700000041',
      now: claimNow,
    }))
    await reconcileLinkedTelegramIdentity('700000042', claimNow)
    await prisma.superAdmin.update({
      where: { id: superClaimant.id },
      data: { telegramId: '700000042', telegramVerifiedAt: null },
    })

    const [releasedShopHolder, releasedSuperHolder, shopClaim, superClaim] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: oldShopHolder.owner.id } }),
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: oldSuperHolder.owner.id } }),
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: claimant.owner.id } }),
      prisma.superAdmin.findUniqueOrThrow({ where: { id: superClaimant.id } }),
    ])
    expect(releasedShopHolder.telegramId).toBeNull()
    expect(releasedSuperHolder.telegramId).toBeNull()
    expect(shopClaim).toMatchObject({ telegramId: '700000041', telegramVerifiedAt: null })
    expect(superClaim).toMatchObject({ telegramId: '700000042', telegramVerifiedAt: null })
  })

  it('denies linking when the shop master or staff personal switch is off', async () => {
    const { shop } = await seedLinkedOwner('denied')
    const staff = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Denied staff',
        phone: '+998903333333',
        login: 'denied_staff',
        passwordHash: 'integration-only',
        telegramNotificationsEnabled: false,
      },
    })

    await expect(prisma.$transaction((tx) => telegramLinkAllowedInTransaction(tx, {
      shopId: shop.id,
      shopAdminId: staff.id,
      now: new Date('2026-07-18T12:00:00.000Z'),
    }))).resolves.toBe(false)

    await prisma.shop.update({
      where: { id: shop.id },
      data: { telegramNotificationsEnabled: false },
    })
    await prisma.shopAdmin.update({
      where: { id: staff.id },
      data: { telegramNotificationsEnabled: true },
    })
    await expect(prisma.$transaction((tx) => telegramLinkAllowedInTransaction(tx, {
      shopId: shop.id,
      shopAdminId: staff.id,
      now: new Date('2026-07-18T12:00:00.000Z'),
    }))).resolves.toBe(false)
  })

  it('serializes link behind a concurrent shop-master disable and cannot resurrect the ID', async () => {
    const { shop, owner } = await seedLinkedOwner('master_race')
    const locked = deferred()
    const release = deferred()
    const disable = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${shop.id} FOR UPDATE`
      await tx.shop.update({ where: { id: shop.id }, data: { telegramNotificationsEnabled: false } })
      locked.resolve()
      await release.promise
      await purgeTelegramIdentityInTransaction(
        tx,
        { type: 'SHOP', shopId: shop.id },
        { reason: TELEGRAM_PURGE_REASON.SHOP_DISABLED },
      )
    })
    await locked.promise
    const link = prisma.$transaction((tx) => linkShopAdminTelegramIdentityInTransaction(tx, {
      shopId: shop.id,
      shopAdminId: owner.id,
      telegramId: '700000099',
    })).then(
      () => ({ ok: true as const, error: null }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await Promise.resolve()
    release.resolve()
    await disable
    const result = await link
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ code: 'TELEGRAM_DISABLED' })
    const stored = await prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } })
    expect(stored.telegramId).toBeNull()
    expect(stored.telegramVerifiedAt).toBeNull()
  })

  it('serializes staff relinking behind personal disable', async () => {
    const { shop } = await seedLinkedOwner('staff_race')
    const staff = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Concurrent staff',
        phone: '+998904444444',
        login: 'concurrent_staff',
        passwordHash: 'integration-only',
        telegramId: '700000010',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        telegramNotificationsEnabled: true,
      },
    })
    const locked = deferred()
    const release = deferred()
    const disable = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${shop.id} FOR UPDATE`
      await tx.shopAdmin.update({
        where: { id: staff.id },
        data: { telegramNotificationsEnabled: false },
      })
      locked.resolve()
      await release.promise
      await purgeTelegramIdentityInTransaction(
        tx,
        { type: 'SHOP_ADMIN', shopId: shop.id, shopAdminId: staff.id },
        { reason: TELEGRAM_PURGE_REASON.STAFF_DISABLED, disablePersonalNotifications: true },
      )
    })
    await locked.promise
    const link = prisma.$transaction((tx) => linkShopAdminTelegramIdentityInTransaction(tx, {
      shopId: shop.id,
      shopAdminId: staff.id,
      telegramId: '700000011',
    })).then(
      () => ({ ok: true as const, error: null }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    release.resolve()
    await disable
    const result = await link
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ code: 'TELEGRAM_DISABLED' })
    expect(await prisma.shopAdmin.findUniqueOrThrow({ where: { id: staff.id } })).toMatchObject({
      telegramId: null,
      telegramVerifiedAt: null,
      telegramNotificationsEnabled: false,
    })
  })

  it('a relink serialized after unlink starts fresh and cannot resurrect verification', async () => {
    const { shop, owner } = await seedLinkedOwner('unlink_race')
    const unlinked = deferred()
    const release = deferred()
    const unlink = prisma.$transaction(async (tx) => {
      await unlinkShopAdminTelegramIdentityInTransaction(tx, {
        shopId: shop.id,
        shopAdminId: owner.id,
      })
      unlinked.resolve()
      await release.promise
    })
    await unlinked.promise
    const relink = prisma.$transaction((tx) => linkShopAdminTelegramIdentityInTransaction(tx, {
      shopId: shop.id,
      shopAdminId: owner.id,
      telegramId: '700000001',
    }))
    release.resolve()
    await Promise.all([unlink, relink])
    const stored = await prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } })
    expect(stored.telegramId).toBe('700000001')
    expect(stored.telegramVerifiedAt).toBeNull()
  })

  it('reconciles stale shop/staff identities before claims and never welcomes a disabled owner', async () => {
    const { shop, owner } = await seedLinkedOwner('reconcile')
    await prisma.shop.update({
      where: { id: shop.id },
      data: { telegramNotificationsEnabled: false },
    })
    await expect(verifyTelegramOwnerForStart('700000001')).resolves.toBeNull()
    await expect(isTelegramIdTaken('700000001')).resolves.toBe(false)
    expect((await prisma.shopAdmin.findUniqueOrThrow({ where: { id: owner.id } })).telegramId).toBeNull()

    await prisma.shop.update({
      where: { id: shop.id },
      data: { telegramNotificationsEnabled: true },
    })
    const staff = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Stale personal staff',
        phone: '+998905555555',
        login: 'stale_personal_staff',
        passwordHash: 'integration-only',
        telegramId: '700000020',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        telegramNotificationsEnabled: false,
      },
    })
    await expect(isTelegramIdTaken('700000020')).resolves.toBe(false)
    expect((await prisma.shopAdmin.findUniqueOrThrow({ where: { id: staff.id } })).telegramId).toBeNull()
  })

  it('reconciles active staff when the active package no longer includes STAFF_ACCESS', async () => {
    const { platformAdmin, shop } = await seedLinkedOwner('staff_access')
    const staff = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'No staff access',
        phone: '+998906666666',
        login: 'no_staff_access',
        passwordHash: 'integration-only',
        telegramId: '700000030',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        telegramNotificationsEnabled: true,
      },
    })
    await prisma.shopPackageVersion.create({
      data: {
        shopId: shop.id,
        effectiveOn: new Date('2026-07-18T00:00:00.000Z'),
        basePrice: 0,
        discountAmount: 0,
        note: 'Staff access removed',
        createdById: platformAdmin.id,
        features: {
          create: packageFeatures({ STAFF_ACCESS: false }),
        },
      },
    })
    await reconcileLinkedTelegramIdentity('700000030', new Date('2026-07-18T12:00:00.000Z'))
    const stored = await prisma.shopAdmin.findUniqueOrThrow({ where: { id: staff.id } })
    expect(stored.telegramId).toBeNull()
    expect(stored.telegramVerifiedAt).toBeNull()
  })
})
