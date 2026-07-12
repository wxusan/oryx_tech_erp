import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const api = readFileSync(resolve(process.cwd(), 'src/app/api/olib-sotdim/route.ts'), 'utf8')
const page = readFileSync(resolve(process.cwd(), 'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx'), 'utf8')

describe('Olib-sotdim bounded native-currency list', () => {
  it('returns a real pagination envelope', () => {
    expect(api).toContain('prisma.supplierPayable.count({ where })')
    expect(api).toContain('total, skip, take')
    expect(api).toContain('skip,')
  })

  it('reads contract-native amounts instead of current-rate legacy values', () => {
    expect(api).toContain('contractAmount: true')
    expect(api).toContain('contractSalePrice: true')
    expect(api).toContain('purchaseInputAmount: true')
    expect(page).toContain('row.sale.contractCurrency')
    expect(page).toContain('row.device.purchaseCurrency')
  })
})
