import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'
const DETAIL = 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx'

describe('device selection is crash-safe', () => {
  for (const file of [SOTUV, NASIYA]) {
    const src = read(file)

    it(`${file}: device rows are type="button" and select (no navigate/submit)`, () => {
      expect(src).toContain('onClick={() => selectDevice(d)}')
      // The row button must not be a submit button or navigate away.
      const rowBlock = src.slice(src.indexOf('onClick={() => selectDevice(d)}') - 120, src.indexOf('onClick={() => selectDevice(d)}') + 40)
      expect(rowBlock).toContain('type="button"')
      expect(rowBlock).not.toContain('type="submit"')
    })

    it(`${file}: selecting a device never routes away`, () => {
      // selectDevice only touches component state.
      const fn = src.slice(src.indexOf('function selectDevice'), src.indexOf('function selectDevice') + 180)
      expect(fn).not.toContain('router')
      expect(fn).not.toContain('push(')
    })

    it(`${file}: the price prefill goes through the (string-safe) convert helper`, () => {
      expect(src).toContain('convertUzsToUsd(d.purchasePrice, currency.usdUzsRate)')
    })
  }
})

describe('device edit modal opens via the string-safe convert helper', () => {
  const src = read(DETAIL)
  it('openEdit converts the stored price for display without asserting a raw number', () => {
    expect(src).toContain('convertUzsToUsd(device.purchasePrice, currency.usdUzsRate).toFixed(2)')
  })
  it('save posts inputCurrency and refreshes the device on success', () => {
    expect(src).toContain('inputCurrency: currency.currency')
    expect(src).toContain('await fetchDevice()')
  })
})
