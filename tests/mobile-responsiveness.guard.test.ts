import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: practical mobile fixes across the shop
 * pages listed in docs/audits/full-production-audit.md's deferred UI/UX
 * section — not a redesign. Two concrete patterns were fixed:
 *
 * 1. Multi-button page headers (`flex items-center justify-between` with
 *    2-3 action buttons) used to have no wrap behavior, risking overflow on
 *    a ~375px viewport. Fixed to stack vertically below `sm:` and wrap the
 *    button group.
 * 2. Two-column data-entry forms (`grid grid-cols-2`, no responsive prefix)
 *    used to stay 2 columns even on mobile, cramming labeled money/date
 *    inputs into ~150px each. Fixed to stack to a single column below `sm:`.
 *
 * This guard test asserts the fixed files no longer contain the
 * unprefixed, non-responsive versions of these patterns.
 */
describe('page headers with multiple action buttons wrap/stack on mobile instead of overflowing', () => {
  const headerFiles = [
    'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
    'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx',
    'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx',
    'src/app/(shop)/shop/mijozlar/customers-client.tsx',
  ]

  it.each(headerFiles)('%s: header stacks on mobile and wraps its action buttons', (file) => {
    const source = read(file)
    expect(source).toMatch(/flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between/)
  })
})

describe('two-column data-entry forms stack to a single column on mobile', () => {
  const formFiles = [
    'src/app/(shop)/shop/olib-sotdim/new/page.tsx',
    'src/app/(shop)/shop/sotuv/new/page.tsx',
    'src/app/(shop)/shop/nasiyalar/new/page.tsx',
  ]

  it.each(formFiles)('%s: no unprefixed grid-cols-2 remains (all gated behind sm:)', (file) => {
    const source = read(file)
    expect(source).not.toContain('grid grid-cols-2 gap-4')
    expect(source).not.toMatch(/className="col-span-2/)
    expect(source).toMatch(/grid-cols-1 gap-4 sm:grid-cols-2/)
  })
})

describe('the device detail info-row card stacks label above value on mobile instead of squeezing both into a fixed-width column', () => {
  it('qurilmalar/[id] info rows use flex-col on mobile, flex-row from sm: up', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    expect(source).toMatch(/flex flex-col gap-0\.5 sm:flex-row sm:gap-4/)
  })
})
