import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('sold device profit computation (src/lib/server/shop-lists.ts)', () => {
  const lists = read('src/lib/server/shop-lists.ts')

  it('cash sale profit = salePrice - purchasePrice', () => {
    expect(lists).toContain('soldPrice - purchasePrice')
  })

  it('nasiya profit uses totalAmount (device price), never folds in interest', () => {
    expect(lists).toContain('totalAmount = original device price BEFORE interest')
    expect(lists).toContain('const soldPrice = Number(latestNasiya.totalAmount)')
    expect(lists).toContain('interestAmount: Number(latestNasiya.interestAmount)')
  })

  it('returned devices get profit: null instead of a misleading number', () => {
    expect(lists).toContain('profit: returned ? null : soldPrice - purchasePrice')
  })
})

describe('qurilmalar list: sold tab, columns, and IMEI privacy', () => {
  const client = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')

  it('has exactly the required 5 tabs, no Band qilingan tab', () => {
    const tabsBlock = client.slice(client.indexOf('filterTabs'), client.indexOf('filterTabs') + 400)
    for (const tab of ["'Barchasi'", "'Omborda'", "'Sotilgan'", "'Nasiyada'", "'Qaytarilgan'"]) {
      expect(tabsBlock).toContain(tab)
    }
    // RESERVED still has a status label (for legacy data shown on a device's own
    // page) but must never be offered as a filter tab.
    expect(tabsBlock).not.toContain('Band qilingan')
  })

  it('shows sold price, profit, and customer columns', () => {
    expect(client).toContain("'Sotuv narxi'")
    expect(client).toContain("'Farq'")
    expect(client).toContain("'Mijoz'")
  })

  it('shows "Qaytarilgan" instead of a profit figure for returned devices', () => {
    expect(client).toContain('Qaytarilgan')
    expect(client).toContain('d.saleInfo.returned')
  })

  it('still uses displayImei so imported placeholder IMEIs stay hidden', () => {
    expect(client).toContain('displayImei(d.imei)')
  })
})

describe('device detail page shows purchase/sold/profit for cash and nasiya sales', () => {
  const detail = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('cash sale shows Farq / Foyda derived from purchasePrice', () => {
    expect(detail).toContain('latestSale.salePrice - device.purchasePrice')
    expect(detail).toContain('Farq / Foyda')
  })

  it('nasiya sale shows sotilish narxi, interest (when present), and sotuv farqi separately', () => {
    // Item 15 fix: profit is computed via computeSaleContractMargin from the
    // nasiya's own contract-currency total, not a legacy-UZS subtraction —
    // see the guard tests in tests/sold-device-detail-rate-crash-fix.test.ts
    // and the nasiya-currency-specific assertions below for the full fix.
    expect(detail).toContain('nasiyaContractProfit')
    expect(detail).toContain('computeSaleContractMargin(')
    expect(detail).toContain('latestNasiya.contractTotalAmount')
    expect(detail).toContain('Foiz daromadi')
    expect(detail).toContain('Sotuv farqi')
  })

  it('returned devices show a dedicated return section instead of profit', () => {
    expect(detail).toContain("device.status === 'RETURNED' && latestReturn")
    expect(detail).toContain('Qaytarish ma')
  })
})
