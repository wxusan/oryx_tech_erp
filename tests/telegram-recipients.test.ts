import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  resolveTelegramRecipients,
  safeTelegramNotificationType,
  telegramAudienceForNotificationType,
  telegramNotificationRows,
  telegramUnavailableMarkerRows,
  TelegramRecipientResolverCache,
  TELEGRAM_AUDIENCES,
  TELEGRAM_NOTIFICATION_TYPES,
} from '@/lib/server/telegram-recipients'

function shop(overrides: Record<string, unknown> = {}) {
  const owner = {
    id: 'owner-1',
    telegramId: '700000001',
    telegramVerifiedAt: new Date('2026-07-18T00:00:00.000Z'),
    telegramNotificationsEnabled: false,
    isActive: true,
    deletedAt: null,
  }
  return {
    id: 'shop-1',
    status: 'ACTIVE',
    deletedAt: null,
    ownerAdminId: 'owner-1',
    ownerAdmin: owner,
    telegramNotificationsEnabled: true,
    admins: [
      owner,
      {
        id: 'staff-disabled',
        telegramId: null,
        telegramVerifiedAt: null,
        telegramNotificationsEnabled: false,
      },
      {
        id: 'staff-unlinked',
        telegramId: null,
        telegramVerifiedAt: null,
        telegramNotificationsEnabled: true,
      },
    ],
    packageVersions: [{
      features: [
        { featureCode: 'TELEGRAM', enabled: true },
        { featureCode: 'STAFF_ACCESS', enabled: true },
      ],
    }],
    ...overrides,
  }
}

describe('Telegram recipient resolver', () => {
  it('does not fetch the staff relation for owner-only notification types', async () => {
    const reader = { shop: { findUnique: vi.fn().mockResolvedValue(shop()) } }

    const result = await resolveTelegramRecipients(reader as never, {
      shopId: 'shop-1',
      audience: TELEGRAM_AUDIENCES.OWNER_ONLY,
    })

    expect(result.recipients).toEqual([{ id: 'owner-1', telegramId: '700000001' }])
    const select = reader.shop.findUnique.mock.calls[0]?.[0]?.select
    expect(select).toHaveProperty('ownerAdmin')
    expect(select).not.toHaveProperty('admins')
  })

  it('keeps owner delivery independent of the staff personal flag and reports closed staff reasons', async () => {
    const reader = { shop: { findUnique: vi.fn().mockResolvedValue(shop()) } }
    const result = await resolveTelegramRecipients(reader as never, {
      shopId: 'shop-1',
      audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
    })

    expect(result.recipients).toEqual([{ id: 'owner-1', telegramId: '700000001' }])
    expect(result.gaps).toEqual(expect.arrayContaining([
      { reason: 'personal_disabled', affectedCount: 1 },
      { reason: 'unlinked_or_unverified', affectedCount: 1 },
    ]))
    expect(telegramNotificationRows(result, {
      type: 'RETURN',
      message: 'private body',
      scheduledAt: new Date(),
    })).toHaveLength(1)
  })

  it('batch-primes a bounded page and serves row resolution without N+1 lookups', async () => {
    const reader = {
      shop: {
        findMany: vi.fn().mockResolvedValue([shop()]),
        findUnique: vi.fn(),
      },
    }
    const cache = new TelegramRecipientResolverCache(100)
    await cache.primeMany(reader as never, {
      shopIds: ['shop-1', 'shop-1'],
      audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
    })
    await cache.resolve(reader as never, {
      shopId: 'shop-1',
      audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
    })

    expect(reader.shop.findMany).toHaveBeenCalledTimes(1)
    expect(reader.shop.findUnique).not.toHaveBeenCalled()
  })

  it('always reserves the owner and reports staff overflow without an exact excess count', async () => {
    const activeStaff = Array.from({ length: 101 }, (_, index) => ({
      id: `staff-${String(index).padStart(3, '0')}`,
      telegramId: `800000${String(index).padStart(3, '0')}`,
      telegramVerifiedAt: new Date('2026-07-18T00:00:00.000Z'),
      telegramNotificationsEnabled: true,
      isActive: true,
      deletedAt: null,
    }))
    const snapshot = shop({ admins: activeStaff })
    const reader = { shop: { findUnique: vi.fn().mockResolvedValue(snapshot) } }

    const result = await resolveTelegramRecipients(reader as never, {
      shopId: 'shop-1',
      audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
    })

    expect(result.recipients).toHaveLength(100)
    expect(result.recipients[0]).toEqual({ id: 'owner-1', telegramId: '700000001' })
    expect(result.recipients.filter((recipient) => recipient.id.startsWith('staff-'))).toHaveLength(99)
    expect(result.gaps).toContainEqual({ reason: 'recipient_limit_reached', affectedCount: 1 })
    expect(reader.shop.findUnique.mock.calls[0]?.[0]).toMatchObject({
      select: {
        ownerAdmin: { select: { id: true, telegramId: true } },
        admins: { take: 101 },
      },
    })
  })

  it('uses one audience policy for producers, lifecycle, and pre-delivery warnings', () => {
    expect(telegramAudienceForNotificationType('DEVICE_CREATED')).toBe(TELEGRAM_AUDIENCES.OWNER_ONLY)
    expect(telegramAudienceForNotificationType('SALE')).toBe(TELEGRAM_AUDIENCES.OWNER_ONLY)
    expect(telegramAudienceForNotificationType('OLIB_SOTDIM_CREATED')).toBe(TELEGRAM_AUDIENCES.OWNER_ONLY)
    expect(telegramAudienceForNotificationType('PAYMENT_RECEIVED')).toBe(TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF)
    expect(telegramAudienceForNotificationType('private message')).toBe(TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF)
    expect(TELEGRAM_NOTIFICATION_TYPES).toHaveLength(20)
    expect(safeTelegramNotificationType('CUSTOMER_LOLA')).toBe('TELEGRAM')
  })
})

describe('privacy-safe recipient gap markers', () => {
  it('normalizes type and stores one strict empty marker per safe gap category', () => {
    const privateText = 'Customer Lola paid 5,000,000; telegram 700000001'
    expect(safeTelegramNotificationType(privateText)).toBe('TELEGRAM')
    const markers = telegramUnavailableMarkerRows({
      shopId: 'shop-1',
      audience: TELEGRAM_AUDIENCES.OWNER_ONLY,
      recipients: [],
      gaps: [
        { reason: 'unlinked_or_unverified', affectedCount: 10 },
        { reason: 'personal_disabled', affectedCount: 2 },
      ],
    }, {
      type: privateText,
      dedupeScope: 'customer-private-related-id-123',
      cancelledAt: new Date('2026-07-18T12:00:00.000Z'),
    })

    expect(markers).toHaveLength(2)
    expect(markers[0]).toMatchObject({
      type: 'TELEGRAM',
      status: 'CANCELLED',
      message: '',
      telegramId: '',
      recipientShopAdminId: null,
      recipientUnavailableReason: 'unlinked_or_unverified',
      lastError: 'Cancelled before delivery: unlinked_or_unverified',
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
    })
    expect(markers[1]?.recipientUnavailableReason).toBe('personal_disabled')
    const serialized = JSON.stringify(markers)
    expect(serialized).not.toContain(privateText)
    expect(serialized).not.toContain('customer-private-related-id-123')
    expect(markers.every((marker) => marker.dedupeKey?.startsWith('TELEGRAM_GAP:'))).toBe(true)
  })

  it('uses a stable collision-safe marker key so checkpoint replay cannot duplicate the gap', () => {
    const resolution = {
      shopId: 'shop-1',
      audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF as 'OWNER_AND_ACTIVE_STAFF',
      recipients: [],
      gaps: [{ reason: 'unlinked_or_unverified' as const, affectedCount: 1 }],
    }
    const first = telegramUnavailableMarkerRows(resolution, {
      type: 'REMINDER',
      dedupeScope: 'REMINDER:2026-07-18:schedule-1',
      cancelledAt: new Date('2026-07-18T08:00:00.000Z'),
    })
    const replay = telegramUnavailableMarkerRows(resolution, {
      type: 'REMINDER',
      dedupeScope: 'REMINDER:2026-07-18:schedule-1',
      cancelledAt: new Date('2026-07-18T09:00:00.000Z'),
    })

    expect(first[0]?.dedupeKey).toBe(replay[0]?.dedupeKey)
    expect(first[0]?.dedupeKey).not.toContain('schedule-1')
  })
})
