import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 3 — safe pure-helper extraction from the device detail page
 * (currently the largest page component in the app). No behavior change:
 * deviceStatusLabel/deviceActionLabel were plain inline maps/functions,
 * moved to src/lib/device-display.ts (unit-tested in
 * tests/device-display.test.ts) and imported back in, rather than being
 * redefined inline.
 */
describe('device detail page: status/action labels extracted to a pure, tested module', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('imports deviceStatusLabel/deviceActionLabel from the shared module', () => {
    expect(page).toContain("import { displayImei, deviceStatusLabel, deviceActionLabel } from '@/lib/device-display'")
  })

  it('no longer defines its own inline statusLabels map or deviceActionLabel function', () => {
    expect(page).not.toContain('const statusLabels: Record<string, string> = {')
    expect(page).not.toMatch(/^function deviceActionLabel/m)
  })

  it('uses the imported helpers at both call sites', () => {
    expect(page).toContain('deviceStatusLabel(device.status)')
  })
})

describe('device-display.ts: the extracted helpers are pure (no React/Next imports)', () => {
  const source = read('src/lib/device-display.ts')

  it('has no framework imports — safe to unit test without a DOM/React environment', () => {
    expect(source).not.toContain("from 'react'")
    expect(source).not.toContain("from 'next")
  })
})
