import { describe, expect, it } from 'vitest'
import { applySalePaymentToContractLedger } from '@/lib/sale-contract-payment'
import { convertPaymentToContractCurrency } from '@/lib/nasiya-contract'

describe('sale contract payment ledger', () => {
  it('accepts exact final USD sale payment after rate rise', () => {
    // Contract: $100 created when the legacy UZS snapshot was 1,200,000.
    // Payment: the same $100 after the rate rises to 13,000, so its UZS
    // snapshot is 1,300,000. Legacy validation would reject it before this
    // contract-authoritative ledger can settle the real $100 debt.
    const appliedAmountInContractCurrency = convertPaymentToContractCurrency(100, 'USD', 'USD', 13_000)
    const legacyPaymentUzsSnapshot = 100 * 13_000
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency,
    })

    expect(appliedAmountInContractCurrency).toBe(100)
    expect(legacyPaymentUzsSnapshot).toBe(1_300_000)
    expect(legacyPaymentUzsSnapshot).toBeGreaterThan(1_200_000)
    expect(result).toMatchObject({
      accepted: true,
      appliedAmountInContractCurrency: 100,
      newContractAmountPaid: 100,
      newContractRemainingAmount: 0,
      isFullyPaid: true,
    })
  })

  it('accepts exact final USD sale payment after rate fall', () => {
    const appliedAmountInContractCurrency = convertPaymentToContractCurrency(100, 'USD', 'USD', 10_000)
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency,
    })

    expect(result).toMatchObject({ accepted: true, newContractAmountPaid: 100, newContractRemainingAmount: 0, isFullyPaid: true })
  })

  it('accepts a USD sale paid in UZS at the payment-time rate', () => {
    const appliedAmountInContractCurrency = convertPaymentToContractCurrency(1_300_000, 'UZS', 'USD', 13_000)
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency,
    })

    expect(appliedAmountInContractCurrency).toBe(100)
    expect(result).toMatchObject({ accepted: true, newContractRemainingAmount: 0 })
  })

  it('accepts a UZS sale paid in USD at the payment-time rate', () => {
    const appliedAmountInContractCurrency = convertPaymentToContractCurrency(100, 'USD', 'UZS', 12_000)
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'UZS',
      contractSalePrice: 1_200_000,
      contractAmountPaid: 0,
      contractRemainingAmount: 1_200_000,
      appliedAmountInContractCurrency,
    })

    expect(appliedAmountInContractCurrency).toBe(1_200_000)
    expect(result).toMatchObject({ accepted: true, newContractAmountPaid: 1_200_000, newContractRemainingAmount: 0 })
  })

  it('keeps a partial USD payment open and does not read a legacy UZS snapshot', () => {
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency: 40,
    })

    expect(result).toMatchObject({ accepted: true, newContractAmountPaid: 40, newContractRemainingAmount: 60, isFullyPaid: false })
  })

  it('rejects a real USD overpayment beyond the strict one-cent tolerance', () => {
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency: 100.02,
    })

    expect(result).toMatchObject({ accepted: false, reason: 'OVERPAYMENT', newContractRemainingAmount: 100 })
  })

  it('accepts dust beyond a final USD balance but never credits it as debt repayment', () => {
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency: 100.004,
    })

    expect(result).toMatchObject({
      accepted: true,
      appliedAmountInContractCurrency: 100,
      newContractAmountPaid: 100,
      newContractRemainingAmount: 0,
      isFullyPaid: true,
    })
  })

  it('treats a split total exactly like a single payment for contract settlement', () => {
    const splitTotal = 60 + 40
    const result = applySalePaymentToContractLedger({
      contractCurrency: 'USD',
      contractSalePrice: 100,
      contractAmountPaid: 0,
      contractRemainingAmount: 100,
      appliedAmountInContractCurrency: splitTotal,
    })

    expect(result).toMatchObject({ accepted: true, newContractRemainingAmount: 0, isFullyPaid: true })
  })
})
