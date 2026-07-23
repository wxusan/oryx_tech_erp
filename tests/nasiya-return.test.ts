import { describe, expect, it } from 'vitest'
import {
  calculateNasiyaReturnQuote,
  nasiyaReturnLedgerHasBlockingReasons,
  nasiyaScheduleStatusAfterReturn,
} from '@/lib/nasiya-return'
import type { ReturnReceiptSource } from '@/lib/return-accounting'

function receipt(overrides: Partial<ReturnReceiptSource> & Pick<ReturnReceiptSource, 'id'>): ReturnReceiptSource {
  return {
    kind: 'NASIYA',
    paidAt: new Date('2026-07-01T08:00:00.000Z'),
    paymentMethod: 'CASH',
    paymentBreakdown: null,
    amountUzs: 0,
    paymentInputAmount: null,
    paymentExchangeRate: null,
    appliedContractAmount: null,
    ...overrides,
  }
}

function quote(overrides: Partial<Parameters<typeof calculateNasiyaReturnQuote>[0]> = {}) {
  return calculateNasiyaReturnQuote({
    contractCurrency: 'UZS',
    contractDownPayment: 100,
    cancelledDebt: 750,
    contractExchangeRateAtCreation: null,
    accountingReconstructionStatus: 'COMPLETE',
    resolutionState: 'ACTIVE',
    deviceStatus: 'SOLD_NASIYA',
    sources: [
      receipt({ id: 'down-payment', amountUzs: 100, appliedContractAmount: 100 }),
      receipt({
        id: 'later-payment',
        paidAt: new Date('2026-07-15T08:00:00.000Z'),
        amountUzs: 150,
        appliedContractAmount: 150,
      }),
    ],
    ...overrides,
  })
}

describe('Nasiya physical-return quote', () => {
  it('projects open schedule badges to cancelled while preserving paid history', () => {
    expect((['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] as const).map(nasiyaScheduleStatusAfterReturn))
      .toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED', 'CANCELLED'])
    expect((['PAID', 'SETTLED', 'CANCELLED'] as const).map(nasiyaScheduleStatusAfterReturn))
      .toEqual(['PAID', 'SETTLED', 'CANCELLED'])
  })

  it('defaults the editable refund to the original down payment and keeps later receipts as retained value', () => {
    const result = quote()

    expect(result).toMatchObject({
      eligible: true,
      receiptEvidenceVerified: true,
      defaultRefundMethod: 'CASH',
      receipts: { currency: 'UZS', minorUnits: 250 },
      defaultRefund: { currency: 'UZS', minorUnits: 100 },
      defaultRetained: { currency: 'UZS', minorUnits: 150 },
      maxRefund: { currency: 'UZS', minorUnits: 250 },
      cancelledDebt: { currency: 'UZS', minorUnits: 750 },
    })
    expect(result.methodCapacities.find(({ method }) => method === 'CASH')?.available.minorUnits).toBe(250)
  })

  it('supports zero down payment and a zero-refund default without inventing a refund method', () => {
    const result = quote({
      contractDownPayment: 0,
      sources: [receipt({ id: 'later-card', paymentMethod: 'CARD', amountUzs: 80, appliedContractAmount: 80 })],
    })

    expect(result.eligible).toBe(true)
    expect(result.defaultRefund.minorUnits).toBe(0)
    expect(result.defaultRetained.minorUnits).toBe(80)
    expect(result.maxRefund.minorUnits).toBe(80)
    expect(result.defaultRefundMethod).toBeNull()
  })

  it('uses split-receipt evidence to expose only the amount available per original method', () => {
    const result = quote({
      contractDownPayment: 120,
      sources: [receipt({
        id: 'split-down-payment',
        amountUzs: 200,
        appliedContractAmount: 200,
        paymentMethod: null,
        paymentBreakdown: [
          { method: 'CASH', amount: 120 },
          { method: 'CARD', amount: 80 },
        ],
      })],
    })

    expect(result.defaultRefundMethod).toBe('CASH')
    expect(result.methodCapacities.find(({ method }) => method === 'CASH')?.available.minorUnits).toBe(120)
    expect(result.methodCapacities.find(({ method }) => method === 'CARD')?.available.minorUnits).toBe(80)
  })

  it('blocks unverified historic accounting instead of inventing receipt or refund figures', () => {
    const result = quote({ accountingReconstructionStatus: 'PENDING' })

    expect(result.eligible).toBe(false)
    expect(result.receiptEvidenceVerified).toBe(false)
    expect(result.receipts.minorUnits).toBe(0)
    expect(result.defaultRefund.minorUnits).toBe(0)
    expect(result.ineligibilityReason).toContain('to‘liq tasdiqlanmagan')
  })

  it('blocks a down-payment refund when immutable receipts do not prove that much money was received', () => {
    const result = quote({
      contractDownPayment: 100,
      sources: [receipt({ id: 'insufficient', amountUzs: 90, appliedContractAmount: 90 })],
    })

    expect(result.eligible).toBe(false)
    expect(result.ineligibilityReason).toContain('Boshlang‘ich to‘lovni tasdiqlovchi')
  })
})

describe('Nasiya return ledger safety gate', () => {
  it('ignores only refreshable status lag and blocks real money inconsistencies', () => {
    expect(nasiyaReturnLedgerHasBlockingReasons([
      'schedule x status differs from schedule-derived status',
      'parent status differs from schedule-derived status',
    ])).toBe(false)
    expect(nasiyaReturnLedgerHasBlockingReasons([
      'schedule x contract paid total differs from allocation total',
    ])).toBe(true)
  })
})
