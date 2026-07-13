import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('P0-02 sale payment route guard: contract currency is authoritative', () => {
  const route = read('src/app/api/sales/[id]/payment/route.ts')

  it('converts once, then validates against contractRemainingAmount inside the transaction', () => {
    expect(route).toContain('const requestedAppliedAmountInContractCurrency = convertPaymentToContractCurrency(')
    expect(route).toContain("import { applySalePaymentToContractLedger } from '@/lib/sale-contract-payment'")
    const helperCall = route.indexOf('const contractPayment = applySalePaymentToContractLedger({')
    const legacySnapshot = route.indexOf('const oldRemaining = Number(sale.remainingAmount)')
    expect(helperCall).toBeGreaterThan(-1)
    expect(legacySnapshot).toBeGreaterThan(helperCall)
    const helperBlock = route.slice(helperCall, helperCall + 700)
    expect(helperBlock).toContain('contractCurrency: sale.contractCurrency')
    expect(helperBlock).toContain('contractSalePrice: Number(sale.contractSalePrice)')
    expect(helperBlock).toContain('contractAmountPaid: Number(sale.contractAmountPaid)')
    expect(helperBlock).toContain('contractRemainingAmount: Number(sale.contractRemainingAmount)')
    expect(helperBlock).toContain('appliedAmountInContractCurrency: requestedAppliedAmountInContractCurrency')
  })

  it('never rejects because the UZS snapshot payment is larger than legacy remainingAmount', () => {
    expect(route).not.toContain('if (amount > oldRemaining)')
    expect(route).not.toContain("message: \"To'lov qolgan qarzdan oshib ketdi\"")
    expect(route).toContain("message: \"To'lov qolgan shartnoma qarzidan oshib ketdi\"")
  })

  it('preserves input history and applied native amount on SalePayment', () => {
    const createStart = route.indexOf('const payment = await tx.salePayment.create')
    const createBlock = route.slice(createStart, createStart + 900)
    expect(createBlock).toContain('paymentInputAmount: parsed.data.amount')
    expect(createBlock).toContain('paymentInputCurrency: amountInput.inputCurrency')
    expect(createBlock).toContain('paymentExchangeRate: contractRate')
    expect(createBlock).toContain('appliedAmountInContractCurrency: contractPayment.appliedAmountInContractCurrency')
  })

  it('replays an idempotent final payment before settlement rejection and scopes active sales to the tenant', () => {
    expect(route).toContain('where: { shopId_idempotencyKey: { shopId, idempotencyKey } }')
    const replayLookup = route.indexOf('const existingPayment = await tx.salePayment.findUnique')
    const saleLookup = route.indexOf('const sale = await tx.sale.findFirst')
    const settlementCheck = route.indexOf('const contractPayment = applySalePaymentToContractLedger({')
    expect(replayLookup).toBeGreaterThan(-1)
    expect(saleLookup).toBeGreaterThan(replayLookup)
    expect(settlementCheck).toBeGreaterThan(saleLookup)
    const activeSaleBlock = route.slice(saleLookup, saleLookup + 300)
    expect(activeSaleBlock).toContain('id: saleId')
    expect(activeSaleBlock).toContain('shopId')
    expect(activeSaleBlock).toContain('deletedAt: null')
    expect(activeSaleBlock).toContain('returnedAt: null')
    expect(route).toContain('{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }')
    expect(route).toContain('isRetryableTransactionError(err) && attempt < 2')
  })

  it('passes native applied and remaining values to the sale payment message', () => {
    const messageStart = route.indexOf('const paymentMessage = salePaymentMessage({')
    const messageBlock = route.slice(messageStart, messageStart + 1200)
    expect(messageBlock).toContain('paidAmount: contractPayment.appliedAmountInContractCurrency')
    expect(messageBlock).toContain('remaining: contractPayment.newContractRemainingAmount')
    expect(messageBlock).toContain('contractCurrency: sale.contractCurrency')
  })
})
