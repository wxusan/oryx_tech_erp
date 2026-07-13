import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { principalCan, type ShopPrincipalAccess } from '@/lib/access-control'

const mocks = vi.hoisted(() => ({
  requireCurrentShopPermission: vi.fn(),
  shopFindFirst: vi.fn(),
  shopUpdate: vi.fn(),
  logCreate: vi.fn(),
  shopFindUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
  invalidateShopProfileMutation: vi.fn(),
  getShopCurrencyContext: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireApiSession: vi.fn(),
  requireCurrentShopPermission: mocks.requireCurrentShopPermission,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    shop: { findFirst: mocks.shopFindFirst },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/server/cache-tags', () => ({
  invalidateShopProfileMutation: mocks.invalidateShopProfileMutation,
}))

vi.mock('@/lib/server/currency', () => ({
  getShopCurrencyContext: mocks.getShopCurrencyContext,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}))

const existingShop = {
  id: 'shop-1',
  name: 'Old shop',
  ownerName: 'Owner',
  ownerPhone: '+998901234567',
  address: 'Old address',
  note: null,
  preferredCurrency: 'UZS',
}

const updatedShop = {
  ...existingShop,
  name: 'Updated shop',
  shopNumber: '001',
  status: 'ACTIVE',
  subscriptionDue: new Date('2026-08-01T00:00:00.000Z'),
}

function patchRequest() {
  return new NextRequest('http://localhost/api/shop/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Updated shop' }),
  })
}

describe('shop settings permission', () => {
  const principal = (memberKind: ShopPrincipalAccess['memberKind']): ShopPrincipalAccess => ({
    memberKind,
    legacyFullAccess: false,
    enabledFeatures: new Set(),
    grantedPermissions: new Set(),
  })

  it('allows the owner and denies staff', () => {
    expect(principalCan(principal('SHOP_OWNER'), 'SETTINGS_MANAGE')).toBe(true)
    expect(principalCan(principal('SHOP_STAFF'), 'SETTINGS_MANAGE')).toBe(false)
  })
})

describe('PATCH /api/shop/profile authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shopFindFirst.mockResolvedValue(existingShop)
    mocks.shopUpdate.mockResolvedValue(updatedShop)
    mocks.logCreate.mockResolvedValue({ id: 'log-1' })
    mocks.shopFindUniqueOrThrow.mockResolvedValue(updatedShop)
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      shop: {
        update: mocks.shopUpdate,
        findUniqueOrThrow: mocks.shopFindUniqueOrThrow,
      },
      log: { create: mocks.logCreate },
    }))
    mocks.getShopCurrencyContext.mockResolvedValue({ usdUzsRate: 12_500 })
  })

  it('allows the owner through SETTINGS_MANAGE and writes the shop update', async () => {
    mocks.requireCurrentShopPermission.mockResolvedValue({
      ok: true,
      session: {
        user: { id: 'owner-1', role: 'SHOP_ADMIN', shopId: 'shop-1' },
      },
      shopId: 'shop-1',
      principal: { memberKind: 'SHOP_OWNER' },
    })
    const { PATCH } = await import('@/app/api/shop/profile/route')

    const response = await PATCH(patchRequest())

    expect(response.status).toBe(200)
    expect(mocks.requireCurrentShopPermission).toHaveBeenCalledWith('SETTINGS_MANAGE')
    expect(mocks.shopUpdate).toHaveBeenCalledWith({
      where: { id: 'shop-1' },
      data: { name: 'Updated shop' },
    })
    expect(mocks.logCreate).toHaveBeenCalledOnce()
    expect(mocks.invalidateShopProfileMutation).toHaveBeenCalledWith('shop-1')
  })

  it('denies staff before parsing or performing any database/cache write', async () => {
    mocks.requireCurrentShopPermission.mockResolvedValue({
      ok: false,
      response: Response.json(
        { success: false, error: "Bu amal uchun ruxsat berilmagan" },
        { status: 403 },
      ),
    })
    const request = patchRequest()
    const json = vi.spyOn(request, 'json')
    const { PATCH } = await import('@/app/api/shop/profile/route')

    const response = await PATCH(request)

    expect(response.status).toBe(403)
    expect(mocks.requireCurrentShopPermission).toHaveBeenCalledWith('SETTINGS_MANAGE')
    expect(json).not.toHaveBeenCalled()
    expect(mocks.shopFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.shopUpdate).not.toHaveBeenCalled()
    expect(mocks.logCreate).not.toHaveBeenCalled()
    expect(mocks.invalidateShopProfileMutation).not.toHaveBeenCalled()
    expect(mocks.getShopCurrencyContext).not.toHaveBeenCalled()
  })
})
