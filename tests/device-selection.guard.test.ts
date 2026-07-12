import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deviceMatchesSearch } from '@/lib/device-display'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'
const PICKER = 'src/components/shop/in-stock-device-picker.tsx'

// ── Behavioural: the shared search predicate the pickers use ──────────────────
describe('deviceMatchesSearch (device picker search)', () => {
  const d = { model: 'iPhone 13 Pro', color: 'Graphite', imei: '359123456789012' }

  it('matches by model, color and IMEI (case-insensitive)', () => {
    expect(deviceMatchesSearch(d, 'iphone')).toBe(true)
    expect(deviceMatchesSearch(d, 'graphite')).toBe(true)
    expect(deviceMatchesSearch(d, '35912')).toBe(true)
  })

  it('empty query matches everything', () => {
    expect(deviceMatchesSearch(d, '')).toBe(true)
  })

  it('non-matching query is filtered out', () => {
    expect(deviceMatchesSearch(d, 'samsung')).toBe(false)
  })

  it('tolerates a missing color', () => {
    expect(deviceMatchesSearch({ model: 'Redmi', color: null, imei: '111' }, 'redmi')).toBe(true)
    expect(deviceMatchesSearch({ model: 'Redmi', color: null, imei: '111' }, 'blue')).toBe(false)
  })
})

// ── Source guards: selection wiring on both picker consumers ─────────────────
for (const [name, file] of [
  ['sotuv/new', SOTUV],
  ['nasiyalar/new', NASIYA],
] as const) {
  describe(`device picker wiring — ${name}`, () => {
    const src = read(file)

    it('uses the shared bounded server-search picker', () => {
      expect(src).toContain('<InStockDevicePicker')
      expect(src).toContain('onSelect={selectDevice}')
    })

    it('keeps normal selection separate from deep-link auto-advance', () => {
      expect(src).toContain('onSelect={selectDevice}')
      expect(src).toContain('onDeepLinkSelect={(device) => {')
      expect(src).toContain('selectDevice(device)')
    })

    it('selectDevice sets the device but does NOT change the step', () => {
      const fn = src.slice(src.indexOf('function selectDevice'), src.indexOf('function selectDevice') + 160)
      expect(fn).toContain('setSelectedDevice(d)')
      expect(fn).not.toContain('setStep')
    })

    it('the "Keyingi bosqich" button is disabled until a device is selected', () => {
      expect(src).toContain('disabled={!selectedDevice}')
      expect(src).toContain('Keyingi bosqich')
    })

    it('currency only formats prices and is not a device-query dependency', () => {
      expect(src).toContain('formatPrice={(price) => fmt(price, currency)}')
      expect(src).not.toContain("fetch('/api/devices")
    })
  })
}

describe('bounded server-side device picker', () => {
  const src = read(PICKER)

  it('requests only IN_STOCK rows in 25-row paginated pages', () => {
    expect(src).toContain("status: 'IN_STOCK'")
    expect(src).toContain("view: 'picker'")
    expect(src).toContain("paginated: '1'")
    expect(src).toContain('const PAGE_SIZE = 25')
    expect(src).toContain("skip: String(devices.length)")
  })

  it('debounces search and cancels stale first-page requests', () => {
    expect(src).toContain('const SEARCH_DEBOUNCE_MS = 250')
    expect(src).toContain('new AbortController()')
    expect(src).toContain("params.set('search', debouncedQuery)")
    expect(src).toContain('return () => controller.abort()')
  })

  it('renders accessible selectable rows, skeletons, errors and load-more', () => {
    expect(src).toContain('onClick={() => onSelect(device)}')
    expect(src).toContain('aria-pressed={isSelected}')
    expect(src).toContain('aria-busy={loading || loadingMore}')
    expect(src).toContain('role="alert"')
    expect(src).toContain('Yana ko‘rsatish')
  })

  it('resolves deep links through the minimal picker projection', () => {
    expect(src).toContain('?view=picker')
    expect(src).toContain("json.data.status !== 'IN_STOCK'")
  })

  it('shows structured storage, exact condition label, and both IMEIs', () => {
    expect(src).toContain('device.storageDisplay || device.storage')
    expect(src).toContain('device.conditionLabel')
    expect(src).toContain('device.secondaryImei')
  })
})

describe('picker API projection', () => {
  for (const route of ['src/app/api/devices/route.ts', 'src/app/api/devices/[id]/route.ts']) {
    const src = read(route)
    it(`${route} returns the canonical second-IMEI, storage, and condition fields`, () => {
      expect(src).toContain('storageDisplay: formatDeviceStorage(')
      expect(src).toContain("entry.slot === 'SECONDARY'")
      expect(src).toContain('conditionLabel: deviceConditionLabel(')
    })
  }
})

describe('submit payloads still carry the selected device id', () => {
  it('sale + nasiya submit include the selected device id', () => {
    expect(read(SOTUV)).toContain('deviceId: selectedDevice.id')
    expect(read(NASIYA)).toContain('deviceId: selectedDevice.id')
  })
})
