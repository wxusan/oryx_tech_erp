import { describe, expect, it } from 'vitest'
import { allocateReturnRefund, resolveAppliedContractAmount, type ReturnReceiptSource } from '@/lib/return-accounting'

function receipt(overrides: Partial<ReturnReceiptSource> = {}): ReturnReceiptSource {
  return {
    id: 'payment-1',
    kind: 'SALE',
    paidAt: new Date('2026-07-01T00:00:00.000Z'),
    paymentMethod: 'CASH',
    paymentBreakdown: null,
    amountUzs: 1_250_000,
    paymentInputAmount: 100,
    paymentExchangeRate: 12_500,
    appliedContractAmount: 100,
    ...overrides,
  }
}

describe('immutable return accounting', () => {
  it('uses the frozen payment amount instead of a later exchange rate', () => {
    expect(resolveAppliedContractAmount(receipt(), 'USD', 15_000)).toBe(100)
  })

  it('allocates a same-method refund to newest receipts first', () => {
    const allocations = allocateReturnRefund({
      sources: [
        receipt({ id: 'older', paidAt: new Date('2026-07-01'), appliedContractAmount: 60, amountUzs: 750_000 }),
        receipt({ id: 'newer', paidAt: new Date('2026-07-02'), appliedContractAmount: 40, amountUzs: 500_000 }),
      ],
      contractCurrency: 'USD',
      frozenUsdUzsRate: 12_500,
      refundMethod: 'CASH',
      refundContractAmount: 50,
      refundAmountUzs: 625_000,
    })

    expect(allocations).toEqual([
      expect.objectContaining({ salePaymentId: 'newer', contractAmount: 40, amountUzs: 500_000 }),
      expect.objectContaining({ salePaymentId: 'older', contractAmount: 10, amountUzs: 125_000 }),
    ])
  })

  it('allocates only the matching method from a split payment', () => {
    const allocations = allocateReturnRefund({
      sources: [receipt({
        paymentMethod: 'OTHER',
        paymentBreakdown: [
          { method: 'CASH', amount: 25 },
          { method: 'CARD', amount: 75 },
        ],
      })],
      contractCurrency: 'USD',
      frozenUsdUzsRate: 12_500,
      refundMethod: 'CARD',
      refundContractAmount: 75,
      refundAmountUzs: 937_500,
    })

    expect(allocations).toEqual([
      expect.objectContaining({ salePaymentId: 'payment-1', sourcePaymentMethod: 'CARD', contractAmount: 75 }),
    ])
  })

  it('rejects refunding through a method that did not receive enough money', () => {
    expect(() => allocateReturnRefund({
      sources: [receipt({ paymentMethod: 'CARD' })],
      contractCurrency: 'USD',
      frozenUsdUzsRate: 12_500,
      refundMethod: 'CASH',
      refundContractAmount: 1,
      refundAmountUzs: 12_500,
    })).toThrow("Tanlangan usul bo'yicha")
  })
})
