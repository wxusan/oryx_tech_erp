import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'
const YANGI = 'src/app/(shop)/shop/yangi-operatsiya/page.tsx'

// Item 5: the selling-price field always STARTS EMPTY (never prefilled from
// the device's own purchase price, in any currency) — the shop must
// explicitly decide the selling price for every deal. Selecting a
// (different) device still resets the field to null/empty so a price meant
// for one device can never accidentally carry over to another.
const priceState: Record<string, { input: string; emptyDefault: string; setter: string }> = {
  [SOTUV]: {
    input: 'salePriceInput',
    emptyDefault: "const salePrice = salePriceInput ?? ''",
    setter: 'onChange={setSalePriceInput}',
  },
  [NASIYA]: {
    input: 'totalPriceInput',
    emptyDefault: "const totalPrice = totalPriceInput ?? ''",
    setter: 'onChange={setTotalPriceInput}',
  },
}

for (const [file, { input, emptyDefault, setter }] of Object.entries(priceState)) {
  describe(`selling price starts empty — ${file}`, () => {
    const src = read(file)

    it('never derives the selling price from the device\'s own purchase price', () => {
      expect(src).toContain(emptyDefault)
      expect(src).not.toMatch(/selectedDevice \? priceFor\(selectedDevice\)/)
      // Selecting a device resets the field to empty, never to a stale value
      // left over from a previously selected device.
      expect(src).toContain(`set${input.charAt(0).toUpperCase()}${input.slice(1)}(null)`)
    })

    it('wires the MoneyInput edit back to the input state', () => {
      expect(src).toContain(setter)
    })

    it('submits the display value together with inputCurrency (server converts to UZS)', () => {
      expect(src).toContain('inputCurrency: currency.currency')
    })
  })
}

describe('read-only purchase-price reference converts safely (string-safe Decimal handling)', () => {
  it(`${NASIYA}: priceFor still exists for the read-only "Kelish narxi" reference and uses the safe convert helper`, () => {
    expect(read(NASIYA)).toContain('convertUzsToUsd(d.purchasePrice, currency.usdUzsRate).toFixed(2)')
  })

  it(`${SOTUV}: the read-only purchase-price reference uses the shared money formatter (also string-safe)`, () => {
    expect(read(SOTUV)).toContain('fmt(selectedDevice.purchasePrice, currency)')
  })
})

describe('no auto-selection of a device', () => {
  for (const file of [SOTUV, NASIYA]) {
    it(`${file}: only preselects when ?deviceId is present and valid`, () => {
      const src = read(file)
      expect(src).toContain('onDeepLinkSelect={(device) => {')
      expect(src).toContain('setStep(2)')
      expect(src).not.toContain('devices[0]')
    })
  }

  it('the shared picker only resolves an explicit deviceId and never selects the first result', () => {
    const src = read('src/components/shop/in-stock-device-picker.tsx')
    expect(src).toContain("const deviceId = new URLSearchParams(window.location.search).get('deviceId')")
    expect(src).toContain('if (!deviceId) return')
    expect(src).not.toContain('devices[0]')
  })
})

describe('change device ("O\'zgartirish") returns to step 1 and keeps the choice', () => {
  for (const file of [SOTUV, NASIYA]) {
    it(`${file}: change button goes back to step 1 without wiping selection`, () => {
      const src = read(file)
      expect(src).toContain('onClick={() => setStep(1)}')
      // The change action must NOT clear the selection (kept highlighted so the
      // user can pick another or return).
      expect(src).not.toContain('setSelectedDevice(null)')
    })
  }
})

describe('Yangi operatsiya starts a fresh flow (no deviceId)', () => {
  const src = read(YANGI)
  it('links to the plain sale/nasiya routes without a deviceId', () => {
    expect(src).toContain("href: '/shop/sotuv/new'")
    expect(src).toContain("href: '/shop/nasiyalar/new'")
    expect(src).not.toContain('deviceId')
  })
})
