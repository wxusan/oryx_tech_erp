import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUsdUzsRateMock } = vi.hoisted(() => ({ getUsdUzsRateMock: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/currency', () => ({ getUsdUzsRate: getUsdUzsRateMock }))

import { createMoneyInputConverter } from '@/lib/server/money-input'

describe('operation-scoped money conversion', () => {
  beforeEach(() => getUsdUzsRateMock.mockReset())

  it('fetches one USD rate and freezes it across every amount in the operation', async () => {
    getUsdUzsRateMock.mockResolvedValueOnce(12_500)
    const convert = await createMoneyInputConverter('USD')
    const purchase = convert(500)
    const sale = convert(800)
    const paid = convert(300)

    expect(getUsdUzsRateMock).toHaveBeenCalledOnce()
    expect([purchase.exchangeRateUsed, sale.exchangeRateUsed, paid.exchangeRateUsed]).toEqual([12_500, 12_500, 12_500])
    expect([purchase.amountUzs, sale.amountUzs, paid.amountUzs]).toEqual([6_250_000, 10_000_000, 3_750_000])
  })
})
