import { describe, expect, it } from 'vitest'
import {
  calculateNasiyaReturnQuote,
  nasiyaReturnLedgerHasBlockingReasons,
  nasiyaScheduleStatusAfterReturn,
  presentNasiyaReturnQuote,
} from '@/lib/nasiya-return'
import { createFxQuoteDto } from '@/lib/currency'
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
      receipts: { currency: 'UZS', minorUnits: 250 },
      defaultRefund: { currency: 'UZS', minorUnits: 100 },
      defaultRetained: { currency: 'UZS', minorUnits: 150 },
      maxRefund: { currency: 'UZS', minorUnits: 250 },
      cancelledDebt: { currency: 'UZS', minorUnits: 750 },
    })
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
  })

  it('does not require an original receipt method to verify the received amount', () => {
    const result = quote({
      contractDownPayment: 120,
      sources: [receipt({
        id: 'legacy-down-payment',
        amountUzs: 200,
        appliedContractAmount: 200,
        paymentMethod: null,
        paymentBreakdown: null,
      })],
    })

    expect(result.eligible).toBe(true)
    expect(result.receipts.minorUnits).toBe(200)
    expect(result.defaultRefund.minorUnits).toBe(120)
  })

  it('presents every visible amount in the shop currency with native guards retained', () => {
    const native = quote({
      contractDownPayment: 1_250_001,
      cancelledDebt: 2_500_000,
      sources: [
        receipt({
          id: 'large-down-payment',
          amountUzs: 1_250_001,
          appliedContractAmount: 1_250_001,
        }),
      ],
    })
    const fxQuote = createFxQuoteDto({
      rate: 12_500,
      source: 'CBU',
      fetchedAt: '2026-07-23T08:00:00.000Z',
    })
    const displayed = presentNasiyaReturnQuote(native, 'USD', fxQuote)

    expect(displayed.eligible).toBe(true)
    expect([
      displayed.receipts,
      displayed.defaultRefund,
      displayed.defaultRetained,
      displayed.maxRefund,
      displayed.cancelledDebt,
    ].every((money) => money.currency === 'USD')).toBe(true)
    expect(displayed.maxRefund.minorUnits).toBe(10_000)
    expect(displayed.contractReceipts).toEqual({ currency: 'UZS', minorUnits: 1_250_001 })
    expect(displayed.contractCancelledDebt).toEqual({ currency: 'UZS', minorUnits: 2_500_000 })
    expect(displayed.fxQuote?.rateMinorUnits).toBe(125_000_000)
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
