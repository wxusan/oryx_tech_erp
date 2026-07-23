import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * A USD-native sale's "current state" figures (sold price, paid, remaining,
 * profit) must never be shown by reconverting the legacy UZS snapshot
 * (frozen at the CREATION rate) through TODAY's rate — that double
 * conversion silently drifts from the true contract value as the rate moves
 * between creation and any later viewing (e.g. $500 at creation-rate 12,500
 * would wrongly read as $480.76 once the rate moves to 13,000). These guard
 * tests confirm every such figure now reads from the Sale's own
 * contract-currency ledger and converts exactly once.
 */
describe('qurilmalar list: no double-conversion drift for USD sales', () => {
  const list = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')

  it('Sotuv narxi column uses formatDisplayMoneyFromContract + contractSoldPrice/contractCurrency, not the legacy soldPrice', () => {
    expect(list).toContain(
      'formatDisplayMoneyFromContract(d.saleInfo.contractSoldPrice, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)',
    )
  })

  it('Farq (profit) column prefers contractProfit over the legacy UZS profit field', () => {
    expect(list).toContain('d.saleInfo.contractProfit != null')
    expect(list).toContain(
      'formatDisplayMoneyFromContract(d.saleInfo.contractProfit, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)',
    )
  })
})

describe('device detail page: no double-conversion drift for USD sales', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('defines dfmtSale() converting from the sale\'s own contractCurrency, not a legacy UZS field', () => {
    expect(page).toContain('const dfmtSale = (amount: number) =>')
    expect(page).toContain('formatDisplayMoneyFromContract(amount, latestSale.contractCurrency, currency.currency, currency.usdUzsRate)')
  })

  it('Sotuv narxi / To\'langan / Qolgan all use dfmtSale() + a contract* field', () => {
    expect(page).toContain('{dfmtSale(latestSale.contractSalePrice)}')
    expect(page).toContain('{dfmtSale(latestSale.contractAmountPaid)}')
    expect(page).toContain('{dfmtSale(latestSale.contractRemainingAmount)}')
  })

  it('does not show a secondary "Shartnoma: $X" reference line in shop-facing UI', () => {
    expect(page).not.toContain('latestSale.contractCurrency !== currency.currency && (')
    expect(page).not.toContain('Shartnoma: {formatContractMoney(latestSale.contractSalePrice, latestSale.contractCurrency)}')
  })

  it('owner-only profit uses computeSaleContractMargin (purchase-currency aware) via saleContractProfit, falling back to the legacy computation only when null', () => {
    expect(page).toContain('const saleProfit = canSeeOwnerFinancials && latestSale && device.purchasePrice != null')
    expect(page).toContain('computeSaleContractMargin(')
    expect(page).toContain('saleContractProfit != null')
  })

  it('the "pay remaining" prefill converts via the contract-currency remaining, not a blind UZS->USD conversion', () => {
    expect(page).toContain('convertPaymentToContractCurrency(')
    expect(page).toContain('latestSale.contractRemainingAmount,')
    expect(page).toContain('if (latestSale.contractCurrency !== currency.currency && !currency.usdUzsRate)')
  })
})

describe('shop-lists.ts buildDeviceSaleInfo: contract-currency fields for both sale types', () => {
  const lists = read('src/lib/server/shop-lists.ts')

  it('computes contractSoldPrice/contractProfit via computeSaleContractMargin (purchase-currency aware) for both cash sale and nasiya', () => {
    expect(lists).toContain('const contractSoldPrice = Number(latestNasiya.contractTotalAmount)')
    expect(lists).toContain('const contractSoldPrice = Number(latestSale!.contractSalePrice)')
    expect(lists.match(/computeSaleContractMargin\(contractSoldPrice, contractCurrency, contractExchangeRateAtCreation, purchase\)/g)?.length).toBe(2)
  })

  it('never touches the legacy soldPrice/profit computation (kept byte-identical for existing tests)', () => {
    expect(lists).toContain('profit: returned ? null : soldPrice - purchasePrice')
  })
})

describe('Telegram: deviceSoldMessage / salePaymentMessage use the sale\'s own contract currency', () => {
  const templates = read('src/lib/telegram-templates.ts')

  it('deviceSoldMessage formats salePrice/paidAmount/remaining via formatContractMoneyWithDisplay + contractCurrency', () => {
    expect(templates).toContain('function contractMoney(')
    expect(templates).toContain('formatContractMoneyWithDisplay(')
    expect(templates).toContain('contractMoney(amount, data.contractCurrency, data.currency)')
  })

  it('salePaymentMessage renders payment input in the shop display currency only', () => {
    expect(templates).toContain('formatUserFacingMoney({')
    expect(templates).toContain('amountCurrency: data.paymentInput.currency')
    expect(templates).not.toContain('data.paymentInput.currency !== data.contractCurrency')
  })

  it('olibSotdimCreatedMessage formats independent purchase and sale currencies without FX drift', () => {
    expect(templates).toContain('const purchaseMoney = (amount: number) => contractMoney(amount, data.purchaseCurrency ?? data.contractCurrency, data.currency)')
    expect(templates).toContain('const saleMoney = (amount: number) => contractMoney(amount, data.saleCurrency ?? data.contractCurrency, data.currency)')
  })
})

describe('route wiring: Telegram calls pass native contract-currency amounts, not legacy UZS reconversions', () => {
  it('sell route passes contractSalePrice/contractPaid/contractRemaining + contractCurrency to deviceSoldMessage', () => {
    const route = read('src/app/api/devices/[id]/sell/route.ts')
    expect(route).toContain('salePrice: contractSalePrice,')
    expect(route).toContain('paidAmount: contractPaid,')
    expect(route).toContain('remaining: contractRemaining,')
    expect(route).toContain('contractCurrency,')
  })

  it('sale payment route passes the helper’s applied native amount and remaining to salePaymentMessage', () => {
    const route = read('src/app/api/sales/[id]/payment/route.ts')
    expect(route).toContain('paidAmount: contractPayment.appliedAmountInContractCurrency,')
    expect(route).toContain('remaining: contractPayment.newContractRemainingAmount,')
    expect(route).toContain('contractCurrency: sale.contractCurrency,')
  })

  it('olib-sotdim route passes native purchase/sale values and both currencies to olibSotdimCreatedMessage', () => {
    const route = read('src/app/api/olib-sotdim/route.ts')
    expect(route).toContain('purchasePrice: d.purchasePrice, salePrice: d.salePrice!, profit: saleProfit!,')
    expect(route).toContain('purchaseCurrency: purchaseInput.inputCurrency,')
    expect(route).toContain('saleCurrency: saleInput!.inputCurrency,')
  })
})
