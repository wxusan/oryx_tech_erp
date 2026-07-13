import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })
let server: Server
let stubBaseUrl = ''
let stubMode: 'SUCCESS' | 400 | 401 | 403 | 429 = 'SUCCESS'
let requests: Array<{ path: string; body: string }> = []

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>()
  return {
    ...actual,
    Bot: class AuditBot extends actual.Bot {
      constructor(token: string) {
        super(token, {
          client: {
            apiRoot: stubBaseUrl,
            buildUrl: (_root, _token, method) => `${stubBaseUrl}/${method}`,
          },
        })
      }
    },
  }
})

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "DeviceReturn",
      "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedShop(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: { name: `Telegram owner ${suffix}`, login: `telegram_owner_${suffix}`, passwordHash: 'audit-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Telegram shop ${suffix}`,
      ownerName: owner.name,
      ownerPhone: '+998907070707',
      shopNumber: suffix,
      address: 'Disposable Telegram audit',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  await prisma.shopAdmin.create({
    data: {
      shopId: shop.id,
      name: `Telegram admin ${suffix}`,
      phone: '+998901234567',
      login: `telegram_admin_${suffix}`,
      telegramId: '123456789',
      telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
      passwordHash: 'audit-only',
    },
  })
  return { owner, shop }
}

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:AUDIT_ONLY_FAKE_TOKEN'
  process.env.TELEGRAM_WEBHOOK_SECRET = 'audit-webhook-secret'
  // Text-only notifications still construct the storage client even though
  // they have no media positions to sign. Give that client inert audit-only
  // credentials so this test reaches the real Telegram HTTP boundary.
  process.env.SUPABASE_URL = 'http://127.0.0.1:9'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'audit-only-service-role-key'
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push({ path: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') })
      response.setHeader('content-type', 'application/json')
      if (stubMode !== 'SUCCESS') {
        response.statusCode = stubMode
        response.end(JSON.stringify({
          ok: false,
          error_code: stubMode,
          description: stubMode === 429 ? 'Too Many Requests: audit stub' : `Permanent Telegram ${stubMode}: audit stub`,
          ...(stubMode === 429 ? { parameters: { retry_after: 7 } } : {}),
        }))
        return
      }
      response.statusCode = 200
      if (request.url === '/getMe') {
        response.end(JSON.stringify({
          ok: true,
          result: { id: 999000, is_bot: true, first_name: 'Oryx audit bot', username: 'oryx_audit_bot' },
        }))
        return
      }
      response.end(JSON.stringify({
        ok: true,
        result: {
          message_id: requests.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 123456789, type: 'private' },
          text: 'accepted by audit stub',
        },
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Telegram audit stub did not bind a TCP port')
  stubBaseUrl = `http://127.0.0.1:${address.port}`

})

beforeEach(async () => {
  stubMode = 'SUCCESS'
  requests = []
  await resetBusinessData()
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await prisma.$disconnect()
})

describe('real PostgreSQL notification queue with a stub Telegram HTTP server', () => {
  it('delivers a queued text message through Grammy and marks it SENT', async () => {
    const { shop } = await seedShop('success')
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        type: 'AUDIT_TEXT',
        message: '<b>Audit message</b>',
        telegramId: '123456789',
        scheduledAt: new Date(Date.now() - 1_000),
      },
    })

    const { processPendingNotifications } = await import('@/lib/notification-service')
    const result = await processPendingNotifications()
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })

    expect(result).toMatchObject({ attempted: 1, sent: 1, failed: 0 })
    expect(stored.status).toBe('SENT')
    expect(stored.textSentAt).not.toBeNull()
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe('/sendMessage')
    expect(requests[0].body).toContain('123456789')
  })

  it('honors retry_after and sends a failed text only once inside one queue attempt', async () => {
    const { shop } = await seedShop('rate_limit')
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        type: 'AUDIT_429',
        message: 'Rate limit audit',
        telegramId: '123456789',
        scheduledAt: new Date(Date.now() - 1_000),
      },
    })
    stubMode = 429
    const startedAt = Date.now()

    const { processPendingNotifications } = await import('@/lib/notification-service')
    const result = await processPendingNotifications()
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })

    expect(result).toMatchObject({ attempted: 1, sent: 0, failed: 1 })
    expect(stored.status).toBe('FAILED')
    expect(stored.attemptCount).toBe(1)
    expect(stored.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(startedAt + 6_500)
    expect(stored.nextAttemptAt?.getTime()).toBeLessThan(startedAt + 8_500)
    expect(requests).toHaveLength(1)
    expect(requests.every((request) => request.path === '/sendMessage')).toBe(true)
  })

  it.each([400, 401, 403] as const)('cancels permanent Telegram %i failures after one HTTP request', async (errorCode) => {
    const { shop } = await seedShop(`permanent_${errorCode}`)
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        type: `AUDIT_${errorCode}`,
        message: `Permanent failure ${errorCode}`,
        telegramId: '123456789',
        scheduledAt: new Date(Date.now() - 1_000),
      },
    })
    stubMode = errorCode

    const { processPendingNotifications } = await import('@/lib/notification-service')
    const result = await processPendingNotifications()
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })

    expect(result).toMatchObject({ ok: false, attempted: 1, sent: 0, failed: 0, cancelled: 1 })
    expect(stored.status).toBe('CANCELLED')
    expect(stored.nextAttemptAt).toBeNull()
    expect(requests).toHaveLength(1)
  })

  it('cancels a previously queued message after its recipient admin is disabled', async () => {
    const { shop } = await seedShop('revoked_recipient')
    const telegramId = '987654321'
    await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Revoked recipient',
        phone: '+998906060606',
        login: 'revoked_telegram_recipient',
        telegramId,
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        isActive: false,
        passwordHash: 'audit-only',
      },
    })
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        type: 'AUDIT_REVOKED',
        message: 'Queued before recipient revocation',
        telegramId,
        scheduledAt: new Date(Date.now() - 1_000),
      },
    })

    const { processPendingNotifications } = await import('@/lib/notification-service')
    const result = await processPendingNotifications()
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })

    expect(result).toMatchObject({ ok: false, sent: 0, cancelled: 1 })
    expect(stored.status).toBe('CANCELLED')
    expect(stored.lastError).toContain('recipient_revoked_or_unverified')
    expect(requests).toHaveLength(0)
  })

  it('cancels a queued sale reminder when the related debt is already paid', async () => {
    const { shop } = await seedShop('resolved_sale')
    const device = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Resolved reminder device',
        purchasePrice: 1_000_000,
        purchaseInputAmount: 1_000_000,
        purchaseAmountUzsSnapshot: 1_000_000,
        imei: '351111111111119',
        imageUrls: [],
        status: 'SOLD_CASH',
        addedBy: 'audit-only',
      },
    })
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Resolved debt customer', phone: '+998901111111' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_200_000,
        paymentMethod: 'CASH',
        paidFully: true,
        amountPaid: 1_200_000,
        remainingAmount: 0,
        contractSalePrice: 1_200_000,
        contractAmountPaid: 1_200_000,
        contractRemainingAmount: 0,
        reminderEnabled: true,
        createdBy: 'audit-only',
      },
    })
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        type: 'SALE_REMINDER',
        message: 'This resolved debt must not be sent',
        telegramId: '123456789',
        scheduledAt: new Date(Date.now() - 1_000),
        relatedId: sale.id,
        relatedType: 'Sale',
      },
    })

    const { processPendingNotifications } = await import('@/lib/notification-service')
    const result = await processPendingNotifications()
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })

    expect(result).toMatchObject({ ok: false, sent: 0, cancelled: 1 })
    expect(stored.status).toBe('CANCELLED')
    expect(stored.lastError).toContain('debt_resolved_or_changed')
    expect(requests).toHaveLength(0)
  })
})

async function postStartUpdate(telegramId: number, updateId: number) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/telegram/webhook/route')
  return POST(new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'audit-webhook-secret',
    },
    body: JSON.stringify({
      update_id: updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: telegramId, type: 'private' },
        from: { id: telegramId, is_bot: false, first_name: 'Audit user' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    }),
  }))
}

describe('Telegram /start ownership verification through the HTTP boundary', () => {
  it('verifies and welcomes a manually entered super-admin Telegram ID', async () => {
    const telegramId = 700000001
    const owner = await prisma.superAdmin.create({
      data: {
        name: 'Start super admin',
        login: 'start_super_admin',
        passwordHash: 'audit-only',
        telegramId: String(telegramId),
      },
    })

    const response = await postStartUpdate(telegramId, 900001)

    expect(response.status).toBe(200)
    expect((await prisma.superAdmin.findUniqueOrThrow({ where: { id: owner.id } })).telegramVerifiedAt).not.toBeNull()
    const sent = requests.filter(({ path }) => path === '/sendMessage')
    expect(sent).toHaveLength(1)
    expect(decodeURIComponent(sent[0].body)).toContain('Start super admin')
  })

  it('verifies and welcomes a manually entered shop-admin Telegram ID with the shop name', async () => {
    const telegramId = 700000002
    const { shop } = await seedShop('start_shop_admin')
    const admin = await prisma.shopAdmin.findFirstOrThrow({ where: { shopId: shop.id } })
    await prisma.shopAdmin.update({
      where: { id: admin.id },
      data: { telegramId: String(telegramId), telegramVerifiedAt: null },
    })

    const response = await postStartUpdate(telegramId, 900002)

    expect(response.status).toBe(200)
    expect((await prisma.shopAdmin.findUniqueOrThrow({ where: { id: admin.id } })).telegramVerifiedAt).not.toBeNull()
    const sent = requests.filter(({ path }) => path === '/sendMessage')
    expect(sent).toHaveLength(1)
    expect(decodeURIComponent(sent[0].body)).toContain(shop.name)
  })

  it('replies to an unknown Telegram ID without creating or verifying an owner', async () => {
    const telegramId = 700000003
    const response = await postStartUpdate(telegramId, 900003)

    expect(response.status).toBe(200)
    expect(await prisma.superAdmin.count({ where: { telegramId: String(telegramId) } })).toBe(0)
    expect(await prisma.shopAdmin.count({ where: { telegramId: String(telegramId) } })).toBe(0)
    expect(requests.filter(({ path }) => path === '/sendMessage')).toHaveLength(1)
  })
})
