import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actorId: 'actor-original',
  resolutionFindUnique: vi.fn(),
  deferralFindUnique: vi.fn(),
  returnFindUnique: vi.fn(),
  deviceFindFirst: vi.fn(),
  transaction: vi.fn(),
  rateLimit: vi.fn(),
  getUsdUzsRate: vi.fn(),
  getShopCurrencyContext: vi.fn(),
}))

function session() {
  return {
    user: {
      id: mocks.actorId,
      name: 'Replay actor',
      role: 'SUPER_ADMIN',
      shopId: null,
    },
  }
}

vi.mock('@/lib/api-auth', () => ({
  requireShopAnyPermission: vi.fn(async () => ({ ok: true, session: session(), principal: null })),
  requireShopPermissionAndFeature: vi.fn(async () => ({ ok: true, session: session(), principal: null })),
  resolveActiveShopId: vi.fn(async () => ({ ok: true, shopId: 'shop-replay' })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nasiyaResolutionEvent: { findUnique: mocks.resolutionFindUnique },
    nasiyaDeferral: { findUnique: mocks.deferralFindUnique },
    deviceReturn: { findUnique: mocks.returnFindUnique },
    device: { findFirst: mocks.deviceFindFirst },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/rate-limit-adapter', () => ({
  checkRateLimitDistributed: mocks.rateLimit,
}))

vi.mock('@/lib/server/currency', () => ({
  getUsdUzsRate: mocks.getUsdUzsRate,
  getShopCurrencyContext: mocks.getShopCurrencyContext,
}))

vi.mock('@/lib/server/cache-tags', () => ({
  invalidateShopNasiyaMutation: vi.fn(),
  invalidateShopReturnMutation: vi.fn(),
}))

vi.mock('@/lib/notification-service', () => ({
  flushQueuedTelegramWork: vi.fn(),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})

import { NextRequest } from 'next/server'
import { POST as resolveNasiya } from '@/app/api/nasiya/[id]/resolution/route'
import { POST as deferNasiya } from '@/app/api/nasiya/[id]/defer/route'
import { POST as returnSale } from '@/app/api/devices/[id]/return/route'
import { POST as returnNasiya } from '@/app/api/nasiya/[id]/return/route'

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) })

function request(path: string, key: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  })
}

const resolutionBody = {
  action: 'ARCHIVE',
  reason: 'Customer asked to pause collection',
}

const deferralBody = {
  nasiyaScheduleId: 'schedule-replay',
  newDueDate: '2026-09-01T00:00:00.000Z',
  reason: 'Customer requested a later date',
}

const saleReturnBody = {
  note: 'Customer returned the device',
  refundAmount: 10.5,
  refundMethod: 'CASH',
  inputCurrency: 'USD',
  expectedFxRateMinorUnits: 126_500_000,
}

const nasiyaReturnBody = {
  note: 'Customer returned the financed device',
  refundAmount: 10.5,
  refundMethod: 'CASH',
  inputCurrency: 'USD',
  expectedContractReceiptsMinorUnits: 1_050,
  expectedContractRemainingMinorUnits: 500,
  expectedFxRateMinorUnits: 126_500_000,
}

function storedReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-replay',
    deviceId: 'device-replay',
    saleId: 'sale-replay',
    nasiyaId: null,
    createdAt: new Date('2026-07-23T12:00:00.000Z'),
    createdBy: 'actor-original',
    contractCurrency: 'USD',
    contractReceiptsAtReturn: 25,
    refundInputAmount: 10.5,
    refundInputCurrency: 'USD',
    contractRefundAmount: 10.5,
    contractRetainedAmount: 14.5,
    contractCancelledDebt: 0,
    refundAmount: 132_825,
    refundMethod: 'CASH',
    note: 'Customer returned the device',
    ...overrides,
  }
}

describe('durable financial replay routes', () => {
  beforeEach(() => {
    mocks.actorId = 'actor-original'
    mocks.resolutionFindUnique.mockReset()
    mocks.deferralFindUnique.mockReset()
    mocks.returnFindUnique.mockReset()
    mocks.deviceFindFirst.mockReset()
    mocks.transaction.mockReset()
    mocks.rateLimit.mockReset()
    mocks.getUsdUzsRate.mockReset()
    mocks.getShopCurrencyContext.mockReset()
  })

  it('replays a resolution for its original actor before rate limiting or FX lookup', async () => {
    mocks.resolutionFindUnique.mockResolvedValue({
      id: 'resolution-replay',
      nasiyaId: 'nasiya-replay',
      eventType: 'ARCHIVE',
      reason: resolutionBody.reason,
      actorId: 'actor-original',
    })

    const response = await resolveNasiya(
      request('/api/nasiya/nasiya-replay/resolution', 'resolve1', resolutionBody),
      routeContext('nasiya-replay'),
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.duplicate).toBe(true)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.getUsdUzsRate).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('replays a deferral for its original actor before rate limiting', async () => {
    mocks.deferralFindUnique.mockResolvedValue({
      id: 'deferral-replay',
      nasiyaId: 'nasiya-replay',
      nasiyaScheduleId: 'schedule-replay',
      originalDueDate: new Date('2026-08-01T00:00:00.000Z'),
      newDueDate: new Date(deferralBody.newDueDate),
      note: deferralBody.reason,
      createdBy: 'actor-original',
    })

    const response = await deferNasiya(
      request('/api/nasiya/nasiya-replay/defer', 'defer001', deferralBody),
      routeContext('nasiya-replay'),
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.duplicate).toBe(true)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('replays sale and Nasiya refunds at exact native minor units before current FX lookup', async () => {
    mocks.returnFindUnique
      .mockResolvedValueOnce(storedReturn())
      .mockResolvedValueOnce(storedReturn({
        saleId: null,
        nasiyaId: 'nasiya-replay',
        note: nasiyaReturnBody.note,
      }))
    mocks.deviceFindFirst.mockResolvedValue({ id: 'device-replay' })

    const saleResponse = await returnSale(
      request('/api/devices/device-replay/return', 'return01', saleReturnBody),
      routeContext('device-replay'),
    )
    const nasiyaResponse = await returnNasiya(
      request('/api/nasiya/nasiya-replay/return', 'return02', nasiyaReturnBody),
      routeContext('nasiya-replay'),
    )

    expect(saleResponse.status).toBe(200)
    expect(nasiyaResponse.status).toBe(200)
    expect((await nasiyaResponse.json()).data.duplicate).toBe(true)
    expect(mocks.getShopCurrencyContext).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects the same committed keys for a different actor without touching mutable dependencies', async () => {
    mocks.actorId = 'actor-different'
    mocks.resolutionFindUnique.mockResolvedValue({
      id: 'resolution-replay',
      nasiyaId: 'nasiya-replay',
      eventType: 'ARCHIVE',
      reason: resolutionBody.reason,
      actorId: 'actor-original',
    })
    mocks.deferralFindUnique.mockResolvedValue({
      id: 'deferral-replay',
      nasiyaId: 'nasiya-replay',
      nasiyaScheduleId: 'schedule-replay',
      originalDueDate: new Date('2026-08-01T00:00:00.000Z'),
      newDueDate: new Date(deferralBody.newDueDate),
      note: deferralBody.reason,
      createdBy: 'actor-original',
    })
    mocks.returnFindUnique
      .mockResolvedValueOnce(storedReturn())
      .mockResolvedValueOnce(storedReturn({
        saleId: null,
        nasiyaId: 'nasiya-replay',
        note: nasiyaReturnBody.note,
      }))

    const responses = await Promise.all([
      resolveNasiya(
        request('/api/nasiya/nasiya-replay/resolution', 'resolve1', resolutionBody),
        routeContext('nasiya-replay'),
      ),
      deferNasiya(
        request('/api/nasiya/nasiya-replay/defer', 'defer001', deferralBody),
        routeContext('nasiya-replay'),
      ),
      returnSale(
        request('/api/devices/device-replay/return', 'return01', saleReturnBody),
        routeContext('device-replay'),
      ),
      returnNasiya(
        request('/api/nasiya/nasiya-replay/return', 'return02', nasiyaReturnBody),
        routeContext('nasiya-replay'),
      ),
    ])

    expect(responses.map(({ status }) => status)).toEqual([409, 409, 409, 409])
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.getUsdUzsRate).not.toHaveBeenCalled()
    expect(mocks.getShopCurrencyContext).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('accepts the inclusive 120-character key boundary for a committed replay', async () => {
    const idempotencyKey = 'x'.repeat(120)
    mocks.resolutionFindUnique.mockResolvedValue({
      id: 'resolution-replay',
      nasiyaId: 'nasiya-replay',
      eventType: 'ARCHIVE',
      reason: resolutionBody.reason,
      actorId: 'actor-original',
    })

    const response = await resolveNasiya(
      request('/api/nasiya/nasiya-replay/resolution', idempotencyKey, resolutionBody),
      routeContext('nasiya-replay'),
    )

    expect(response.status).toBe(200)
    expect(mocks.resolutionFindUnique).toHaveBeenCalledWith({
      where: {
        shopId_idempotencyKey: {
          shopId: 'shop-replay',
          idempotencyKey,
        },
      },
    })
  })

  it.each([
    ['resolution', resolveNasiya, '/api/nasiya/nasiya-replay/resolution', 'nasiya-replay', resolutionBody],
    ['deferral', deferNasiya, '/api/nasiya/nasiya-replay/defer', 'nasiya-replay', deferralBody],
    ['sale return', returnSale, '/api/devices/device-replay/return', 'device-replay', saleReturnBody],
    ['Nasiya return', returnNasiya, '/api/nasiya/nasiya-replay/return', 'nasiya-replay', nasiyaReturnBody],
  ])('rejects %s idempotency keys outside 8–120 characters before replay lookup', async (
    _label,
    handler,
    path,
    id,
    body,
  ) => {
    const tooShort = await handler(request(path, '1234567', body), routeContext(id))
    const tooLong = await handler(request(path, 'x'.repeat(121), body), routeContext(id))

    expect([tooShort.status, tooLong.status]).toEqual([400, 400])
    expect(mocks.resolutionFindUnique).not.toHaveBeenCalled()
    expect(mocks.deferralFindUnique).not.toHaveBeenCalled()
    expect(mocks.returnFindUnique).not.toHaveBeenCalled()
  })

  it('does not round an invalid USD refund into equality with a committed cent amount', async () => {
    mocks.returnFindUnique.mockResolvedValue(storedReturn({
      saleId: null,
      nasiyaId: 'nasiya-replay',
      note: nasiyaReturnBody.note,
    }))

    const response = await returnNasiya(
      request('/api/nasiya/nasiya-replay/return', 'return02', {
        ...nasiyaReturnBody,
        refundAmount: 10.501,
      }),
      routeContext('nasiya-replay'),
    )

    expect(response.status).toBe(400)
    expect(mocks.getShopCurrencyContext).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
