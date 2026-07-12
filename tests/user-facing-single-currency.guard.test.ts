import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('shop-facing UI uses one selected display currency', () => {
  it('dashboard and hisobot do not use the mixed base-money formatter', () => {
    for (const rel of ['src/app/(shop)/shop/dashboard/dashboard-client.tsx', 'src/app/(shop)/shop/hisobot/hisobot-client.tsx']) {
      const source = read(rel)
      expect(source).not.toContain('formatMoneyWithBase')
      expect(source).toContain('formatMoneyByCurrency')
    }
  })

  it('normal shop UI pages do not expose internal UZS storage hints', () => {
    for (const rel of [
      'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
      'src/app/(shop)/shop/qurilmalar/new/page.tsx',
      'src/app/(shop)/shop/olib-sotdim/new/page.tsx',
    ]) {
      expect(read(rel)).not.toContain('Saqlanadi:')
    }
  })

  it('payment history helpers no longer render paid-to-applied arrow/rate text', () => {
    expect(read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')).not.toContain('→ ${appliedText}')
    expect(read('src/lib/nasiya-contract.ts')).not.toContain('→ ${appliedText}')
    expect(read('src/lib/nasiya-contract.ts')).toContain('formatUserFacingMoney')
  })
})
