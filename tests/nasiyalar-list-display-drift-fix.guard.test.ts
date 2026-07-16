import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiyalar list: money text reads from the contract-currency ledger, not the legacy UZS snapshot', () => {
  const listServer = read('src/lib/server/shop-lists.ts')
  const client = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')

  it('getShopNasiyalarListFresh selects native contract fields and returns a reconciled MoneyDto ledger', () => {
    expect(listServer).toContain('contractInterestAmount: true')
    expect(listServer).toContain('contractFinalAmount: true')
    expect(listServer).toContain('contractRemainingAmount: true')
    expect(listServer).toContain('const ledger = reconcileNasiyaLedger({')
    expect(listServer).toContain('contractInterest: createMoneyDto(nasiya.contractCurrency, nasiya.contractInterestAmount.toString())')
    expect(listServer).toContain('ledger,')
  })

  it('the client formats each exact MoneyDto and only adds an approximate current-rate display', () => {
    expect(client).toContain('const mfmt = (amount: MoneyDto) => {')
    expect(client).toContain('const primary = formatMoneyDto(amount)')
    expect(client).toContain('convertMoneyDto(amount, currency.currency, currency.fxQuote)')
  })

  it("To'langan/Nasiya jami/Foiz/qolgan all use the native ledger MoneyDto values", () => {
    expect(client).toContain('{mfmt(n.ledger.paid)}')
    expect(client).toContain('{mfmt(n.ledger.financed)}')
    expect(client).toContain('{mfmt(n.contractInterest)}')
    expect(client).toContain('{mfmt(n.ledger.remaining)}')
    expect(client).not.toContain('function fmt(')
  })
})
