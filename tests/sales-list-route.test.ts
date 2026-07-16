import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireShopAnyPermission: vi.fn(),
  resolveActiveShopId: vi.fn(),
  getSalesList: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireShopAnyPermission: mocks.requireShopAnyPermission,
  resolveActiveShopId: mocks.resolveActiveShopId,
}))
vi.mock('@/lib/server/sales-list', () => ({ getSalesList: mocks.getSalesList }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }))

describe('GET /api/sales bounded list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireShopAnyPermission.mockResolvedValue({
      ok: true,
      session: { user: { id: 'actor', role: 'SHOP_ADMIN', shopId: 'shop-1' } },
      principal: { memberKind: 'SHOP_STAFF' },
    })
    mocks.resolveActiveShopId.mockResolvedValue({ ok: true, shopId: 'shop-1' })
    mocks.getSalesList.mockResolvedValue({ items: [], skip: 25, take: 25, hasNext: false })
  })

  it('keeps tenant resolution, permissions, paging, and staff financial scope', async () => {
    const { GET } = await import('@/app/api/sales/route')
    const response = await GET(new NextRequest('http://localhost/api/sales?skip=25&take=25&search=iphone'))

    expect(response.status).toBe(200)
    expect(mocks.requireShopAnyPermission).toHaveBeenCalledWith([
      'SALE_VIEW',
      'SALE_EDIT',
      'SALE_REMINDER_MANAGE',
    ])
    expect(mocks.getSalesList).toHaveBeenCalledWith({
      shopId: 'shop-1',
      search: 'iphone',
      skip: 25,
      take: 25,
      includeOwnerFinancials: false,
    })
  })

  it('bounds the requested page size and includes owner-only financials for owners', async () => {
    mocks.requireShopAnyPermission.mockResolvedValue({
      ok: true,
      session: { user: { id: 'owner', role: 'SHOP_ADMIN', shopId: 'shop-1' } },
      principal: { memberKind: 'SHOP_OWNER' },
    })
    const { GET } = await import('@/app/api/sales/route')
    await GET(new NextRequest('http://localhost/api/sales?take=10000'))

    expect(mocks.getSalesList).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      includeOwnerFinancials: true,
    }))
  })

  it('rejects oversized search before querying', async () => {
    const { GET } = await import('@/app/api/sales/route')
    const response = await GET(new NextRequest(`http://localhost/api/sales?search=${'x'.repeat(101)}`))
    expect(response.status).toBe(400)
    expect(mocks.getSalesList).not.toHaveBeenCalled()
  })
})
