import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

vi.mock('@/lib/notification-service', () => ({
  processPendingNotifications: vi.fn(async () => ({
    ok: true,
    attempted: 0,
    sent: 0,
    sentWithImage: 0,
    failed: 0,
    cancelled: 0,
    remainingDue: 0,
    retryScheduled: 0,
    processing: 0,
    crashed: false,
  })),
}))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/server/cache-tags', () => ({ invalidateShopOverdueCron: vi.fn() }))

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification",
      "ReturnRefundAllocation", "DeviceReturn", "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "DeviceImei", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  process.env.CRON_SECRET = 'integration-cron-secret'
  await resetBusinessData()
})

afterAll(async () => {
  vi.restoreAllMocks()
  await prisma.$disconnect()
})

async function callCron() {
  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/cron/reminders/route')
  return GET(new NextRequest('http://localhost/api/cron/reminders', {
    headers: { authorization: 'Bearer integration-cron-secret' },
  }))
}

describe('daily reminder generation against PostgreSQL', () => {
  it('emits one overdue reminder per trigger day, catches the next day, and excludes returned debt', async () => {
    const owner = await prisma.superAdmin.create({
      data: { name: 'Cron owner', login: 'cron-owner', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Cron shop',
        ownerName: 'Cron owner',
        ownerPhone: '+998901414141',
        shopNumber: 'CRON-1',
        address: 'Disposable cron integration',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: owner.id,
      },
    })
    await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Cron admin',
        phone: '+998901414142',
        login: 'cron-admin',
        passwordHash: 'integration-only',
        telegramId: '820000001',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    })
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Cron customer', phone: '+998901414143', normalizedPhone: '998901414143' },
    })

    async function overdueContract(suffix: string, returnedAt: Date | null) {
      const device = await prisma.device.create({
        data: {
          shopId: shop.id,
          model: `Cron phone ${suffix}`,
          imei: `CRON-${suffix}`,
          purchasePrice: 500,
          purchaseInputAmount: 500,
          purchaseAmountUzsSnapshot: 500,
          status: 'SOLD_NASIYA',
          addedBy: owner.id,
        },
      })
      const nasiya = await prisma.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          totalAmount: 1_000,
          downPayment: 0,
          baseRemainingAmount: 1_000,
          finalNasiyaAmount: 1_000,
          remainingAmount: 1_000,
          months: 1,
          monthlyPayment: 1_000,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          status: 'OVERDUE',
          reminderEnabled: true,
          contractTotalAmount: 1_000,
          contractBaseRemainingAmount: 1_000,
          contractFinalAmount: 1_000,
          contractMonthlyPayment: 1_000,
          contractRemainingAmount: 1_000,
          returnedAt,
          returnedBy: returnedAt ? owner.id : null,
          createdBy: owner.id,
        },
      })
      return prisma.nasiyaSchedule.create({
        data: {
          nasiyaId: nasiya.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-10T00:00:00.000Z'),
          expectedAmount: 1_000,
          contractExpectedAmount: 1_000,
          contractRemainingAmount: 1_000,
          status: 'OVERDUE',
        },
      })
    }

    const active = await overdueContract('active', null)
    const returned = await overdueContract('returned', new Date('2026-07-11T00:00:00.000Z'))

    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-13T08:00:00.000Z').getTime())
    expect((await callCron()).status).toBe(200)
    expect((await callCron()).status).toBe(200)

    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-14T08:00:00.000Z').getTime())
    expect((await callCron()).status).toBe(200)

    const activeRows = await prisma.notification.findMany({
      where: { relatedId: active.id, type: 'OVERDUE' },
      orderBy: { dedupeKey: 'asc' },
      select: { dedupeKey: true },
    })
    expect(activeRows).toHaveLength(2)
    expect(new Set(activeRows.map(({ dedupeKey }) => dedupeKey?.split(':')[1])).size).toBe(2)
    expect(await prisma.notification.count({ where: { relatedId: returned.id } })).toBe(0)
  })
})
