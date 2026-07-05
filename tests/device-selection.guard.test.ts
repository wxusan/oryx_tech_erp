import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deviceMatchesSearch } from '@/lib/device-display'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'

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

// ── Source guards: selection wiring on both pickers ──────────────────────────
for (const [name, file] of [
  ['sotuv/new', SOTUV],
  ['nasiyalar/new', NASIYA],
] as const) {
  describe(`device picker wiring — ${name}`, () => {
    const src = read(file)

    it('only fetches sellable IN_STOCK stock', () => {
      expect(src).toContain("fetch('/api/devices?status=IN_STOCK')")
    })

    it('rows are real buttons that select (not auto-advance) with visible selected state', () => {
      expect(src).toContain('type="button"')
      expect(src).toContain('onClick={() => selectDevice(d)}')
      expect(src).toContain('const isSelected = selectedDevice?.id === d.id')
      expect(src).toContain('aria-pressed={isSelected}')
      expect(src).toContain('Tanlandi')
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

    it('the loader does not depend on currency-bound values (no reload-on-currency)', () => {
      // The device-loading effect must end with an empty dependency array.
      expect(src).toMatch(/loadDevices\(\)\s*return \(\) => \{\s*ignore = true\s*\}\s*\}, \[\]\)/)
      expect(src).not.toContain('}, [handleSelectDevice])')
    })
  })
}

describe('submit payloads still carry the selected device id', () => {
  it('sale + nasiya submit include the selected device id', () => {
    expect(read(SOTUV)).toContain('deviceId: selectedDevice.id')
    expect(read(NASIYA)).toContain('deviceId: selectedDevice.id')
  })
})
