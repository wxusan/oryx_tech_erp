import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 5 — price UI: the device's own purchase price ("kelish narxi") must
 * show as a read-only reference, never editable and never silently copied
 * into the selling-price input as a starting value. The selling-price field
 * is renamed from "Jami narxi" to "Sotilish narxi" (nasiya) / already named
 * "Sotuv narxi" (cash sale), starts empty, and is visually bold.
 */
describe('nasiya creation: selling price starts empty, purchase price shown read-only', () => {
  const source = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')

  it('no longer labels the selling-price field "Jami narx"', () => {
    expect(source).not.toContain('Jami narx (')
  })

  it('labels it "Sotilish narxi" instead', () => {
    expect(source).toContain('Sotilish narxi (')
  })

  it('totalPrice no longer defaults to the device purchase price', () => {
    expect(source).not.toMatch(/totalPriceInput\s*\?\?\s*\(selectedDevice/)
    expect(source).toContain("const totalPrice = totalPriceInput ?? ''")
  })

  it('shows the device purchase price as a read-only reference row', () => {
    expect(source).toContain('Kelish narxi (qurilma tannarxi)')
  })

  it('the selling-price input is visually bold', () => {
    expect(source).toMatch(/value=\{totalPrice\}[\s\S]{0,200}font-bold/)
  })
})

describe('nasiya detail page: summary card also uses "Sotilish narxi"', () => {
  it('no longer labels the read-only summary card "Jami narx"', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(source).not.toContain("label: 'Jami narx'")
    expect(source).toContain("label: 'Sotilish narxi'")
  })
})

describe('cash sale creation: selling price starts empty, purchase price shown read-only', () => {
  const source = read('src/app/(shop)/shop/sotuv/new/page.tsx')

  it('salePrice no longer defaults to the device purchase price', () => {
    expect(source).not.toMatch(/salePriceInput\s*\?\?\s*\(selectedDevice/)
    expect(source).toContain("const salePrice = salePriceInput ?? ''")
  })

  it('shows the device purchase price labeled "Kelish narxi" in the summary card', () => {
    expect(source).toContain('Kelish narxi')
  })

  it('the selling-price input is visually bold', () => {
    expect(source).toMatch(/value=\{salePrice\}[\s\S]{0,200}font-bold/)
  })

  it('keeps the existing "Sotuv narxi" label (already correctly named before this pass)', () => {
    expect(source).toContain('Sotuv narxi (')
  })
})
