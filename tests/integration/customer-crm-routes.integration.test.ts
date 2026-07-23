import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { passportIdentifierStorage } from '@/lib/customer-passport'

process.env.CUSTOMER_PII_ENCRYPTION_KEY = 'route-encryption-key-customer-crm-2026-very-long'
process.env.CUSTOMER_PII_SEARCH_KEY = 'route-search-key-customer-crm-2026-very-long'

const authState = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => authState.session) }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/server/cache-tags', () => ({
  invalidateShopCustomerMutation: vi.fn(),
  invalidateShopSaleMutation: vi.fn(),
}))

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 3 }) })

async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification",
      "ReturnRefundAllocation", "DeviceReturn", "NasiyaResolutionEvent", "NasiyaDeferral",
      "NasiyaPayment", "NasiyaSchedule", "Nasiya", "SupplierPayable", "SalePayment", "Sale",
      "Customer", "DeviceImei", "Device", "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate",
      "ShopPackageFeature", "ShopPackageVersion", "ShopMemberPermission", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seed() {
  const superAdmin = await prisma.superAdmin.create({ data: { name: 'CRM root', login: 'crm-route-root', passwordHash: 'test-only' } })
  const shop = await prisma.shop.create({
    data: {
      name: 'CRM route shop', ownerName: 'CRM owner', ownerPhone: '+998901111111', shopNumber: 'crm-route',
      address: 'Disposable route DB', subscriptionDue: new Date('2099-01-01T00:00:00.000Z'), createdById: superAdmin.id,
    },
  })
  const owner = await prisma.shopAdmin.create({
    data: { shopId: shop.id, name: 'CRM shop owner', phone: '+998902222222', login: 'crm-shop-owner', passwordHash: 'test-only' },
  })
  await prisma.shop.update({ where: { id: shop.id }, data: { ownerAdminId: owner.id, ownershipStatus: 'RESOLVED' } })
  const packageVersion = await prisma.shopPackageVersion.create({
    data: {
      shopId: shop.id, effectiveOn: new Date('2026-01-01T00:00:00.000Z'), basePrice: 0, currency: 'UZS',
      discountAmount: 0, note: 'CRM route package', createdById: superAdmin.id,
      features: { create: [
        'INVENTORY', 'CASH_SALES', 'NASIYA', 'OLIB_SOTDIM', 'CUSTOMER_CRM', 'TELEGRAM',
        'REMINDERS', 'REPORTS', 'IMPORTS', 'EXPORTS', 'STAFF_ACCESS',
      ].map((featureCode) => ({ featureCode, enabled: true, recurringPrice: 0 })) },
    },
  })
  const session = await prisma.authSession.create({
    data: {
      id: 'crm-owner-session', actorId: owner.id, actorType: 'SHOP_ADMIN', shopId: shop.id,
      packageVersionId: packageVersion.id, sessionVersion: owner.sessionVersion, policy: 'IDLE_10_MINUTES',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
  })
  authState.session = {
    user: {
      id: owner.id, name: owner.name, role: 'SHOP_ADMIN', shopId: shop.id, sessionVersion: owner.sessionVersion,
      sessionId: session.id, sessionPolicy: session.policy, packageVersionId: packageVersion.id,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
  return { superAdmin, shop, owner, packageVersion }
}

describe('customer CRM protected routes', () => {
  beforeEach(reset)
  afterAll(async () => prisma.$disconnect())

  it('reveals only to the owner, records an audit row, and rejects cross-tenant IDs', async () => {
    const actor = await seed()
    const customer = await prisma.customer.create({
      data: {
        shopId: actor.shop.id, name: 'Reveal customer', phone: '+998903333333', normalizedPhone: '998903333333',
        ...passportIdentifierStorage('AC 1234567'),
      },
    })
    const { NextRequest } = await import('next/server')
    const { POST } = await import('@/app/api/customers/[id]/passport/reveal/route')
    const response = await POST(new NextRequest(`http://localhost/api/customers/${customer.id}/passport/reveal`, { method: 'POST' }), {
      params: Promise.resolve({ id: customer.id }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ success: true, data: { identifier: 'AC1234567' } })

    const audit = await prisma.log.findFirst({ where: { shopId: actor.shop.id, action: 'CUSTOMER_PASSPORT_REVEAL', targetId: customer.id } })
    expect(audit).not.toBeNull()
    expect(JSON.stringify(audit)).not.toContain('AC1234567')
    expect(JSON.stringify(audit)).not.toContain(customer.passportIdentifierCiphertext!)

    const otherRoot = await prisma.superAdmin.create({ data: { name: 'Other root', login: 'crm-other-root', passwordHash: 'test-only' } })
    const otherShop = await prisma.shop.create({
      data: {
        name: 'Other shop', ownerName: 'Other', ownerPhone: '+998904444444', shopNumber: 'crm-other', address: 'Other',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'), createdById: otherRoot.id,
      },
    })
    const otherCustomer = await prisma.customer.create({
      data: { shopId: otherShop.id, name: 'Other customer', phone: '+998905555555', normalizedPhone: '998905555555', ...passportIdentifierStorage('AD 7654321') },
    })
    const denied = await POST(new NextRequest(`http://localhost/api/customers/${otherCustomer.id}/passport/reveal`, { method: 'POST' }), {
      params: Promise.resolve({ id: otherCustomer.id }),
    })
    expect(denied.status).toBe(404)
  })

  it('searches an exact passport through the POST body and returns only the authenticated tenant', async () => {
    const actor = await seed()
    const passport = 'AE 2468135'
    const own = await prisma.customer.create({
      data: {
        shopId: actor.shop.id,
        name: 'Own passport customer',
        phone: '+998908181818',
        normalizedPhone: '998908181818',
        ...passportIdentifierStorage(passport),
      },
    })
    const otherRoot = await prisma.superAdmin.create({
      data: { name: 'Search other root', login: 'crm-search-other-root', passwordHash: 'test-only' },
    })
    const otherShop = await prisma.shop.create({
      data: {
        name: 'Search other shop', ownerName: 'Other', ownerPhone: '+998908282828', shopNumber: 'crm-search-other',
        address: 'Other', subscriptionDue: new Date('2099-01-01T00:00:00.000Z'), createdById: otherRoot.id,
      },
    })
    await prisma.customer.create({
      data: {
        shopId: otherShop.id,
        name: 'Foreign passport customer',
        phone: '+998908383838',
        normalizedPhone: '998908383838',
        ...passportIdentifierStorage(passport),
      },
    })

    const { NextRequest } = await import('next/server')
    const { POST } = await import('@/app/api/customers/search/route')
    const response = await POST(new NextRequest('http://localhost/api/customers/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ search: passport, skip: 0, take: 25 }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(payload).toMatchObject({
      success: true,
      data: {
        items: [{
          id: own.id,
          name: own.name,
          passportMasked: '••••8135',
          matchEvidence: [{ field: 'PASSPORT' }],
        }],
        total: 1,
      },
    })
    expect(JSON.stringify(payload)).not.toContain('AE2468135')
    expect(JSON.stringify(payload)).not.toContain(own.passportIdentifierCiphertext!)
    expect(JSON.stringify(payload)).not.toContain(own.passportIdentifierHash!)

    const partialResponse = await POST(new NextRequest('http://localhost/api/customers/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ search: 'AE2468', skip: 0, take: 25 }),
    }))
    const partialPayload = await partialResponse.json()
    expect(partialResponse.status).toBe(200)
    expect(partialPayload).toMatchObject({ success: true, data: { items: [], total: 0 } })
    expect(JSON.stringify(partialPayload)).not.toContain('AE2468')
  })

  it('uses explicit existing/new customer commands and never overwrites a phone match', async () => {
    const actor = await seed()
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Original Name', phone: '+998906666666', normalizedPhone: '998906666666' },
    })
    const firstDevice = await prisma.device.create({
      data: {
        shopId: actor.shop.id, model: 'Existing selection phone', purchasePrice: 500, purchaseInputAmount: 500,
        purchaseAmountUzsSnapshot: 500, imei: 'CRM-ROUTE-1', status: 'IN_STOCK', addedBy: actor.owner.id,
      },
    })
    const { NextRequest } = await import('next/server')
    const { POST } = await import('@/app/api/devices/[id]/sell/route')
    const selected = await POST(new NextRequest(`http://localhost/api/devices/${firstDevice.id}/sell`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'crm-existing-sale',
      },
      body: JSON.stringify({
        deviceId: firstDevice.id, customerMode: 'EXISTING', customerId: customer.id,
        customerName: 'Attempted overwrite', customerPhone: '+998907777777',
        salePrice: 1000, inputCurrency: 'UZS', paymentMethod: 'CASH', paidFully: true,
      }),
    }), { params: Promise.resolve({ id: firstDevice.id }) })
    expect(selected.status).toBe(201)
    expect(await prisma.customer.findUnique({ where: { id: customer.id }, select: { name: true, phone: true } })).toEqual({
      name: 'Original Name', phone: '+998906666666',
    })
    expect(await prisma.customer.count({ where: { shopId: actor.shop.id } })).toBe(1)

    const collisionDevice = await prisma.device.create({
      data: {
        shopId: actor.shop.id, model: 'Collision phone', purchasePrice: 500, purchaseInputAmount: 500,
        purchaseAmountUzsSnapshot: 500, imei: 'CRM-ROUTE-2', status: 'IN_STOCK', addedBy: actor.owner.id,
      },
    })
    const collision = await POST(new NextRequest(`http://localhost/api/devices/${collisionDevice.id}/sell`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'crm-collision-sale',
      },
      body: JSON.stringify({
        deviceId: collisionDevice.id, customerMode: 'NEW', customerName: 'Duplicate Name', customerPhone: customer.phone,
        salePrice: 1000, inputCurrency: 'UZS', paymentMethod: 'CASH', paidFully: true,
      }),
    }), { params: Promise.resolve({ id: collisionDevice.id }) })
    expect(collision.status).toBe(409)
    expect(await prisma.device.findUnique({ where: { id: collisionDevice.id }, select: { status: true } })).toEqual({ status: 'IN_STOCK' })
    expect(await prisma.customer.count({ where: { shopId: actor.shop.id } })).toBe(1)
  })

  it('splits profile surfaces, validates analytics ranges, and omits owner series for staff', async () => {
    const actor = await seed()
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Dashboard customer', phone: '+998909999991', normalizedPhone: '998909999991' },
    })
    const { NextRequest } = await import('next/server')
    const profileRoute = await import('@/app/api/customers/[id]/profile/route')
    const analyticsRoute = await import('@/app/api/customers/[id]/analytics/route')
    const context = { params: Promise.resolve({ id: customer.id }) }

    const overviewResponse = await profileRoute.GET(
      new NextRequest(`http://localhost/api/customers/${customer.id}/profile?view=overview`),
      context,
    )
    const overviewPayload = await overviewResponse.json()
    expect(overviewResponse.status).toBe(200)
    expect(overviewPayload.data.overview.customer.id).toBe(customer.id)
    expect(overviewPayload.data).not.toHaveProperty('history')

    const historyResponse = await profileRoute.GET(
      new NextRequest(`http://localhost/api/customers/${customer.id}/profile?view=history&section=devices&page=1`),
      context,
    )
    const historyPayload = await historyResponse.json()
    expect(historyResponse.status).toBe(200)
    expect(historyPayload.data).not.toHaveProperty('overview')
    expect(historyPayload.data.history).toMatchObject({ items: [], hasNext: false, totalIsExact: false })

    const invalidRange = await analyticsRoute.GET(
      new NextRequest(`http://localhost/api/customers/${customer.id}/analytics?months=18`),
      context,
    )
    expect(invalidRange.status).toBe(400)

    const ownerAnalytics = await analyticsRoute.GET(
      new NextRequest(`http://localhost/api/customers/${customer.id}/analytics?months=24`),
      context,
    )
    const ownerPayload = await ownerAnalytics.json()
    expect(ownerAnalytics.status).toBe(200)
    expect(ownerPayload.data).toMatchObject({ months: 24, visibility: 'OWNER_FINANCIAL' })
    expect(ownerPayload.data.activity).toHaveLength(24)
    expect(ownerPayload.data.activity[0]).toHaveProperty('payments')

    const staff = await prisma.shopAdmin.create({
      data: {
        shopId: actor.shop.id, name: 'CRM staff', phone: '+998909999992', login: 'crm-route-staff',
        passwordHash: 'test-only', legacyFullAccess: false,
      },
    })
    await prisma.shopMemberPermission.create({
      data: {
        shopId: actor.shop.id,
        shopAdminId: staff.id,
        permissionCode: 'CUSTOMER_VIEW',
        grantedById: actor.owner.id,
      },
    })
    const staffSession = await prisma.authSession.create({
      data: {
        id: 'crm-staff-session', actorId: staff.id, actorType: 'SHOP_ADMIN', shopId: actor.shop.id,
        packageVersionId: actor.packageVersion.id, sessionVersion: staff.sessionVersion,
        policy: 'IDLE_10_MINUTES', expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    })
    authState.session = {
      user: {
        id: staff.id, name: staff.name, role: 'SHOP_ADMIN', shopId: actor.shop.id,
        sessionVersion: staff.sessionVersion, sessionId: staffSession.id,
        sessionPolicy: staffSession.policy, packageVersionId: actor.packageVersion.id,
      },
      expires: '2099-01-01T00:00:00.000Z',
    }

    const staffAnalytics = await analyticsRoute.GET(
      new NextRequest(`http://localhost/api/customers/${customer.id}/analytics?months=12`),
      context,
    )
    const staffPayload = await staffAnalytics.json()
    expect(staffAnalytics.status).toBe(200)
    expect(staffPayload.data.visibility).toBe('OPERATIONAL')
    for (const restricted of ['payments', 'refunds', 'writeOffs', 'legacyUsdPaymentCount']) {
      expect(JSON.stringify(staffPayload)).not.toContain(restricted)
    }

    const resolutionHistory = await profileRoute.GET(
      new NextRequest(`http://localhost/api/customers/${customer.id}/profile?view=history&section=resolutions`),
      context,
    )
    expect(resolutionHistory.status).toBe(403)

    const otherRoot = await prisma.superAdmin.create({ data: { name: 'Analytics other', login: 'analytics-other', passwordHash: 'test-only' } })
    const otherShop = await prisma.shop.create({
      data: {
        name: 'Analytics other shop', ownerName: 'Other', ownerPhone: '+998909999993', shopNumber: 'analytics-other',
        address: 'Other', subscriptionDue: new Date('2099-01-01T00:00:00.000Z'), createdById: otherRoot.id,
      },
    })
    const foreignCustomer = await prisma.customer.create({
      data: { shopId: otherShop.id, name: 'Foreign dashboard', phone: '+998909999994', normalizedPhone: '998909999994' },
    })
    const foreignResponse = await analyticsRoute.GET(
      new NextRequest(`http://localhost/api/customers/${foreignCustomer.id}/analytics?months=12`),
      { params: Promise.resolve({ id: foreignCustomer.id }) },
    )
    expect(foreignResponse.status).toBe(404)
  })
})
