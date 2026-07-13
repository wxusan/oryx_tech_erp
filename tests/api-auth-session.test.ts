import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  authSessionFind: vi.fn(),
  authSessionUpdate: vi.fn(),
  shopAdminFind: vi.fn(),
  shopPackageFind: vi.fn(),
  superAdminFind: vi.fn(),
  shopFind: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    authSession: { findUnique: mocks.authSessionFind, updateMany: mocks.authSessionUpdate },
    shopAdmin: { findFirst: mocks.shopAdminFind },
    shopPackageVersion: { findFirst: mocks.shopPackageFind },
    superAdmin: { findFirst: mocks.superAdminFind },
    shop: { findFirst: mocks.shopFind },
  },
}))

const future = new Date(Date.now() + 24 * 60 * 60 * 1000)

function session(role: 'SUPER_ADMIN' | 'SHOP_ADMIN') {
  return {
    user: {
      id: role === 'SUPER_ADMIN' ? 'super-1' : 'shop-admin-1',
      name: 'Actor',
      role,
      shopId: role === 'SHOP_ADMIN' ? 'shop-1' : null,
      sessionVersion: 3,
      sessionId: `${role}-session`,
    },
    expires: future.toISOString(),
  }
}

function durable(role: 'SUPER_ADMIN' | 'SHOP_ADMIN', lastSeenAt = new Date()) {
  return {
    actorId: role === 'SUPER_ADMIN' ? 'super-1' : 'shop-admin-1',
    actorType: role,
    shopId: role === 'SHOP_ADMIN' ? 'shop-1' : null,
    sessionVersion: 3,
    lastSeenAt,
    expiresAt: future,
    revokedAt: null,
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.authSessionUpdate.mockResolvedValue({ count: 1 })
  mocks.shopPackageFind.mockResolvedValue({
    id: 'package-1',
    shopId: 'shop-1',
    effectiveOn: new Date(),
    basePrice: { toString: () => '0' },
    currency: 'UZS',
    discountAmount: { toString: () => '0' },
    pricingNeedsReview: false,
    note: 'test package',
    createdAt: new Date(),
    features: [{
      featureCode: 'STAFF_ACCESS',
      enabled: true,
      recurringPrice: { toString: () => '0' },
      feature: { nameUz: 'Xodimlar', descriptionUz: null, billable: false, platformCore: false, sortOrder: 1 },
    }],
  })
})

describe('durable session authorization', () => {
  it('rejects and revokes a super-admin session after ten minutes without server activity', async () => {
    mocks.auth.mockResolvedValue(session('SUPER_ADMIN'))
    mocks.authSessionFind.mockResolvedValue(durable('SUPER_ADMIN', new Date(Date.now() - 10 * 60 * 1000 - 1)))
    const { requireApiSession } = await import('@/lib/api-auth')

    const result = await requireApiSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      await expect(result.response.json()).resolves.toMatchObject({ error: expect.stringContaining('10 daqiqa') })
    }
    expect(mocks.authSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: expect.any(Date) } }))
    expect(mocks.superAdminFind).not.toHaveBeenCalled()
  })

  it('does not apply inactivity logout to a valid shop session', async () => {
    mocks.auth.mockResolvedValue(session('SHOP_ADMIN'))
    mocks.authSessionFind.mockResolvedValue(durable('SHOP_ADMIN', new Date(Date.now() - 20 * 60 * 1000)))
    mocks.shopAdminFind.mockResolvedValue({
      shopId: 'shop-1',
      sessionVersion: 3,
      permissionVersion: 1,
      legacyFullAccess: true,
      permissions: [],
      shop: { ownerAdminId: null, authorizationVersion: 1 },
    })
    const { requireApiSession } = await import('@/lib/api-auth')

    const result = await requireApiSession()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.user.shopId).toBe('shop-1')
    expect(mocks.authSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastSeenAt: expect.any(Date), expiresAt: expect.any(Date) },
    }))
  })

  it('revokes a staff session when STAFF_ACCESS is disabled', async () => {
    mocks.auth.mockResolvedValue(session('SHOP_ADMIN'))
    mocks.authSessionFind.mockResolvedValue(durable('SHOP_ADMIN'))
    mocks.shopAdminFind.mockResolvedValue({
      shopId: 'shop-1',
      sessionVersion: 3,
      permissionVersion: 1,
      legacyFullAccess: false,
      permissions: [],
      shop: { ownerAdminId: 'owner-1', authorizationVersion: 2 },
    })
    mocks.shopPackageFind.mockResolvedValue({
      id: 'package-2',
      shopId: 'shop-1',
      effectiveOn: new Date(),
      basePrice: { toString: () => '0' },
      currency: 'UZS',
      discountAmount: { toString: () => '0' },
      pricingNeedsReview: false,
      note: 'owner only',
      createdAt: new Date(),
      features: [{
        featureCode: 'STAFF_ACCESS',
        enabled: false,
        recurringPrice: { toString: () => '0' },
        feature: { nameUz: 'Xodimlar', descriptionUz: null, billable: false, platformCore: false, sortOrder: 1 },
      }],
    })
    const { requireApiSession } = await import('@/lib/api-auth')

    const result = await requireApiSession()

    expect(result.ok).toBe(false)
    if (!result.ok) await expect(result.response.json()).resolves.toMatchObject({ error: expect.stringContaining("o'chirilgan") })
    expect(mocks.authSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: expect.any(Date) } }))
  })

  it('keeps the owner session valid when STAFF_ACCESS is disabled', async () => {
    mocks.auth.mockResolvedValue(session('SHOP_ADMIN'))
    mocks.authSessionFind.mockResolvedValue(durable('SHOP_ADMIN'))
    mocks.shopAdminFind.mockResolvedValue({
      shopId: 'shop-1',
      sessionVersion: 3,
      permissionVersion: 1,
      legacyFullAccess: false,
      permissions: [],
      shop: { ownerAdminId: 'shop-admin-1', authorizationVersion: 2 },
    })
    mocks.shopPackageFind.mockResolvedValue({
      id: 'package-2',
      shopId: 'shop-1',
      effectiveOn: new Date(),
      basePrice: { toString: () => '0' },
      currency: 'UZS',
      discountAmount: { toString: () => '0' },
      pricingNeedsReview: false,
      note: 'owner only',
      createdAt: new Date(),
      features: [{
        featureCode: 'STAFF_ACCESS',
        enabled: false,
        recurringPrice: { toString: () => '0' },
        feature: { nameUz: 'Xodimlar', descriptionUz: null, billable: false, platformCore: false, sortOrder: 1 },
      }],
    })
    const { requireApiSession } = await import('@/lib/api-auth')

    const result = await requireApiSession()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.principal?.memberKind).toBe('SHOP_OWNER')
  })

  it('rejects a revoked session before trusting the actor record', async () => {
    mocks.auth.mockResolvedValue(session('SUPER_ADMIN'))
    mocks.authSessionFind.mockResolvedValue({ ...durable('SUPER_ADMIN'), revokedAt: new Date() })
    const { requireApiSession } = await import('@/lib/api-auth')

    const result = await requireApiSession()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
    expect(mocks.superAdminFind).not.toHaveBeenCalled()
  })
})
