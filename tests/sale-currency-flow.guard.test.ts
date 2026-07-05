import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'
const YANGI = 'src/app/(shop)/shop/yangi-operatsiya/page.tsx'

// The price shown in the sale/nasiya form is DERIVED from the selected device +
// current currency (never a stale prefilled string), so a USD-labeled input can
// never get stuck showing the raw UZS amount after the currency resolves.
const priceState: Record<string, { input: string; derived: string; setter: string }> = {
  [SOTUV]: {
    input: 'salePriceInput',
    derived: "const salePrice = salePriceInput ?? (selectedDevice ? priceFor(selectedDevice) : '')",
    setter: 'onChange={setSalePriceInput}',
  },
  [NASIYA]: {
    input: 'totalPriceInput',
    derived: "const totalPrice = totalPriceInput ?? (selectedDevice ? priceFor(selectedDevice) : '')",
    setter: 'onChange={setTotalPriceInput}',
  },
}

for (const [file, { input, derived, setter }] of Object.entries(priceState)) {
  describe(`USD/UZS price display — ${file}`, () => {
    const src = read(file)

    it('derives the displayed price from the device + currency (no stale prefill)', () => {
      expect(src).toContain(derived)
      // priceFor converts UZS→USD when the shop is in USD mode.
      expect(src).toContain('convertUzsToUsd(d.purchasePrice, currency.usdUzsRate).toFixed(2)')
      // Selecting a device resets the field to the live suggestion (null), never
      // to a raw UZS string.
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

describe('no auto-selection of a device', () => {
  for (const file of [SOTUV, NASIYA]) {
    it(`${file}: only preselects when ?deviceId is present and valid`, () => {
      const src = read(file)
      // The only auto-advance path is guarded by a deviceId lookup.
      expect(src).toContain("const deviceId = new URLSearchParams(window.location.search).get('deviceId')")
      expect(src).toContain('if (deviceId) {')
      expect(src).toContain('setStep(2)')
      // Never pick "the first device" implicitly.
      expect(src).not.toContain('nextDevices[0]')
      expect(src).not.toContain('devices[0]')
    })
  }
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
