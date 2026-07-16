import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ShopCurrencyProvider, useShopCurrency } from '@/lib/use-shop-currency'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

function CurrencyProbe() {
  return createElement('span', null, useShopCurrency().currency.currency)
}

describe('shop currency initial render', () => {
  it.each(['USD', 'UZS'] as const)('renders the server-provided %s currency before hydration', (currency) => {
    const html = renderToStaticMarkup(
      createElement(
        ShopCurrencyProvider,
        { initialCurrency: { currency, usdUzsRate: currency === 'USD' ? 12_500 : null } },
        createElement(CurrencyProbe),
      ),
    )

    expect(html).toContain(currency)
  })

  it('seeds the shared provider from the authenticated shop layout instead of fetching a client-side UZS default', () => {
    const layout = read('src/app/(shop)/layout.tsx')
    const hook = read('src/lib/use-shop-currency.ts')

    expect(layout).toContain('getShopCurrencyContext(guarded.shopId)')
    expect(layout).toContain('<ShopCurrencyProvider initialCurrency={currency}>')
    expect(hook).not.toContain("currency: 'UZS'")
    expect(hook).not.toContain("fetch('/api/shop/profile')")
  })

  it('keeps the displayed purchase currency and submitted inputCurrency on the same provider value', () => {
    const page = read('src/app/(shop)/shop/qurilmalar/new/page.tsx')

    expect(page).toContain('currencyLabel(currency.currency)')
    expect(page).toContain('currency={currency.currency}')
    expect(page).toContain('inputCurrency: currency.currency')
  })

  it('updates the current provider after a preferred-currency settings save', () => {
    const settings = read('src/app/(shop)/shop/settings/settings-shop-section.tsx')

    expect(settings).toContain('setCurrency({ currency: json.data.preferredCurrency, usdUzsRate: json.data.usdUzsRate })')
  })
})
