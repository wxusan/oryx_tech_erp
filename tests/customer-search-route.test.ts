import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireShopPermission: vi.fn(),
  resolveActiveShopId: vi.fn(),
  getCustomerList: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireShopPermission: mocks.requireShopPermission,
  resolveActiveShopId: mocks.resolveActiveShopId,
}))
vi.mock('@/lib/server/customer-list', () => ({ getCustomerList: mocks.getCustomerList }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }))

function request(body: unknown) {
  return new Request('http://localhost/api/customers/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/customers/search privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireShopPermission.mockResolvedValue({
      ok: true,
      session: { user: { id: 'owner-1', role: 'SHOP_ADMIN', shopId: 'shop-1' } },
    })
    mocks.resolveActiveShopId.mockResolvedValue({ ok: true, shopId: 'shop-1' })
    mocks.getCustomerList.mockResolvedValue({ items: [], total: 0, skip: 0, take: 25 })
  })

  it('accepts an authorized passport search only from a bounded JSON body', async () => {
    const route = await import('@/app/api/customers/search/route')
    expect('GET' in route).toBe(false)
    const passport = 'AA 1234567'
    const response = await route.POST(request({ search: passport, skip: 0, take: 25 }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.requireShopPermission).toHaveBeenCalledWith('CUSTOMER_VIEW')
    expect(mocks.getCustomerList).toHaveBeenCalledWith({
      shopId: 'shop-1',
      search: passport,
      skip: 0,
      take: 25,
    })
    expect(response.url).not.toContain(passport)
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })

  it('does not attach a searched passport identifier to operational error logs', async () => {
    const passport = 'AB 7654321'
    mocks.getCustomerList.mockRejectedValue(new Error(`database rejected ${passport}`))
    const { POST } = await import('@/app/api/customers/search/route')

    const response = await POST(request({ search: passport }))

    expect(response.status).toBe(500)
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(passport)
    expect(mocks.loggerError).toHaveBeenCalledWith('[POST /api/customers/search]', {
      event: 'api.route_error',
      error: { name: 'Error' },
    })
  })

  it('rejects invalid bodies before running a customer query', async () => {
    const { POST } = await import('@/app/api/customers/search/route')
    const response = await POST(request({ search: 'x'.repeat(101) }))
    expect(response.status).toBe(400)
    expect(mocks.getCustomerList).not.toHaveBeenCalled()
  })
})
