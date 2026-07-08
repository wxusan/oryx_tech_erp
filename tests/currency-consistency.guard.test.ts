import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya-payment-score.ts never hardcodes UZS formatting', () => {
  const source = read('src/lib/nasiya-payment-score.ts')

  it('contains no literal "so\'m" string', () => {
    expect(source).not.toMatch(/so['‘]m/)
  })

  it('contains no manual toLocaleString money formatting', () => {
    expect(source).not.toContain('toLocaleString')
  })

  it('formats the overdue reason through the shared currency formatter', () => {
    expect(source).toContain("import { formatMoneyByCurrency, type CurrencyContext } from '@/lib/currency'")
    expect(source).toContain('formatMoneyByCurrency(currentOverdueAmount, currency.currency, currency.usdUzsRate)')
  })

  it('accepts an optional CurrencyContext defaulting to UZS (backward compatible signature)', () => {
    expect(source).toContain('currency: CurrencyContext = DEFAULT_CURRENCY')
  })
})

describe('server call sites pass the shop\'s real currency into the scorer', () => {
  it('shop-lists.ts (nasiyalar list) fetches and forwards shop currency', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toContain("import { getShopCurrencyContext } from '@/lib/server/currency'")
    expect(source).toContain('const currency = await getShopCurrencyContext(shopId)')
    const scoreCallIndex = source.indexOf('computeNasiyaPaymentScore(')
    expect(source.slice(scoreCallIndex, scoreCallIndex + 300)).toContain('currency,')
  })

  it('/api/nasiya/[id] (detail page score card) fetches and forwards shop currency', () => {
    const source = read('src/app/api/nasiya/[id]/route.ts')
    expect(source).toContain("import { getShopCurrencyContext } from '@/lib/server/currency'")
    expect(source).toContain('await getShopCurrencyContext(nasiya.shopId)')
  })
})

describe('qurilmalar device detail page: no dead-code UZS fallback', () => {
  it('fmt() always uses formatMoneyByCurrency, never a manual so\'m string', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    const fmtFn = source.slice(source.indexOf('function fmt('), source.indexOf('function fmt(') + 200)
    expect(fmtFn).toContain('formatMoneyByCurrency')
    expect(fmtFn).not.toMatch(/so['‘]m/)
  })
})

describe('sold devices list and olib-sotdim use the shared formatter, not manual UZS text', () => {
  const files = [
    'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
    'src/app/(shop)/shop/olib-sotdim/page.tsx',
    'src/app/(shop)/shop/olib-sotdim/new/page.tsx',
    'src/app/(shop)/shop/hisobot/page.tsx',
  ]

  for (const file of files) {
    it(`${file} imports formatMoneyByCurrency`, () => {
      const source = read(file)
      expect(source).toContain('formatMoneyByCurrency')
    })
  }
})

describe('nasiya payment modal: overpayment explanation and validation use the shared formatter', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('computes payAmountUzs regardless of display currency (source of truth for validation)', () => {
    expect(source).toContain('const payAmountUzs =')
    expect(source).toContain('convertUsdToUzs(Number(payAmount), currency.usdUzsRate)')
  })

  it('shows the overpayment explanation and total-remaining line via fmt() (shared formatter)', () => {
    expect(source).toContain('Ortiqcha {fmt(overpayExtraUzs)} keyingi oy')
    expect(source).toContain('Jami qolgan qarz')
  })

  it('blocks submission when the amount exceeds total remaining debt', () => {
    expect(source).toContain('exceedsRemaining')
    expect(source).toContain('qolgan qarzdan oshmasligi kerak')
  })

  it('still uses MoneyInput, never a raw number input, for the amount field', () => {
    expect(source).toContain('<MoneyInput')
    expect(source).not.toMatch(/type="number"[^>]*payAmount/)
  })
})
