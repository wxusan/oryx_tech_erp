import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiyalar list: money text reads from the contract-currency ledger, not the legacy UZS snapshot', () => {
  const listServer = read('src/lib/server/shop-lists.ts')
  const client = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')

  it('getShopNasiyalarListFresh selects and returns contractCurrency/contractInterestAmount/contractFinalAmount/contractRemainingAmount', () => {
    expect(listServer).toContain('contractInterestAmount: true')
    expect(listServer).toContain('contractFinalAmount: true')
    expect(listServer).toContain('contractRemainingAmount: true')
    expect(listServer).toContain('contractInterestAmount: Number(nasiya.contractInterestAmount)')
    expect(listServer).toContain('contractFinalAmount: Number(nasiya.contractFinalAmount)')
    expect(listServer).toContain('contractRemainingAmount: Number(nasiya.contractRemainingAmount)')
  })

  it('the client defines dfmt() converting from each row\'s own contractCurrency via today\'s rate', () => {
    expect(client).toContain(
      'const dfmt = (amount: number) => formatDisplayMoneyFromContract(amount, n.contractCurrency, currency.currency, currency.usdUzsRate)',
    )
  })

  it("To'langan/Nasiya jami/Foiz/qolgan all use dfmt() + contract fields, not the legacy fmt()", () => {
    expect(client).toContain("To'langan: {dfmt(contractPaidAmount)}")
    expect(client).toContain('Nasiya jami: {dfmt(n.contractFinalAmount)}')
    expect(client).toContain('Foiz: {dfmt(n.contractInterestAmount)}')
    expect(client).toContain('{dfmt(n.contractRemainingAmount)}')
    expect(client).not.toContain('function fmt(')
  })
})
