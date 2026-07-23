import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }) })
const pool = new Pool({ connectionString: databaseUrl, max: 1 })

function reminderRewriteSql() {
  const migration = readFileSync(resolve(
    process.cwd(),
    'prisma/migrations/202607180001_telegram_disable_lifecycle/migration.sql',
  ), 'utf8')
  const start = migration.indexOf('CREATE TEMP TABLE "_ReminderDedupeRewrite"')
  const end = migration.indexOf('-- Materialize the ineligible actor set once', start)
  if (start < 0 || end < 0) throw new Error('Reminder dedupe rewrite SQL block is missing')
  return migration.slice(start, end)
}

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Notification", "ShopAdmin", "ShopPayment", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function runReminderRewrite() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(reminderRewriteSql())
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

beforeEach(resetBusinessData)

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), pool.end()])
})

describe('Telegram reminder dedupe migration against PostgreSQL', () => {
  it('rewrites old actor keys and leaves at most one deliverable row after collisions', async () => {
    const platformAdmin = await prisma.superAdmin.create({
      data: { name: 'Migration admin', login: 'migration_admin', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Migration shop',
        ownerName: 'Migration owner',
        ownerPhone: '+998901234567',
        shopNumber: 'migration-dedupe',
        address: 'Disposable migration integration',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: platformAdmin.id,
      },
    })
    const recipient = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Reminder recipient',
        phone: '+998907654321',
        login: 'migration_recipient',
        passwordHash: 'integration-only',
      },
    })

    const logicalSentKey = `REMINDER:2026-07-18:${recipient.id}:schedule-sent`
    const logicalPendingKey = `SALE_REMINDER:2026-07-18:${recipient.id}:sale-pending`
    await prisma.notification.createMany({
      data: [
        {
          shopId: shop.id,
          recipientShopAdminId: recipient.id,
          telegramId: '700000001',
          type: 'REMINDER',
          message: 'Historic sent reminder',
          dedupeKey: 'REMINDER:2026-07-18:700000001:schedule-sent',
          status: 'SENT',
          sentAt: new Date('2026-07-18T08:00:00.000Z'),
          scheduledAt: new Date('2026-07-18T08:00:00.000Z'),
        },
        {
          shopId: shop.id,
          recipientShopAdminId: recipient.id,
          telegramId: '700000002',
          type: 'REMINDER',
          message: 'New-format duplicate must not send',
          dedupeKey: logicalSentKey,
          status: 'PENDING',
          scheduledAt: new Date('2026-07-18T08:01:00.000Z'),
        },
        {
          shopId: shop.id,
          recipientShopAdminId: recipient.id,
          telegramId: '700000001',
          type: 'SALE_REMINDER',
          message: 'First historic pending reminder',
          dedupeKey: 'SALE_REMINDER:2026-07-18:700000001:sale-pending',
          status: 'PENDING',
          scheduledAt: new Date('2026-07-18T09:00:00.000Z'),
        },
        {
          shopId: shop.id,
          recipientShopAdminId: recipient.id,
          telegramId: '700000002',
          type: 'SALE_REMINDER',
          message: 'Second historic pending reminder',
          dedupeKey: 'SALE_REMINDER:2026-07-18:700000002:sale-pending',
          status: 'PENDING',
          scheduledAt: new Date('2026-07-18T09:01:00.000Z'),
        },
      ],
    })

    await runReminderRewrite()

    const rows = await prisma.notification.findMany({
      where: { shopId: shop.id },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      select: { type: true, status: true, dedupeKey: true, lastError: true },
    })
    expect(rows.filter((row) => row.dedupeKey === logicalSentKey)).toEqual([
      expect.objectContaining({ type: 'REMINDER', status: 'SENT' }),
    ])
    expect(rows.filter((row) => row.dedupeKey === logicalPendingKey)).toHaveLength(1)
    expect(rows.filter((row) => row.type === 'REMINDER' && row.status === 'PENDING')).toHaveLength(0)
    expect(rows.filter((row) => row.type === 'SALE_REMINDER' && row.status === 'PENDING')).toHaveLength(1)
    expect(rows.filter((row) => row.status === 'CANCELLED')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dedupeKey: null,
        lastError: 'Duplicate reminder cancelled during Telegram recipient dedupe migration',
      }),
      expect.objectContaining({
        dedupeKey: null,
        lastError: 'Duplicate reminder cancelled during Telegram recipient dedupe migration',
      }),
    ]))
  })

  it('fails closed without rewrites when a colliding delivery lease is still fresh', async () => {
    const platformAdmin = await prisma.superAdmin.create({
      data: { name: 'Lease admin', login: 'lease_admin', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Lease shop',
        ownerName: 'Lease owner',
        ownerPhone: '+998901234568',
        shopNumber: 'migration-lease',
        address: 'Disposable migration lease integration',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: platformAdmin.id,
      },
    })
    const recipient = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Lease recipient',
        phone: '+998907654322',
        login: 'lease_recipient',
        passwordHash: 'integration-only',
      },
    })
    const oldKey = 'REMINDER:2026-07-18:700000003:schedule-live'
    const newKey = `REMINDER:2026-07-18:${recipient.id}:schedule-live`
    await prisma.notification.createMany({
      data: [
        {
          shopId: shop.id,
          recipientShopAdminId: recipient.id,
          telegramId: '700000003',
          type: 'REMINDER',
          message: 'Historic sent proof',
          dedupeKey: oldKey,
          status: 'SENT',
          sentAt: new Date(),
          scheduledAt: new Date(),
        },
        {
          shopId: shop.id,
          recipientShopAdminId: recipient.id,
          telegramId: '700000004',
          type: 'REMINDER',
          message: 'Fresh in-flight duplicate',
          dedupeKey: newKey,
          status: 'PROCESSING',
          lastAttemptAt: new Date(),
          scheduledAt: new Date(),
        },
      ],
    })

    await expect(runReminderRewrite()).rejects.toThrow(
      'Fresh reminder delivery collision; retry migration after processing lease expires',
    )
    const rows = await prisma.notification.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'asc' },
      select: { status: true, dedupeKey: true, lastError: true },
    })
    expect(rows).toEqual([
      { status: 'SENT', dedupeKey: oldKey, lastError: null },
      { status: 'PROCESSING', dedupeKey: newKey, lastError: null },
    ])
  })
})
