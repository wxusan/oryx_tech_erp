import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const page = readFileSync(
  resolve(process.cwd(), 'src/app/(shop)/shop/yangi-operatsiya/page.tsx'),
  'utf8',
)

describe('new operation card layout', () => {
  it('uses one fixed card frame and aligned icon, title, and description slots', () => {
    expect(page).toContain('className="group block h-52"')
    expect(page).toContain('grid-rows-[3rem_2.5rem_1fr]')
    expect(page).toContain('min-h-10')
  })

  it('keeps contextual operations out of the quick-action grid', () => {
    for (const title of [
      "Qarz sotuv to'lovi",
      'Nasiya muddatini uzaytirish',
      'Sotuvni qaytarish',
      'Nasiyani bekor qilish',
    ]) {
      expect(page).not.toContain(title)
    }
  })

  it('uses one payment card for both Nasiya and Qarz payment roles', () => {
    expect(page).toContain("permissions: ['NASIYA_PAYMENT_RECEIVE', 'SALE_PAYMENT_RECEIVE']")
    expect(page).toContain('operation.permissions.some((permission) => can(permission))')
  })
})
