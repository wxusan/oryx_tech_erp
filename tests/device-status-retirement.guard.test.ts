import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('retired device reservation status', () => {
  it('does not expose RESERVED in the current schema or application status lists', () => {
    expect(read('prisma/schema.prisma')).not.toContain('  RESERVED')

    for (const file of [
      'src/types/index.ts',
      'src/lib/labels.ts',
      'src/lib/device-display.ts',
      'src/lib/log-format.ts',
      'src/lib/server/shop-lists.ts',
      'src/app/api/devices/route.ts',
      'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
      'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
    ]) {
      expect(read(file), file).not.toContain('RESERVED')
    }
  })

  it('keeps only IN_STOCK devices in the inventory-cost calculation', () => {
    const stats = read('src/lib/server/shop-stats.ts')
    expect(stats).toContain("status: 'IN_STOCK'")
    expect(stats).not.toContain('RESERVED')
  })

  it('uses short dashboard descriptions for profit and inventory', () => {
    const dashboard = read('src/app/(shop)/shop/dashboard/dashboard-client.tsx')
    expect(dashboard).toContain('Faqat shu oy tushgan pul ulushi')
    expect(dashboard).toContain('Omborda turgan qurilmalar tannarxi')
    expect(dashboard).not.toContain('band qilingan')
  })
})
