import { describe, expect, it } from 'vitest'
import { convertContractAmountToUzs, roundContractMoney } from '@/lib/nasiya-contract'
import { generateImportSchedule } from '@/lib/nasiya-utils'
import { computeShopStatsFromRows } from '@/lib/shop-stats-formulas'
import { applySalePaymentToContractLedger } from '@/lib/sale-contract-payment'
import { importNasiyaSchema } from '@/lib/validations'
import { validatePaymentBreakdown } from '@/lib/payment-breakdown'
import { hasValidMinorUnits } from '@/lib/currency'

function emptyStatsRows() {
  return {
    now: new Date('2026-07-13T12:00:00.000Z'),
    monthStart: new Date('2026-07-01T00:00:00.000Z'),
    monthEnd: new Date('2026-08-01T00:00:00.000Z'),
    usdUzsRate: null,
    totalDevices: 0,
    cashSalesThisMonth: [],
    saleReceivedSum: 0,
    nasiyaSoldThisMonth: [],
    nasiyaReceivedSum: 0,
    activeNasiyalar: 0,
    nasiyaSchedulesForStats: [],
    unpaidSales: [],
    inventoryPurchaseCostSum: 0,
    returnRefundSum: 0,
    returnsThisMonth: 0,
    recentActivity: [],
    upcomingPayments: [],
  }
}

describe('adversarial monetary behavior — regression evidence', () => {
  it('never mixes raw USD with UZS when the live conversion rate is unavailable', () => {
    const rows = emptyStatsRows()
    const result = computeShopStatsFromRows({
      ...rows,
      nasiyaSchedulesForStats: [
        {
          dueDate: new Date('2026-07-20T00:00:00.000Z'),
          delayedUntil: null,
          expectedAmount: 500_000,
          paidAmount: 0,
          contractExpectedAmount: 500_000,
          contractPaidAmount: 0,
          nasiya: { contractCurrency: 'UZS' as const },
        },
        {
          dueDate: new Date('2026-07-20T00:00:00.000Z'),
          delayedUntil: null,
          expectedAmount: 1_250_000,
          paidAmount: 0,
          contractExpectedAmount: 100,
          contractPaidAmount: 0,
          nasiya: { contractCurrency: 'USD' as const },
        },
      ],
    })

    expect(convertContractAmountToUzs(100, 'USD', null)).toBeNull()
    expect(result.expectedThisMonth).toBe(500_000)
    expect(result.expectedThisMonth).not.toBe(500_100)
  })

  it("enforces whole so'm for UZS and at most two decimal places for USD", () => {
    expect(hasValidMinorUnits(1, 'UZS')).toBe(true)
    expect(hasValidMinorUnits(0.1, 'UZS')).toBe(false)
    expect(hasValidMinorUnits(10.01, 'USD')).toBe(true)
    expect(hasValidMinorUnits(10.001, 'USD')).toBe(false)
    expect(roundContractMoney(1, 'UZS')).toBe(1)
    expect(roundContractMoney(0.01, 'USD')).toBe(0.01)
  })

  it('rejects contradictory import history and impossible native schedules', () => {
    const contradictory = importNasiyaSchema.safeParse({
      customerName: 'Audit customer',
      customerPhone: '+998901234567',
      deviceModel: 'Audit phone',
      conditionCode: 'USED',
      originalTotalAmount: 100,
      alreadyPaidBeforeImport: 200,
      remainingDebt: 50,
      monthlyPayment: 10,
      nextPaymentDate: new Date('2026-08-01T00:00:00.000Z'),
      inputCurrency: 'UZS',
    })
    expect(contradictory.success).toBe(false)
    expect(() => generateImportSchedule(
      new Date('2026-08-01T00:00:00.000Z'),
      0.02,
      0.005,
      'USD',
      4,
    )).toThrow(/musbat minor birliklarda/)
  })

  it('rejects every overpayment without clipping it or creating unexplained credit', () => {
    const settlement = applySalePaymentToContractLedger({
      contractCurrency: 'UZS',
      contractSalePrice: 1_000,
      contractAmountPaid: 0,
      contractRemainingAmount: 1_000,
      appliedAmountInContractCurrency: 1_499,
    })

    expect(settlement).toMatchObject({
      accepted: false,
      reason: 'OVERPAYMENT',
      appliedAmountInContractCurrency: 0,
      newContractAmountPaid: 0,
      newContractRemainingAmount: 1_000,
    })
  })

  it('applies currency-specific minor-unit rules to split payments', () => {
    expect(validatePaymentBreakdown([
      { method: 'CASH', amount: 500 },
      { method: 'CARD', amount: 499.995 },
    ], 999.995, 'UZS')).toMatch(/butun so'm/)

    expect(validatePaymentBreakdown([
      { method: 'CASH', amount: 500 },
      { method: 'CARD', amount: 499.99 },
    ], 999.99, 'USD')).toBeNull()

    expect(validatePaymentBreakdown([
      { method: 'CASH', amount: 500 },
      { method: 'CARD', amount: 499.995 },
    ], 999.995, 'USD')).toMatch(/2 kasr xonali/)
  })
})
