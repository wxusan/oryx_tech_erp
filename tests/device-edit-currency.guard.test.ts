import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards for the device-edit purchase-price currency fix. UZS stays the stored
// base; USD is shown converted and converted back on the server.

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('device edit modal — purchase price follows shop currency', () => {
  const ui = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('prefills the input in USD (converted) when the shop is in USD mode', () => {
    // openEdit must convert the stored UZS value to USD for display, not show raw UZS.
    expect(ui).toContain("currency.currency === 'USD' && currency.usdUzsRate")
    expect(ui).toContain('convertUzsToUsd(device.purchasePrice, currency.usdUzsRate).toFixed(2)')
    // UZS mode keeps the raw stored value.
    expect(ui).toContain('String(device.purchasePrice)')
  })

  it('submits inputCurrency and blocks USD save when the rate is missing', () => {
    expect(ui).toContain('inputCurrency: currency.currency')
    expect(ui).toContain("currency.currency === 'USD' && !currency.usdUzsRate")
  })

  it('uses MoneyInput (no type="number") for the price', () => {
    expect(ui).toContain('<MoneyInput')
    // the price field is not a number input
    const priceBlock = ui.slice(ui.indexOf('Kelish narxi'), ui.indexOf('Kelish narxi') + 500)
    expect(priceBlock).not.toContain('type="number"')
  })
})

describe('device update API — converts USD to the UZS base server-side', () => {
  const route = read('src/app/api/devices/[id]/route.ts')

  it('requires inputCurrency whenever purchasePrice is supplied and rejects an orphan currency', () => {
    expect(route).toContain("inputCurrency: z.enum(['UZS', 'USD']).optional()")
    expect(route).toContain("data.purchasePrice === undefined || data.inputCurrency !== undefined")
    expect(route).toContain("data.inputCurrency === undefined || data.purchasePrice !== undefined")
  })

  it('converts the entered price with moneyInputToUzs and stores the UZS amount', () => {
    expect(route).toContain('moneyInputToUzs(updateData.purchasePrice, inputCurrency)')
    expect(route).toContain('updateData.purchasePrice = purchaseMeta.amountUzs')
    // Server-side conversion is the source of truth — client value is not trusted as UZS.
  })

  it('locks purchase and supplier-source facts once any receipt, payable, sale, or nasiya exists', () => {
    expect(route).toContain('isFinanciallyLinked && purchaseFactsChanged')
    expect(route).toContain('existing.evidenceVersion === 2')
    expect(route).toContain('existing.supplierPayables.length > 0')
    expect(route).toContain('existing.purchaseReceipt !== null')
    expect(route).toContain('supplierPayables: { none: {} }')
    expect(route).toContain('purchaseReceipt: { is: null }')
  })

  it('never upgrades a corrected legacy row to captured evidence without acquisition proof', () => {
    const patchBlock = route.slice(
      route.indexOf('export async function PATCH'),
      route.indexOf('export async function DELETE'),
    )
    expect(patchBlock).not.toContain('evidenceVersion: 2')
    expect(patchBlock).not.toContain("evidenceStatus: 'CAPTURED'")
  })
})
