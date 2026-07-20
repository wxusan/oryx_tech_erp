import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('initial payment historical metadata', () => {
  it.each([
    ['sale', 'src/app/api/devices/[id]/sell/route.ts'],
    ['nasiya', 'src/app/api/devices/[id]/nasiya/route.ts'],
    ['olib-sotdim', 'src/app/api/olib-sotdim/route.ts'],
  ])('%s creation freezes original payment input context', (_name, path) => {
    const text = source(path) + (_name === 'nasiya' ? source('src/lib/server/nasiya-contract-core.ts') : '')
    expect(text).toContain('paymentInputAmount:')
    expect(text).toContain('paymentInputCurrency:')
    expect(text).toContain('paymentExchangeRate:')
    expect(text).toContain('appliedAmountInContractCurrency:')
  })
})
