import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('unavailable and quarantined money presentation', () => {
  const list = readFileSync('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx', 'utf8')
  const detail = readFileSync('src/app/(shop)/shop/nasiyalar/[id]/page.tsx', 'utf8')
  const report = readFileSync('src/app/(shop)/shop/hisobot/hisobot-client.tsx', 'utf8')
  const dashboard = readFileSync('src/app/(shop)/shop/dashboard/dashboard-client.tsx', 'utf8')

  it('does not present quarantined ledger placeholders as real balances or progress', () => {
    expect(list).toContain("ledgerQuarantined ? 'Summa tekshiruvda'")
    expect(list).toContain('Moliyaviy summalar tekshiruv tugaguncha ko‘rsatilmaydi.')
    expect(detail).toContain("const ledgerFmt = (amount: MoneyDto) => ledgerQuarantined ? 'Tekshiruvda'")
    expect(detail).toContain('!isReturned && !ledgerQuarantined')
    expect(detail).toContain("value: ledgerFmt(currentCustomerDebt)")
  })

  it('derives overdue presence from native partitions/counts instead of an incomplete conversion', () => {
    expect(report).toContain('stats.overdueCount > 0 || stats.overdueMoneyUzs > 0 || stats.overdueMoneyUsd > 0')
    expect(report).toContain("hasOverdueDebt ? \"Kechikkan to'lov bor\"")
    expect(report).not.toContain("overdue > 0 ? \"Kechikkan to'lov bor\"")
  })

  it('does not call native currency partitions a current-rate conversion when no rate exists', () => {
    const truthfulCaption = "currency.usdUzsRate ? 'joriy kurs bo‘yicha' : 'asl valyutalarda (kurs mavjud emas)'"
    expect(report).toContain(truthfulCaption)
    expect(dashboard).toContain(truthfulCaption)
  })
})
