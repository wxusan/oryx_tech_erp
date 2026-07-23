import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('customer return history currency evidence', () => {
  const server = readFileSync('src/lib/server/customer-profile.ts', 'utf8')
  const history = readFileSync(
    'src/app/(shop)/shop/mijozlar/[id]/customer-profile-history.tsx',
    'utf8',
  )

  it('keeps refund-input currency separate from contract disposition currency', () => {
    expect(server).toContain('r."contractCurrency" AS contract_currency')
    expect(server).toContain('contractCurrency: row.contract_currency ?? null')
    expect(history).toContain('item.contractCurrency ?? item.currency')
    expect(history).not.toContain(
      'formatMoneyByCurrency(item.retainedAmount, item.currency, null)',
    )
    expect(history).not.toContain(
      'formatMoneyByCurrency(item.cancelledDebt, item.currency, null)',
    )
  })
})
