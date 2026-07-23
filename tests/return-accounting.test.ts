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

  it('allocates a refund to newest receipts first', () => {
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

  it('records original split methods separately from the chosen refund method', () => {
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
      refundMethod: 'CASH',
      refundContractAmount: 100,
      refundAmountUzs: 1_250_000,
    })

    expect(allocations).toEqual([
      expect.objectContaining({
        salePaymentId: 'payment-1',
        sourcePaymentMethod: 'CASH',
        refundMethod: 'CASH',
        contractAmount: 25,
      }),
      expect.objectContaining({
        salePaymentId: 'payment-1',
        sourcePaymentMethod: 'CARD',
        refundMethod: 'CASH',
        contractAmount: 75,
      }),
    ])
  })

  it('allows a cash refund for a card receipt', () => {
    expect(allocateReturnRefund({
      sources: [receipt({ paymentMethod: 'CARD' })],
      contractCurrency: 'USD',
      frozenUsdUzsRate: 12_500,
      refundMethod: 'CASH',
      refundContractAmount: 100,
      refundAmountUzs: 1_250_000,
    })).toEqual([
      expect.objectContaining({
        sourcePaymentMethod: 'CARD',
        refundMethod: 'CASH',
        contractAmount: 100,
      }),
    ])
  })

  it('allocates a verified legacy receipt even when its original method is unknown', () => {
    expect(allocateReturnRefund({
      sources: [receipt({ paymentMethod: null, paymentBreakdown: null })],
      contractCurrency: 'USD',
      frozenUsdUzsRate: 12_500,
      refundMethod: 'TRANSFER',
      refundContractAmount: 100,
      refundAmountUzs: 1_250_000,
    })).toEqual([
      expect.objectContaining({
        sourcePaymentMethod: null,
        refundMethod: 'TRANSFER',
      }),
    ])
  })
})
