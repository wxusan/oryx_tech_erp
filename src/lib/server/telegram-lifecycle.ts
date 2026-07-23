import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { enabledFeatureSet, getActiveShopPackage } from '@/lib/server/shop-access'
import { tashkentTodayInputValue } from '@/lib/timezone'
import {
  TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS,
  type TelegramRecipientUnavailableReason,
} from '@/lib/server/telegram-recipients'

const STALE_PROCESSING_MS = 5 * 60 * 1000
const DEFAULT_TRANSITION_BATCH_SIZE = 50
const MAX_TRANSITION_BATCH_SIZE = 100

export const TELEGRAM_PURGE_REASON = {
  PACKAGE_DISABLED: 'telegram_package_disabled',
  SHOP_DISABLED: 'telegram_shop_disabled',
  STAFF_DISABLED: 'telegram_staff_disabled',
  SELF_UNLINKED: 'telegram_self_unlinked',
  ACCOUNT_INACTIVE: 'telegram_account_inactive',
  ACCOUNT_DELETED: 'telegram_account_deleted',
  SHOP_DELETED: 'telegram_shop_deleted',
} as const

export type TelegramPurgeReason = typeof TELEGRAM_PURGE_REASON[keyof typeof TELEGRAM_PURGE_REASON]

export interface TelegramPurgeResult {
  identitiesCleared: number
  notificationsCancelled: number
}

function purgeWarningReason(reason: TelegramPurgeReason): TelegramRecipientUnavailableReason {
  if (reason === TELEGRAM_PURGE_REASON.PACKAGE_DISABLED) {
    return TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.PACKAGE_NOT_ENTITLED
  }
  if (reason === TELEGRAM_PURGE_REASON.SHOP_DISABLED) {
    return TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.SHOP_DISABLED
  }
  if (reason === TELEGRAM_PURGE_REASON.STAFF_DISABLED) {
    return TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.PERSONAL_DISABLED
  }
  return TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.UNLINKED_OR_UNVERIFIED
}

type TelegramPurgeTarget =
  | { type: 'SHOP'; shopId: string }
  | { type: 'SHOP_STAFF'; shopId: string; ownerAdminId: string }
  | { type: 'SHOP_ADMIN'; shopId: string; shopAdminId: string }

function actionableNotificationWhere(now: Date): Prisma.NotificationWhereInput {
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS)
  return {
    OR: [
      { status: { in: ['PENDING', 'FAILED'] } },
      {
        status: 'PROCESSING',
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: staleBefore } }],
      },
    ],
  }
}

async function cancelLegacyStaffNotificationsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    shopId: string
    ownerAdminId: string
    now: Date
    lastError: string
    reason: TelegramRecipientUnavailableReason
  },
) {
  const staleBefore = new Date(input.now.getTime() - STALE_PROCESSING_MS)
  return tx.$executeRaw(Prisma.sql`
    UPDATE "Notification" notification
    SET "status" = 'CANCELLED',
        "nextAttemptAt" = NULL,
        "lastError" = ${input.lastError},
        "recipientUnavailableReason" = ${input.reason},
        "cancelledAt" = ${input.now}
    WHERE notification."shopId" = ${input.shopId}
      AND notification."recipientShopAdminId" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "ShopAdmin" staff
        WHERE staff."shopId" = ${input.shopId}
          AND staff."id" <> ${input.ownerAdminId}
          AND staff."telegramId" IS NOT NULL
          AND staff."telegramId" = notification."telegramId"
      )
      AND (
        notification."status" IN ('PENDING', 'FAILED')
        OR (
          notification."status" = 'PROCESSING'
          AND (
            notification."lastAttemptAt" IS NULL
            OR notification."lastAttemptAt" <= ${staleBefore}
          )
        )
      )
  `)
}

/**
 * Clear a Telegram identity and cancel its actionable delivery rows in the
 * caller's transaction. Shop-wide purges deliberately preserve every member's
 * personal allow flag; only a personal staff disable passes
 * `disablePersonalNotifications`.
 */
export async function purgeTelegramIdentityInTransaction(
  tx: Prisma.TransactionClient,
  target: TelegramPurgeTarget,
  input: {
    reason: TelegramPurgeReason
    now?: Date
    disablePersonalNotifications?: boolean
  },
): Promise<TelegramPurgeResult> {
  const now = input.now ?? new Date()
  const safeLastError = `Telegram delivery cancelled: ${input.reason}`

  if (target.type === 'SHOP' || target.type === 'SHOP_STAFF') {
    const memberWhere: Prisma.ShopAdminWhereInput = {
      shopId: target.shopId,
      ...(target.type === 'SHOP_STAFF' ? { id: { not: target.ownerAdminId } } : {}),
    }
    // Legacy rows lack recipientShopAdminId. Match them set-wise against the
    // disabled staff identities before clearing those IDs; owner legacy rows
    // remain actionable.
    const legacyNotificationsCancelled = target.type === 'SHOP_STAFF'
      ? await cancelLegacyStaffNotificationsInTransaction(tx, {
          shopId: target.shopId,
          ownerAdminId: target.ownerAdminId,
          now,
          lastError: safeLastError,
          reason: purgeWarningReason(input.reason),
        })
      : 0
    const recipientWhere: Prisma.NotificationWhereInput = target.type === 'SHOP_STAFF'
      ? { recipientShopAdminId: { not: target.ownerAdminId } }
      : {}
    const notificationWhere: Prisma.NotificationWhereInput = {
      shopId: target.shopId,
      AND: [recipientWhere, actionableNotificationWhere(now)],
    }
    const [identities, notifications] = await Promise.all([
      tx.shopAdmin.updateMany({
        where: {
          ...memberWhere,
          OR: [{ telegramId: { not: null } }, { telegramVerifiedAt: { not: null } }],
        },
        data: { telegramId: null, telegramVerifiedAt: null },
      }),
      tx.notification.updateMany({
        where: notificationWhere,
        data: {
          status: 'CANCELLED',
          nextAttemptAt: null,
          lastError: safeLastError,
          recipientUnavailableReason: purgeWarningReason(input.reason),
          cancelledAt: now,
        },
      }),
    ])
    return {
      identitiesCleared: identities.count,
      notificationsCancelled: notifications.count + legacyNotificationsCancelled,
    }
  }

  const current = await tx.shopAdmin.findFirst({
    where: { id: target.shopAdminId, shopId: target.shopId },
    select: { telegramId: true },
  })
  const notificationTarget: Prisma.NotificationWhereInput = current?.telegramId
    ? {
        OR: [
          { recipientShopAdminId: target.shopAdminId },
          { recipientShopAdminId: null, telegramId: current.telegramId },
        ],
      }
    : { recipientShopAdminId: target.shopAdminId }
  const notificationWhere: Prisma.NotificationWhereInput = {
    shopId: target.shopId,
    AND: [notificationTarget, actionableNotificationWhere(now)],
  }

  const [identities, notifications] = await Promise.all([
    tx.shopAdmin.updateMany({
      where: {
        id: target.shopAdminId,
        shopId: target.shopId,
        ...(input.disablePersonalNotifications
          ? {}
          : { OR: [{ telegramId: { not: null } }, { telegramVerifiedAt: { not: null } }] }),
      },
      data: {
        telegramId: null,
        telegramVerifiedAt: null,
        ...(input.disablePersonalNotifications ? { telegramNotificationsEnabled: false } : {}),
      },
    }),
    tx.notification.updateMany({
      where: notificationWhere,
      data: {
        status: 'CANCELLED',
        nextAttemptAt: null,
        lastError: safeLastError,
        recipientUnavailableReason: purgeWarningReason(input.reason),
        cancelledAt: now,
      },
    }),
  ])
  return { identitiesCleared: identities.count, notificationsCancelled: notifications.count }
}

function businessDate(now: Date) {
  return new Date(`${tashkentTodayInputValue(now)}T00:00:00.000Z`)
}

export async function createTelegramDisableTransitionInTransaction(
  tx: Prisma.TransactionClient,
  input: { packageVersionId: string; shopId: string; effectiveOn: Date; now?: Date },
) {
  const now = input.now ?? new Date()
  const transition = await tx.telegramDisableTransition.create({
    data: {
      packageVersionId: input.packageVersionId,
      shopId: input.shopId,
      effectiveOn: input.effectiveOn,
    },
    select: { id: true, effectiveOn: true },
  })

  if (transition.effectiveOn > businessDate(now)) {
    return { transitionId: transition.id, processed: false, purge: null }
  }

  const purge = await purgeTelegramIdentityInTransaction(
    tx,
    { type: 'SHOP', shopId: input.shopId },
    { reason: TELEGRAM_PURGE_REASON.PACKAGE_DISABLED, now },
  )
  await tx.telegramDisableTransition.update({
    where: { id: transition.id },
    data: {
      processedAt: now,
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      outcome: purge.identitiesCleared || purge.notificationsCancelled ? 'PURGED' : 'NO_ACTION_REQUIRED',
      lastError: null,
    },
  })
  return { transitionId: transition.id, processed: true, purge }
}

export interface TelegramDisableTransitionRun {
  selected: number
  processed: number
  failed: number
  identitiesCleared: number
  notificationsCancelled: number
  mayHaveMore: boolean
}

/** Bounded, retryable worker used by cron and safety backstops. */
export async function processDueTelegramDisableTransitions(input: {
  shopId?: string
  limit?: number
  now?: Date
} = {}): Promise<TelegramDisableTransitionRun> {
  const now = input.now ?? new Date()
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_TRANSITION_BATCH_SIZE), 1), MAX_TRANSITION_BATCH_SIZE)
  const candidates = await prisma.telegramDisableTransition.findMany({
    where: {
      ...(input.shopId ? { shopId: input.shopId } : {}),
      processedAt: null,
      effectiveOn: { lte: businessDate(now) },
    },
    orderBy: [{ effectiveOn: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: { id: true, shopId: true },
  })

  const selected = candidates.slice(0, limit)
  const summary: TelegramDisableTransitionRun = {
    selected: selected.length,
    processed: 0,
    failed: 0,
    identitiesCleared: 0,
    notificationsCancelled: 0,
    mayHaveMore: candidates.length > limit,
  }

  const groups = new Map<string, string[]>()
  for (const candidate of selected) {
    const ids = groups.get(candidate.shopId) ?? []
    ids.push(candidate.id)
    groups.set(candidate.shopId, ids)
  }

  for (const [shopId, candidateIds] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "TelegramDisableTransition"
          WHERE "id" IN (${Prisma.join(candidateIds)})
            AND "processedAt" IS NULL
          ORDER BY "effectiveOn" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
        `)
        if (!locked.length) return null

        const purge = await purgeTelegramIdentityInTransaction(
          tx,
          { type: 'SHOP', shopId },
          { reason: TELEGRAM_PURGE_REASON.PACKAGE_DISABLED, now },
        )
        await tx.telegramDisableTransition.updateMany({
          where: { id: { in: locked.map((transition) => transition.id) }, processedAt: null },
          data: {
            processedAt: now,
            lastAttemptAt: now,
            attemptCount: { increment: 1 },
            outcome: purge.identitiesCleared || purge.notificationsCancelled ? 'PURGED' : 'NO_ACTION_REQUIRED',
            lastError: null,
          },
        })
        return { purge, processed: locked.length }
      })
      if (!result) continue
      summary.processed += result.processed
      summary.identitiesCleared += result.purge.identitiesCleared
      summary.notificationsCancelled += result.purge.notificationsCancelled
    } catch {
      summary.failed += candidateIds.length
      await prisma.telegramDisableTransition.updateMany({
        where: { id: { in: candidateIds }, processedAt: null },
        data: {
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
          outcome: 'ERROR',
          lastError: 'Telegram identity purge failed',
        },
      }).catch(() => undefined)
    }
  }

  return summary
}

export async function shopHasDueTelegramDisableTransition(shopId: string, now = new Date()) {
  const transition = await prisma.telegramDisableTransition.findFirst({
    where: { shopId, processedAt: null, effectiveOn: { lte: businessDate(now) } },
    orderBy: [{ effectiveOn: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  return Boolean(transition)
}

export async function shopTelegramEntitlement(
  reader: Prisma.TransactionClient | typeof prisma,
  shopId: string,
  now = new Date(),
) {
  const [shop, activePackage] = await Promise.all([
    reader.shop.findFirst({
      where: { id: shopId, status: 'ACTIVE', deletedAt: null },
      select: { telegramNotificationsEnabled: true, ownerAdminId: true },
    }),
    getActiveShopPackage(shopId, now, reader),
  ])
  return {
    ownerAdminId: shop?.ownerAdminId ?? null,
    shopEnabled: shop?.telegramNotificationsEnabled === true,
    packageEnabled: enabledFeatureSet(activePackage).has('TELEGRAM'),
    staffAccessEnabled: enabledFeatureSet(activePackage).has('STAFF_ACCESS'),
  }
}

export async function telegramPreassignmentAllowed(
  reader: Prisma.TransactionClient | typeof prisma,
  shopId: string,
  now = new Date(),
) {
  const [entitlement, dueTransition] = await Promise.all([
    shopTelegramEntitlement(reader, shopId, now),
    reader.telegramDisableTransition.findFirst({
      where: { shopId, processedAt: null, effectiveOn: { lte: businessDate(now) } },
      select: { id: true },
    }),
  ])
  return entitlement.packageEnabled && entitlement.shopEnabled && !dueTransition
}

export async function telegramLinkAllowedInTransaction(
  tx: Prisma.TransactionClient,
  input: { shopId: string; shopAdminId: string; now?: Date },
) {
  return (await lockTelegramShopActorInTransaction(tx, input))?.allowed ?? false
}

export interface LockedTelegramShopActor {
  actor: {
    id: string
    shopId: string
    name: string
    login: string
    telegramId: string | null
    telegramVerifiedAt: Date | null
    telegramNotificationsEnabled: boolean
    isActive: boolean
    deletedAt: Date | null
  }
  shop: {
    id: string
    name: string
    ownerAdminId: string | null
    telegramNotificationsEnabled: boolean
    status: string
    deletedAt: Date | null
  }
  packageEnabled: boolean
  staffAccessEnabled: boolean
  dueTransition: boolean
  isOwner: boolean
  allowed: boolean
}

/**
 * Canonical lock order for every ShopAdmin Telegram mutation:
 * Shop -> ShopAdmin -> (optional) Telegram advisory claim.
 * Package, shop-master, staff-toggle and deletion mutations all lock/update the
 * Shop row first, so no disable can commit between this eligibility read and
 * the identity write.
 */
export async function lockTelegramShopActorInTransaction(
  tx: Prisma.TransactionClient,
  input: { shopId: string; shopAdminId: string; now?: Date },
): Promise<LockedTelegramShopActor | null> {
  const now = input.now ?? new Date()
  const shopLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Shop" WHERE "id" = ${input.shopId} FOR UPDATE
  `)
  if (!shopLock[0]) return null
  const actorLock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "ShopAdmin"
    WHERE "id" = ${input.shopAdminId} AND "shopId" = ${input.shopId}
    FOR UPDATE
  `)
  if (!actorLock[0]) return null

  const [shop, actor, activePackage, dueTransition] = await Promise.all([
    tx.shop.findUnique({
      where: { id: input.shopId },
      select: {
        id: true,
        name: true,
        ownerAdminId: true,
        telegramNotificationsEnabled: true,
        status: true,
        deletedAt: true,
      },
    }),
    tx.shopAdmin.findFirst({
      where: { id: input.shopAdminId, shopId: input.shopId },
      select: {
        id: true,
        shopId: true,
        name: true,
        login: true,
        telegramId: true,
        telegramVerifiedAt: true,
        telegramNotificationsEnabled: true,
        isActive: true,
        deletedAt: true,
      },
    }),
    getActiveShopPackage(input.shopId, now, tx),
    tx.telegramDisableTransition.findFirst({
      where: { shopId: input.shopId, processedAt: null, effectiveOn: { lte: businessDate(now) } },
      select: { id: true },
    }),
  ])
  if (!shop || !actor) return null

  const enabled = enabledFeatureSet(activePackage)
  const isOwner = shop.ownerAdminId === actor.id
  const packageEnabled = enabled.has('TELEGRAM')
  const staffAccessEnabled = enabled.has('STAFF_ACCESS')
  const actorActive = actor.isActive && actor.deletedAt === null
  const shopActive = shop.status === 'ACTIVE' && shop.deletedAt === null
  const memberAllowed = isOwner || (actor.telegramNotificationsEnabled && staffAccessEnabled)
  return {
    actor,
    shop,
    packageEnabled,
    staffAccessEnabled,
    dueTransition: Boolean(dueTransition),
    isOwner,
    allowed: actorActive && shopActive && shop.telegramNotificationsEnabled &&
      packageEnabled && !dueTransition && memberAllowed,
  }
}

export async function linkShopAdminTelegramIdentityInTransaction(
  tx: Prisma.TransactionClient,
  input: { shopId: string; shopAdminId: string; telegramId: string; now?: Date },
) {
  const state = await lockTelegramShopActorInTransaction(tx, input)
  if (!state) throw Object.assign(new Error('ADMIN_NOT_FOUND'), { code: 'ADMIN_NOT_FOUND' })
  if (!state.allowed) throw Object.assign(new Error('TELEGRAM_DISABLED'), { code: 'TELEGRAM_DISABLED' })

  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.telegramId}, 0))`)
  const [superAdminOwner, shopAdminOwner] = await Promise.all([
    tx.superAdmin.findFirst({
      where: { telegramId: input.telegramId, deletedAt: null },
      select: { id: true },
    }),
    tx.shopAdmin.findFirst({
      where: { telegramId: input.telegramId, deletedAt: null, id: { not: state.actor.id } },
      select: { id: true },
    }),
  ])
  if (superAdminOwner || shopAdminOwner) {
    throw Object.assign(new Error('TELEGRAM_TAKEN'), { code: 'TELEGRAM_TAKEN' })
  }

  await tx.shopAdmin.update({
    where: { id: state.actor.id },
    data: {
      telegramId: input.telegramId,
      telegramVerifiedAt: state.actor.telegramId === input.telegramId
        ? state.actor.telegramVerifiedAt
        : null,
      ...(state.isOwner ? { telegramNotificationsEnabled: true } : {}),
    },
  })
  return state
}

export async function unlinkShopAdminTelegramIdentityInTransaction(
  tx: Prisma.TransactionClient,
  input: { shopId: string; shopAdminId: string; now?: Date },
) {
  const state = await lockTelegramShopActorInTransaction(tx, input)
  if (!state) throw Object.assign(new Error('ADMIN_NOT_FOUND'), { code: 'ADMIN_NOT_FOUND' })
  await purgeTelegramIdentityInTransaction(
    tx,
    { type: 'SHOP_ADMIN', shopId: input.shopId, shopAdminId: input.shopAdminId },
    { reason: TELEGRAM_PURGE_REASON.SELF_UNLINKED, now: input.now },
  )
  return state
}

function reconciliationReason(state: LockedTelegramShopActor): TelegramPurgeReason {
  if (state.actor.deletedAt) return TELEGRAM_PURGE_REASON.ACCOUNT_DELETED
  if (!state.actor.isActive) return TELEGRAM_PURGE_REASON.ACCOUNT_INACTIVE
  if (state.shop.deletedAt) return TELEGRAM_PURGE_REASON.SHOP_DELETED
  if (state.shop.status !== 'ACTIVE' || !state.shop.telegramNotificationsEnabled) {
    return TELEGRAM_PURGE_REASON.SHOP_DISABLED
  }
  if (!state.packageEnabled || state.dueTransition) return TELEGRAM_PURGE_REASON.PACKAGE_DISABLED
  return TELEGRAM_PURGE_REASON.STAFF_DISABLED
}

/** Release historic/stale identities that pre-date the transactional hooks. */
export async function reconcileLinkedTelegramIdentity(telegramId: string, now = new Date()) {
  const linked = await prisma.shopAdmin.findFirst({
    where: { telegramId },
    select: { id: true, shopId: true },
  })
  if (!linked) return { found: false, released: false }

  // One grouped transaction for this shop, not one transaction per version.
  await processDueTelegramDisableTransitions({ shopId: linked.shopId, limit: 10, now })
  return prisma.$transaction(async (tx) => {
    const state = await lockTelegramShopActorInTransaction(tx, {
      shopId: linked.shopId,
      shopAdminId: linked.id,
      now,
    })
    if (!state || state.actor.telegramId !== telegramId) return { found: false, released: false }
    if (state.allowed) return { found: true, released: false }
    await purgeTelegramIdentityInTransaction(
      tx,
      { type: 'SHOP_ADMIN', shopId: state.actor.shopId, shopAdminId: state.actor.id },
      { reason: reconciliationReason(state), now },
    )
    return { found: true, released: true }
  })
}

export type VerifiedTelegramStartOwner =
  | { type: 'SUPER_ADMIN'; user: { id: string; name: string } }
  | { type: 'SHOP_ADMIN'; user: { id: string; name: string; shop: { id: string; name: string } } }

/** Verify /start under the same locks as disable/unlink and return only current data. */
export async function verifyTelegramOwnerForStart(
  telegramId: string,
  now = new Date(),
): Promise<VerifiedTelegramStartOwner | null> {
  await reconcileLinkedTelegramIdentity(telegramId, now)
  const [shopCandidate, superCandidate] = await Promise.all([
    prisma.shopAdmin.findFirst({ where: { telegramId }, select: { id: true, shopId: true } }),
    prisma.superAdmin.findFirst({ where: { telegramId, deletedAt: null }, select: { id: true } }),
  ])

  if (shopCandidate) {
    return prisma.$transaction(async (tx) => {
      const state = await lockTelegramShopActorInTransaction(tx, {
        shopId: shopCandidate.shopId,
        shopAdminId: shopCandidate.id,
        now,
      })
      if (!state || !state.allowed || state.actor.telegramId !== telegramId) return null
      const stamped = await tx.shopAdmin.updateMany({
        where: { id: state.actor.id, shopId: state.actor.shopId, telegramId },
        data: {
          telegramVerifiedAt: state.actor.telegramVerifiedAt ?? now,
          ...(state.isOwner ? { telegramNotificationsEnabled: true } : {}),
        },
      })
      if (stamped.count !== 1) return null
      return {
        type: 'SHOP_ADMIN' as const,
        user: {
          id: state.actor.id,
          name: state.actor.name,
          shop: { id: state.shop.id, name: state.shop.name },
        },
      }
    })
  }

  if (!superCandidate) return null
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "SuperAdmin" WHERE "id" = ${superCandidate.id} FOR UPDATE
    `)
    if (!locked[0]) return null
    const actor = await tx.superAdmin.findFirst({
      where: { id: superCandidate.id, telegramId, deletedAt: null },
      select: { id: true, name: true, telegramVerifiedAt: true },
    })
    if (!actor) return null
    await tx.superAdmin.update({
      where: { id: actor.id },
      data: { telegramVerifiedAt: actor.telegramVerifiedAt ?? now },
    })
    return { type: 'SUPER_ADMIN' as const, user: { id: actor.id, name: actor.name } }
  })
}
