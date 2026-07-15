import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  shopFindMany: vi.fn(),
  shopCount: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentCount: vi.fn(),
  paymentGroupBy: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    shop: {
      findMany: mocks.shopFindMany,
      count: mocks.shopCount,
    },
    shopPayment: {
      findMany: mocks.paymentFindMany,
      count: mocks.paymentCount,
      groupBy: mocks.paymentGroupBy,
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}))

vi.mock('@/lib/server/currency', () => ({
  getSuperAdminCurrencyContext: vi.fn().mockResolvedValue({
    currency: 'USD',
    usdUzsRate: 12_500,
    usdUzsRateSource: 'CBU',
    usdUzsRateFetchedAt: '2026-07-13T08:00:00.000Z',
  }),
}))

import { GET as getDueShops } from '@/app/api/admin/reports/due-shops/route'
import { GET as getAdminPayments } from '@/app/api/admin/payments/route'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-13T08:00:00.000Z'))
  vi.clearAllMocks()
  mocks.requireSuperAdmin.mockResolvedValue({
    ok: true,
    session: { user: { id: 'super-admin', role: 'SUPER_ADMIN' } },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/admin/reports/due-shops', () => {
  it('returns a stable active-shop page and an uncapped authoritative total', async () => {
    mocks.shopFindMany.mockResolvedValue([
      {
        id: 'shop-25',
        name: 'Twenty Five',
        ownerName: 'Owner',
        shopNumber: '25',
        subscriptionDue: new Date('2026-08-01T00:00:00.000Z'),
        _count: { devices: 4, nasiya: 2 },
      },
    ])
    mocks.shopCount.mockResolvedValue(731)

    const response = await getDueShops(new NextRequest(
      'http://localhost/api/admin/reports/due-shops?skip=24&take=12',
    ))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toMatchObject({ total: 731, skip: 24, take: 12 })
    expect(json.data.items).toHaveLength(1)
    expect(mocks.shopFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: [{ subscriptionDue: 'asc' }, { id: 'asc' }],
      skip: 24,
      take: 12,
    }))
    expect(mocks.shopCount).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', deletedAt: null },
    })
  })

  it('enforces the super-admin guard before reading report data', async () => {
    mocks.requireSuperAdmin.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ success: false, error: "Ruxsat yo'q" }, { status: 403 }),
    })

    const response = await getDueShops(new NextRequest('http://localhost/api/admin/reports/due-shops'))

    expect(response.status).toBe(403)
    expect(mocks.shopFindMany).not.toHaveBeenCalled()
    expect(mocks.shopCount).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/payments', () => {
  it('paginates payment rows while calculating period cards from full-table aggregates', async () => {
    mocks.paymentFindMany.mockResolvedValue([
      {
        id: 'payment-26',
        shopId: 'shop-3',
        amount: '125000.00',
        currency: 'UZS',
        exchangeRateAtPayment: '12500.0000',
        amountUzsSnapshot: '125000.00',
        amountUsdSnapshot: '10.00',
        currencyReconstructionStatus: 'COMPLETE',
        months: 2,
        paymentMethod: 'CARD',
        paidAt: new Date('2026-07-10T10:00:00.000Z'),
        recordedBy: { id: 'admin-1', name: 'Admin', login: 'admin' },
        shop: { name: 'Shop 3', subscriptionDue: new Date('2026-09-10T10:00:00.000Z') },
      },
    ])
    mocks.paymentCount.mockResolvedValue(877)
    mocks.paymentGroupBy
      .mockResolvedValueOnce([{ currency: 'UZS', _sum: { amount: '9000000.00', amountUzsSnapshot: '9000000.00', amountUsdSnapshot: '720.00' }, _count: { id: 90, amountUzsSnapshot: 90, amountUsdSnapshot: 90 } }])
      .mockResolvedValueOnce([{ currency: 'UZS', _sum: { amount: '7000000.00', amountUzsSnapshot: '7000000.00', amountUsdSnapshot: '560.00' }, _count: { id: 70, amountUzsSnapshot: 70, amountUsdSnapshot: 70 } }])
      .mockResolvedValueOnce([{ currency: 'UZS', _sum: { amount: '50000000.00', amountUzsSnapshot: '50000000.00', amountUsdSnapshot: '4000.00' }, _count: { id: 510, amountUzsSnapshot: 510, amountUsdSnapshot: 510 } }])

    const response = await getAdminPayments(new NextRequest(
      'http://localhost/api/admin/payments?skip=25&take=25',
    ))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toMatchObject({
      reporting: {
        selectedDisplayCurrency: 'USD',
        conversion: { usdUzsRate: 12_500, source: 'CBU', status: 'AVAILABLE' },
      },
      total: 877,
      skip: 25,
      take: 25,
      items: [{
        id: 'payment-26',
        shopId: 'shop-3',
        shop: 'Shop 3',
        amount: 125000,
        paymentMethod: 'CARD',
      }],
      summary: {
        currentMonth: { native: { uzs: 9000000, usd: 0 }, snapshots: { uzs: 9000000, usd: 720 }, complete: { UZS: true, USD: true }, count: 90 },
        previousMonth: { native: { uzs: 7000000, usd: 0 }, snapshots: { uzs: 7000000, usd: 560 }, complete: { UZS: true, USD: true }, count: 70 },
        currentYear: { native: { uzs: 50000000, usd: 0 }, snapshots: { uzs: 50000000, usd: 4000 }, complete: { UZS: true, USD: true }, count: 510 },
        currentYearNumber: 2026,
      },
    })
    expect(mocks.paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      skip: 25,
      take: 25,
    }))
    expect(mocks.paymentCount).toHaveBeenCalledWith({ where: { deletedAt: null } })
    expect(mocks.paymentGroupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      by: ['currency'],
      where: {
        deletedAt: null,
        paidAt: {
          gte: new Date('2026-06-30T19:00:00.000Z'),
          lt: new Date('2026-07-31T19:00:00.000Z'),
        },
      },
    }))
    expect(mocks.paymentGroupBy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        deletedAt: null,
        paidAt: {
          gte: new Date('2026-05-31T19:00:00.000Z'),
          lt: new Date('2026-06-30T19:00:00.000Z'),
        },
      },
    }))
    expect(mocks.paymentGroupBy).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: {
        deletedAt: null,
        paidAt: {
          gte: new Date('2025-12-31T19:00:00.000Z'),
          lt: new Date('2026-12-31T19:00:00.000Z'),
        },
      },
    }))
  })

  it('clamps maliciously large or negative page arguments', async () => {
    mocks.paymentFindMany.mockResolvedValue([])
    mocks.paymentCount.mockResolvedValue(0)
    mocks.paymentGroupBy.mockResolvedValue([])

    const response = await getAdminPayments(new NextRequest(
      'http://localhost/api/admin/payments?skip=-999&take=999999',
    ))
    const json = await response.json()

    expect(json.data).toMatchObject({ total: 0, skip: 0, take: 100, items: [] })
    expect(mocks.paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }))
  })
})
