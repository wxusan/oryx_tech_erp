import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const detailPage = 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx'

describe('nasiya detail: no duplicate summary cards', () => {
  const source = read(detailPage)

  it('does not render a "Qolgan summa" card at all', () => {
    expect(source).not.toContain("label: 'Qolgan summa'")
  })

  it('keeps exactly one "current remaining debt" card: Qarz qoldig\'i', () => {
    expect(source).toContain("label: \"Qarz qoldig'i\"")
    const count = source.split("label: \"Qarz qoldig'i\"").length - 1
    expect(count).toBe(1)
  })

  it('renders the contract-ledger card set in order', () => {
    const order = ['Shartnomadagi qurilma narxi', "Boshlang'ich to'lov", "Bo'lib to'lash jami (boshlang'ichsiz)", "To'langan", "Qarz qoldig'i", "Oylik to'lov"]
    let cursor = 0
    for (const label of order) {
      const idx = source.indexOf(label, cursor)
      expect(idx).toBeGreaterThan(-1)
      cursor = idx + label.length
    }
  })
})

describe('nasiya detail: completed profile', () => {
  const source = read(detailPage)

  it('derives displayStatus from the API (server-computed), not a hardcoded Faol badge', () => {
    expect(source).toContain('nasiya.displayStatus ?? (nasiya.status as')
  })

  it('hides the "To\'lov qabul qilish" button once completed/cancelled', () => {
    expect(source).toContain("{canReceivePayment && !ledgerQuarantined && isOperationallyActive && !isCompleted && displayStatus !== 'CANCELLED' && (")
  })

  it('shows a clear completed banner text', () => {
    expect(source).toContain("Bu nasiya to'liq yopilgan.")
  })

  it('shows a Yakunlangan status badge in the header', () => {
    expect(source).toContain('COMPLETED: \'Yakunlangan\'')
  })

  it('retitles the payment score card as historical once completed, never as an active risk signal', () => {
    expect(source).toContain('"To\'lov tarixi bahosi"')
  })

  it('shows localized confidence labels instead of raw LOW/MEDIUM/HIGH codes', () => {
    expect(source).toContain("LOW: 'Past'")
    expect(source).toContain('historyConfidenceLabels[nasiya.paymentScore.factors.historyConfidence]')
    expect(source).not.toContain('Ishonch: {nasiya.paymentScore.factors.historyConfidence}')
  })
})
