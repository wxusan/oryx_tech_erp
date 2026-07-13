import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { cleanupRetainedOperationalData } from '@/lib/server/data-retention'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 3 }) })

async function cleanupFixtures() {
  const shops = await prisma.shop.findMany({ where: { shopNumber: 'retention-shop' }, select: { id: true } })
  const shopIds = shops.map(({ id }) => id)
  await prisma.notification.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.authSession.deleteMany({ where: { id: { startsWith: 'retention-' } } })
  await prisma.log.deleteMany({ where: { action: { startsWith: 'RETENTION_' } } })
  await prisma.opsEvent.deleteMany({ where: { event: { startsWith: 'retention.' } } })
  await prisma.shopAdmin.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.shop.deleteMany({ where: { id: { in: shopIds } } })
  await prisma.superAdmin.deleteMany({ where: { login: 'retention-owner' } })
}

beforeEach(cleanupFixtures)

afterAll(async () => {
  await cleanupFixtures()
  await prisma.$disconnect()
})

describe('operational retention against PostgreSQL', () => {
  it('deletes only expired eligible rows and preserves live/retryable records', async () => {
    const now = new Date('2026-07-13T00:00:00.000Z')
    const old = new Date('2018-01-01T00:00:00.000Z')
    const recent = new Date('2026-07-12T00:00:00.000Z')
    const owner = await prisma.superAdmin.create({
      data: { name: 'Retention owner', login: 'retention-owner', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Retention shop',
        ownerName: 'Retention owner',
        ownerPhone: '+998901111111',
        shopNumber: 'retention-shop',
        address: 'Disposable integration database',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: owner.id,
      },
    })
    const recipient = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Retention recipient',
        phone: '+998901111112',
        login: 'retention-recipient',
        telegramId: '10001',
        passwordHash: 'integration-only',
      },
    })

    await Promise.all([
      prisma.notification.create({
        data: {
          shopId: shop.id,
          type: 'RETENTION_SENT',
          message: 'terminal old row',
          telegramId: '10001',
          recipientShopAdminId: recipient.id,
          status: 'SENT',
          scheduledAt: old,
          createdAt: old,
        },
      }),
      prisma.notification.create({
        data: {
          shopId: shop.id,
          type: 'RETENTION_PENDING',
          message: 'retryable old row',
          telegramId: '10002',
          recipientShopAdminId: recipient.id,
          status: 'PENDING',
          scheduledAt: old,
          createdAt: old,
        },
      }),
      prisma.notification.create({
        data: {
          shopId: shop.id,
          type: 'RETENTION_RECENT',
          message: 'recent terminal row',
          telegramId: '10003',
          recipientShopAdminId: recipient.id,
          status: 'CANCELLED',
          scheduledAt: recent,
          createdAt: recent,
        },
      }),
      prisma.opsEvent.create({ data: { event: 'retention.old', message: 'old', createdAt: old } }),
      prisma.opsEvent.create({ data: { event: 'retention.recent', message: 'recent', createdAt: recent } }),
      prisma.authSession.create({
        data: {
          id: 'retention-expired-session',
          actorId: owner.id,
          actorType: 'SUPER_ADMIN',
          sessionVersion: owner.sessionVersion,
          expiresAt: old,
          createdAt: old,
        },
      }),
      prisma.authSession.create({
        data: {
          id: 'retention-live-session',
          actorId: owner.id,
          actorType: 'SUPER_ADMIN',
          sessionVersion: owner.sessionVersion,
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdAt: recent,
        },
      }),
      prisma.log.create({
        data: {
          actorId: owner.id,
          actorType: 'SUPER_ADMIN',
          action: 'RETENTION_OLD',
          targetType: 'Audit',
          targetId: 'old',
          createdAt: old,
        },
      }),
      prisma.log.create({
        data: {
          actorId: owner.id,
          actorType: 'SUPER_ADMIN',
          action: 'RETENTION_RECENT',
          targetType: 'Audit',
          targetId: 'recent',
          createdAt: recent,
        },
      }),
    ])

    const summary = await cleanupRetainedOperationalData(now)

    expect(summary).toMatchObject({ notifications: 1, opsEvents: 1, authSessions: 1, businessAuditLogs: 1 })
    expect(await prisma.notification.findMany({ where: { shopId: shop.id }, orderBy: { type: 'asc' }, select: { type: true } }))
      .toEqual([{ type: 'RETENTION_PENDING' }, { type: 'RETENTION_RECENT' }])
    expect(await prisma.opsEvent.findMany({ where: { event: { startsWith: 'retention.' } }, select: { event: true } }))
      .toEqual([{ event: 'retention.recent' }])
    expect(await prisma.authSession.findMany({ where: { id: { startsWith: 'retention-' } }, select: { id: true } }))
      .toEqual([{ id: 'retention-live-session' }])
    expect(await prisma.log.findMany({ where: { action: { startsWith: 'RETENTION_' } }, select: { action: true } }))
      .toEqual([{ action: 'RETENTION_RECENT' }])
  })
})
