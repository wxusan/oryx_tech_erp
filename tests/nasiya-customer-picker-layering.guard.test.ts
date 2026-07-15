import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/app/(shop)/shop/nasiyalar/new/page.tsx'),
  'utf8',
)

describe('Nasiya customer picker layering', () => {
  it('does not clip the existing-customer results or the new-customer action', () => {
    const customerCardStart = source.indexOf("Mijoz ma&apos;lumotlari")
    const customerCard = source.slice(customerCardStart - 300, customerCardStart + 2_500)

    expect(customerCard).toContain('relative z-10 rounded border border-zinc-200')
    expect(customerCard).not.toContain('overflow-hidden')
    expect(customerCard).toContain('<CustomerCombobox')
  })
})
