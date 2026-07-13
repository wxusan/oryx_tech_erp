import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'
const DETAIL = 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx'
const PICKER = 'src/components/shop/in-stock-device-picker.tsx'

describe('device selection is crash-safe', () => {
  for (const file of [SOTUV, NASIYA]) {
    const src = read(file)

    it(`${file}: device selection is delegated without navigation`, () => {
      expect(src).toContain('onSelect={selectDevice}')
      expect(src).toContain('<InStockDevicePicker')
    })

    it(`${file}: selecting a device never routes away`, () => {
      // selectDevice only touches component state.
      const fn = src.slice(src.indexOf('function selectDevice'), src.indexOf('function selectDevice') + 180)
      expect(fn).not.toContain('router')
      expect(fn).not.toContain('push(')
    })

  }

  it('the shared picker rows are non-submit buttons and never navigate', () => {
    const src = read(PICKER)
    const rowBlock = src.slice(src.indexOf('onClick={() => onSelect(device)}') - 160, src.indexOf('onClick={() => onSelect(device)}') + 80)
    expect(rowBlock).toContain('type="button"')
    expect(rowBlock).not.toContain('type="submit"')
    expect(rowBlock).not.toContain('router')
  })

  // Purchase cost is an owner-only reference. It must never be present in a
  // worker's data contract/cache, while an owner can still read it safely in
  // the active display currency.
  it(`${NASIYA}: the read-only purchase-price reference is owner-only and uses the shared money formatter`, () => {
    const src = read(NASIYA)
    expect(src).toContain('canSeeOwnerFinancials && selectedDevice?.purchasePrice != null')
    expect(src).toContain('formatMoneyByCurrency(selectedDevice.purchasePrice, currency.currency, currency.usdUzsRate)')
  })

  // Sotuv's read-only purchase-price reference (in the selected-device
  // summary card) uses the shared `fmt`/formatMoneyByCurrency helper instead
  // — also string-safe (formatMoneyByCurrency Number()-coerces internally),
  // just via the already-audited shared formatter rather than a bespoke
  // local prefill helper (which no longer exists in this file — item 5).
  it(`${SOTUV}: the owner-only read-only purchase-price reference uses the shared money formatter`, () => {
    const src = read(SOTUV)
    expect(src).toContain('canSeeOwnerFinancials && selectedDevice.purchasePrice != null')
    expect(src).toContain('fmt(selectedDevice.purchasePrice, currency)')
    expect(src).not.toContain('salePriceInput ?? (selectedDevice')
  })
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
