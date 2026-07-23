import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { tashkentTodayInputValue } from '@/lib/timezone'

export const TELEGRAM_AUDIENCES = {
  OWNER_ONLY: 'OWNER_ONLY',
  OWNER_AND_ACTIVE_STAFF: 'OWNER_AND_ACTIVE_STAFF',
} as const

export type TelegramAudience = typeof TELEGRAM_AUDIENCES[keyof typeof TELEGRAM_AUDIENCES]

export const TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS = {
  UNLINKED_OR_UNVERIFIED: 'unlinked_or_unverified',
  PERSONAL_DISABLED: 'personal_disabled',
  SHOP_DISABLED: 'shop_disabled',
  PACKAGE_NOT_ENTITLED: 'package_not_entitled',
  RECIPIENT_LIMIT_REACHED: 'recipient_limit_reached',
} as const

export type TelegramRecipientUnavailableReason =
  typeof TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS[keyof typeof TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS]

export interface TelegramRecipient {
  id: string
  telegramId: string
}

export interface TelegramRecipientGap {
  reason: TelegramRecipientUnavailableReason
  affectedCount: number
}

export interface TelegramRecipientResolution {
  shopId: string
  audience: TelegramAudience
  recipients: TelegramRecipient[]
  gaps: TelegramRecipientGap[]
}

const MAX_TELEGRAM_RECIPIENTS = 100
const MAX_TELEGRAM_STAFF_RECIPIENTS = MAX_TELEGRAM_RECIPIENTS - 1
export const TELEGRAM_NOTIFICATION_TYPES = [
  'DEVICE_CREATED',
  'RESTOCK',
  'SALE',
  'NASIYA',
  'RETURN',
  'PAYMENT_RECEIVED',
  'NASIYA_COMPLETED',
  'NASIYA_IMPORTED',
  'OLIB_SOTDIM_CREATED',
  'SUPPLIER_PAYABLE_PAID',
  'REMINDER',
  'OVERDUE',
  'EARLY_REMINDER',
  'SALE_REMINDER',
  'SALE_OVERDUE',
  'SALE_EARLY_REMINDER',
  'SUPPLIER_PAYABLE_REMINDER',
  'SUPPLIER_PAYABLE_OVERDUE',
  'SUPPLIER_PAYABLE_EARLY_REMINDER',
  'TELEGRAM',
] as const
const TELEGRAM_NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(TELEGRAM_NOTIFICATION_TYPES)
const OWNER_ONLY_NOTIFICATION_TYPES = new Set([
  'DEVICE_CREATED',
  'SALE',
  'OLIB_SOTDIM_CREATED',
])

export function safeTelegramNotificationType(value: unknown): string {
  return typeof value === 'string' && TELEGRAM_NOTIFICATION_TYPE_SET.has(value) ? value : 'TELEGRAM'
}

/** One source of truth for both producer and cancellation-warning audiences. */
export function telegramAudienceForNotificationType(value: unknown): TelegramAudience {
  return OWNER_ONLY_NOTIFICATION_TYPES.has(safeTelegramNotificationType(value))
    ? TELEGRAM_AUDIENCES.OWNER_ONLY
    : TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF
}

type TelegramRecipientReader = Pick<Prisma.TransactionClient, 'shop'> &
  Partial<Pick<Prisma.TransactionClient, '$queryRaw'>>

function businessDate(now: Date) {
  return new Date(`${tashkentTodayInputValue(now)}T00:00:00.000Z`)
}

function addGap(
  gaps: Map<TelegramRecipientUnavailableReason, number>,
  reason: TelegramRecipientUnavailableReason,
  count = 1,
) {
  if (count <= 0) return
  gaps.set(reason, (gaps.get(reason) ?? 0) + count)
}

function telegramOwnerRecipientShopSelect(now: Date) {
  return {
    id: true,
    status: true,
    deletedAt: true,
    ownerAdminId: true,
    telegramNotificationsEnabled: true,
    ownerAdmin: {
      select: {
        id: true,
        telegramId: true,
        telegramVerifiedAt: true,
        telegramNotificationsEnabled: true,
        isActive: true,
        deletedAt: true,
      },
    },
    packageVersions: {
      where: { effectiveOn: { lte: businessDate(now) } },
      orderBy: [{ effectiveOn: 'desc' as const }, { createdAt: 'desc' as const }],
      take: 1,
      select: {
        features: {
          where: { featureCode: { in: ['TELEGRAM', 'STAFF_ACCESS'] } },
          select: { featureCode: true, enabled: true },
        },
      },
    },
  } satisfies Prisma.ShopSelect
}

function telegramOwnerAndStaffRecipientShopSelect(now: Date) {
  return {
    ...telegramOwnerRecipientShopSelect(now),
    admins: {
      where: { isActive: true, deletedAt: null },
      orderBy: { id: 'asc' as const },
      // The owner may also appear in this relation. Reading staff-limit + 2
      // gives us one owner slot plus one overflow sentinel without an
      // unbounded count query.
      take: MAX_TELEGRAM_STAFF_RECIPIENTS + 2,
      select: {
        id: true,
        telegramId: true,
        telegramVerifiedAt: true,
        telegramNotificationsEnabled: true,
        isActive: true,
        deletedAt: true,
      },
    },
  } satisfies Prisma.ShopSelect
}

type TelegramOwnerRecipientShop = Prisma.ShopGetPayload<{
  select: ReturnType<typeof telegramOwnerRecipientShopSelect>
}>
type TelegramOwnerAndStaffRecipientShop = Prisma.ShopGetPayload<{
  select: ReturnType<typeof telegramOwnerAndStaffRecipientShopSelect>
}>
type TelegramRecipientShop = TelegramOwnerRecipientShop | TelegramOwnerAndStaffRecipientShop

function resolveTelegramRecipientSnapshot(
  shop: TelegramRecipientShop | undefined,
  input: { shopId: string; audience: TelegramAudience },
): TelegramRecipientResolution {
  const gaps = new Map<TelegramRecipientUnavailableReason, number>()
  const recipients: TelegramRecipient[] = []
  const owner = shop?.ownerAdmin ?? undefined
  const staffCandidates = shop && 'admins' in shop
    ? shop.admins.filter((admin) => admin.id !== shop.ownerAdminId)
    : []
  const staffOverflow = staffCandidates.length > MAX_TELEGRAM_STAFF_RECIPIENTS
  const staff = staffCandidates.slice(0, MAX_TELEGRAM_STAFF_RECIPIENTS)
  const intended = input.audience === TELEGRAM_AUDIENCES.OWNER_ONLY
    ? owner ? [owner] : []
    : [...(owner ? [owner] : []), ...staff]
  const intendedCount = input.audience === TELEGRAM_AUDIENCES.OWNER_ONLY
    ? 1
    : Math.max(intended.length, 1)
  const enabledFeatures = new Set(
    shop?.packageVersions[0]?.features
      .filter((feature) => feature.enabled)
      .map((feature) => feature.featureCode) ?? [],
  )

  // One sentinel occurrence reports that the bounded delivery audience was
  // truncated. It deliberately does not reveal the number of excess staff.
  if (input.audience === TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF && staffOverflow) {
    addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.RECIPIENT_LIMIT_REACHED)
  }

  if (!shop || shop.status !== 'ACTIVE' || shop.deletedAt || !shop.telegramNotificationsEnabled) {
    addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.SHOP_DISABLED, intendedCount)
  } else if (!enabledFeatures.has('TELEGRAM')) {
    addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.PACKAGE_NOT_ENTITLED, intendedCount)
  } else {
    if (!owner || !owner.isActive || owner.deletedAt) {
      addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.UNLINKED_OR_UNVERIFIED)
    }
    for (const admin of intended) {
      const isOwner = admin.id === shop.ownerAdminId
      if (isOwner && (!admin.isActive || admin.deletedAt)) {
        continue
      } else if (!isOwner && !enabledFeatures.has('STAFF_ACCESS')) {
        addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.PACKAGE_NOT_ENTITLED)
      } else if (!isOwner && !admin.telegramNotificationsEnabled) {
        addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.PERSONAL_DISABLED)
      } else if (!admin.telegramId || !admin.telegramVerifiedAt) {
        addGap(gaps, TELEGRAM_RECIPIENT_UNAVAILABLE_REASONS.UNLINKED_OR_UNVERIFIED)
      } else {
        recipients.push({ id: admin.id, telegramId: admin.telegramId })
      }
    }
  }

  return {
    shopId: input.shopId,
    audience: input.audience,
    recipients,
    gaps: [...gaps.entries()].map(([reason, affectedCount]) => ({ reason, affectedCount })),
  }
}

/**
 * Resolve the intended Telegram audience in one bounded query. This replaces
 * producer-specific recipient lookups and deliberately returns safe aggregate
 * reasons instead of identity details for unavailable recipients.
 */
export async function resolveTelegramRecipients(
  reader: TelegramRecipientReader,
  input: { shopId: string; audience: TelegramAudience; now?: Date },
): Promise<TelegramRecipientResolution> {
  if (typeof reader.$queryRaw === 'function') {
    return resolveTelegramRecipientsTransactionSafe(
      reader as Pick<Prisma.TransactionClient, '$queryRaw'>,
      input,
    )
  }
  const now = input.now ?? new Date()
  if (input.audience === TELEGRAM_AUDIENCES.OWNER_ONLY) {
    const shop = await reader.shop.findUnique({
      where: { id: input.shopId },
      select: telegramOwnerRecipientShopSelect(now),
    })
    return resolveTelegramRecipientSnapshot(shop ?? undefined, input)
  }
  const shop = await reader.shop.findUnique({
    where: { id: input.shopId },
    select: telegramOwnerAndStaffRecipientShopSelect(now),
  })
  return resolveTelegramRecipientSnapshot(shop ?? undefined, input)
}

/**
 * Interactive Prisma transactions own one PostgreSQL connection. The normal
 * nested relation projection may fan out internally, so sensitive mutation
 * paths use this equivalent set-based snapshot to keep recipient selection
 * atomic without overlapping client.query() calls on that connection.
 */
export async function resolveTelegramRecipientsTransactionSafe(
  reader: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: { shopId: string; audience: TelegramAudience; now?: Date },
): Promise<TelegramRecipientResolution> {
  const now = input.now ?? new Date()
  const includeStaff = input.audience === TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF
  const rowLimit = includeStaff ? MAX_TELEGRAM_STAFF_RECIPIENTS + 3 : 1
  const rows = await reader.$queryRaw<Array<{
    id: string
    status: string
    deletedAt: Date | null
    ownerAdminId: string | null
    telegramNotificationsEnabled: boolean
    packageVersionId: string | null
    telegramFeatureEnabled: boolean
    staffAccessFeatureEnabled: boolean
    adminId: string | null
    adminTelegramId: string | null
    adminTelegramVerifiedAt: Date | null
    adminTelegramNotificationsEnabled: boolean | null
    adminIsActive: boolean | null
    adminDeletedAt: Date | null
  }>>(Prisma.sql`
    WITH selected_shop AS (
      SELECT
        shop."id",
        shop."status",
        shop."deletedAt",
        shop."ownerAdminId",
        shop."telegramNotificationsEnabled"
      FROM "Shop" shop
      WHERE shop."id" = ${input.shopId}
      LIMIT 1
    ), active_package AS (
      SELECT package."id"
      FROM "ShopPackageVersion" package
      JOIN selected_shop shop ON shop."id" = package."shopId"
      WHERE package."effectiveOn" <= ${businessDate(now)}
      ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
      LIMIT 1
    )
    SELECT
      shop."id",
      shop."status"::text AS "status",
      shop."deletedAt",
      shop."ownerAdminId",
      shop."telegramNotificationsEnabled",
      package."id" AS "packageVersionId",
      EXISTS (
        SELECT 1
        FROM "ShopPackageFeature" feature
        WHERE feature."packageVersionId" = package."id"
          AND feature."featureCode" = 'TELEGRAM'
          AND feature."enabled" = TRUE
      ) AS "telegramFeatureEnabled",
      EXISTS (
        SELECT 1
        FROM "ShopPackageFeature" feature
        WHERE feature."packageVersionId" = package."id"
          AND feature."featureCode" = 'STAFF_ACCESS'
          AND feature."enabled" = TRUE
      ) AS "staffAccessFeatureEnabled",
      admin."id" AS "adminId",
      admin."telegramId" AS "adminTelegramId",
      admin."telegramVerifiedAt" AS "adminTelegramVerifiedAt",
      admin."telegramNotificationsEnabled" AS "adminTelegramNotificationsEnabled",
      admin."isActive" AS "adminIsActive",
      admin."deletedAt" AS "adminDeletedAt"
    FROM selected_shop shop
    LEFT JOIN active_package package ON TRUE
    LEFT JOIN "ShopAdmin" admin
      ON admin."shopId" = shop."id"
      AND (
        admin."id" = shop."ownerAdminId"
        OR (
          ${includeStaff}
          AND admin."id" IS DISTINCT FROM shop."ownerAdminId"
          AND admin."isActive" = TRUE
          AND admin."deletedAt" IS NULL
        )
      )
    ORDER BY
      CASE WHEN admin."id" = shop."ownerAdminId" THEN 0 ELSE 1 END,
      admin."id" ASC
    LIMIT ${rowLimit}
  `)
  const first = rows[0]
  if (!first) return resolveTelegramRecipientSnapshot(undefined, input)
  const toAdmin = (row: typeof first) => ({
    id: row.adminId as string,
    telegramId: row.adminTelegramId,
    telegramVerifiedAt: row.adminTelegramVerifiedAt,
    telegramNotificationsEnabled: row.adminTelegramNotificationsEnabled ?? false,
    isActive: row.adminIsActive ?? false,
    deletedAt: row.adminDeletedAt,
  })
  const ownerRow = rows.find((row) => row.adminId != null && row.adminId === first.ownerAdminId)
  const features = [
    ...(first.telegramFeatureEnabled ? [{ featureCode: 'TELEGRAM', enabled: true }] : []),
    ...(first.staffAccessFeatureEnabled ? [{ featureCode: 'STAFF_ACCESS', enabled: true }] : []),
  ]
  const snapshot = {
    id: first.id,
    status: first.status,
    deletedAt: first.deletedAt,
    ownerAdminId: first.ownerAdminId,
    telegramNotificationsEnabled: first.telegramNotificationsEnabled,
    ownerAdmin: ownerRow ? toAdmin(ownerRow) : null,
    packageVersions: first.packageVersionId ? [{ features }] : [],
    ...(includeStaff
      ? { admins: rows.filter((row) => row.adminId != null).map(toAdmin) }
      : {}),
  } as TelegramRecipientShop
  return resolveTelegramRecipientSnapshot(snapshot, input)
}

async function resolveTelegramRecipientsMany(
  reader: TelegramRecipientReader,
  input: { shopIds: readonly string[]; audience: TelegramAudience; now?: Date },
) {
  const now = input.now ?? new Date()
  const shopIds = [...new Set(input.shopIds)].slice(0, 100)
  const shops: TelegramRecipientShop[] = shopIds.length === 0
    ? []
    : input.audience === TELEGRAM_AUDIENCES.OWNER_ONLY
      ? await reader.shop.findMany({
          where: { id: { in: shopIds } },
          orderBy: { id: 'asc' },
          take: 100,
          select: telegramOwnerRecipientShopSelect(now),
        })
      : await reader.shop.findMany({
          where: { id: { in: shopIds } },
          orderBy: { id: 'asc' },
          take: 100,
          select: telegramOwnerAndStaffRecipientShopSelect(now),
        })
  const byId = new Map(shops.map((shop) => [shop.id, shop]))
  return new Map(shopIds.map((shopId) => [
    shopId,
    resolveTelegramRecipientSnapshot(byId.get(shopId), { shopId, audience: input.audience }),
  ]))
}

export function telegramNotificationRows(
  resolution: TelegramRecipientResolution,
  input: {
    type: string
    message: string
    scheduledAt: Date | ((recipient: TelegramRecipient) => Date)
    relatedId?: string | null
    relatedType?: string | null
    dedupeKey?: (recipient: TelegramRecipient) => string
  },
): Prisma.NotificationCreateManyInput[] {
  return resolution.recipients.map((recipient) => ({
    shopId: resolution.shopId,
    type: safeTelegramNotificationType(input.type),
    message: input.message,
    telegramId: recipient.telegramId,
    recipientShopAdminId: recipient.id,
    scheduledAt: typeof input.scheduledAt === 'function'
      ? input.scheduledAt(recipient)
      : input.scheduledAt,
    relatedId: input.relatedId ?? null,
    relatedType: input.relatedType ?? null,
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey(recipient) } : {}),
  }))
}

/**
 * One durable, privacy-safe cancellation marker per unavailable gap category.
 * The source scope is hashed so replay remains idempotent without copying an
 * entity, customer, Telegram, or recipient ID into the marker.
 */
export function telegramUnavailableMarkerRows(
  resolution: TelegramRecipientResolution,
  input: {
    type: string
    dedupeScope: string
    cancelledAt?: Date
  },
): Prisma.NotificationCreateManyInput[] {
  const notificationType = safeTelegramNotificationType(input.type)
  const cancelledAt = input.cancelledAt ?? new Date()
  return resolution.gaps.map((gap) => {
    const digest = createHash('sha256')
      .update([
        resolution.shopId,
        notificationType,
        resolution.audience,
        gap.reason,
        input.dedupeScope,
      ].join('\0'))
      .digest('hex')
    return {
      shopId: resolution.shopId,
      dedupeKey: `TELEGRAM_GAP:${digest}`,
      type: notificationType,
      message: '',
      telegramId: '',
      recipientShopAdminId: null,
      status: 'CANCELLED',
      scheduledAt: cancelledAt,
      cancelledAt,
      lastError: `Cancelled before delivery: ${gap.reason}`,
      recipientUnavailableReason: gap.reason,
      relatedId: null,
      relatedType: null,
      sentAt: null,
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      mediaKeys: [],
      mediaSentPositions: [],
      mediaSnapshotAt: null,
      textSentAt: null,
    }
  })
}

/** Small LRU used by cron so repeated rows for one shop reuse the same active
 * package/admin resolution without allowing the process map to grow forever. */
export class TelegramRecipientResolverCache {
  private readonly resolutions = new Map<string, TelegramRecipientResolution>()

  constructor(private readonly maxEntries = 100) {}

  async primeMany(
    reader: TelegramRecipientReader,
    input: { shopIds: readonly string[]; audience: TelegramAudience; now?: Date },
  ) {
    const missing = [...new Set(input.shopIds)]
      .filter((shopId) => !this.resolutions.has(`${shopId}:${input.audience}`))
      .slice(0, this.maxEntries)
    const resolutions = await resolveTelegramRecipientsMany(reader, { ...input, shopIds: missing })
    for (const [shopId, resolution] of resolutions) {
      const key = `${shopId}:${input.audience}`
      if (this.resolutions.size >= this.maxEntries) {
        const oldest = this.resolutions.keys().next().value
        if (oldest) this.resolutions.delete(oldest)
      }
      this.resolutions.set(key, resolution)
    }
  }

  async resolve(
    reader: TelegramRecipientReader,
    input: { shopId: string; audience: TelegramAudience; now?: Date },
  ) {
    const key = `${input.shopId}:${input.audience}`
    const cached = this.resolutions.get(key)
    if (cached) {
      this.resolutions.delete(key)
      this.resolutions.set(key, cached)
      return cached
    }
    const resolution = await resolveTelegramRecipients(reader, input)
    if (this.resolutions.size >= this.maxEntries) {
      const oldest = this.resolutions.keys().next().value
      if (oldest) this.resolutions.delete(oldest)
    }
    this.resolutions.set(key, resolution)
    return resolution
  }
}
