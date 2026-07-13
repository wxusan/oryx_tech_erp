// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShopPackageEditor } from '@/components/admin/shop-package-editor'
import { SHOP_FEATURE_CATALOG, SHOP_FEATURE_CODES } from '@/lib/access-control'
import type { ShopPackageDraft } from '@/lib/shop-package-contract'

afterEach(cleanup)

function draft(overrides: Partial<ShopPackageDraft> = {}): ShopPackageDraft {
  return {
    effectiveOn: '2026-08-01',
    basePrice: 100,
    currency: 'USD',
    discountAmount: 0,
    note: 'Initial package configuration',
    features: SHOP_FEATURE_CODES.map((featureCode) => ({
      featureCode,
      enabled: false,
      recurringPrice: featureCode === 'STAFF_ACCESS' ? 0 : 10,
    })),
    ...overrides,
  }
}

describe('ShopPackageEditor', () => {
  it('renders the complete feature catalog and prominently explains that staff access is free', () => {
    render(<ShopPackageEditor initialValue={draft()} onSubmit={vi.fn()} />)

    for (const feature of SHOP_FEATURE_CATALOG) {
      expect(screen.getByText(feature.label)).toBeTruthy()
    }
    expect(screen.getByText('Xodimlar profili doimo bepul')).toBeTruthy()
    expect(screen.getAllByText(/STAFF_ACCESS.*0 USD.*jami narx/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('$100.00')).toHaveLength(2)
  })

  it('keeps OWNER_AND_STAFF and STAFF_ACCESS synchronized without changing the package total', async () => {
    const user = userEvent.setup()
    render(<ShopPackageEditor initialValue={draft()} onSubmit={vi.fn()} />)

    const total = screen.getByRole('region', { name: 'Oylik paket jami' })
    expect(within(total).getAllByText('$100.00')).toHaveLength(2)

    await user.click(screen.getByRole('radio', { name: /Egasi va xodimlar/ }))

    expect((screen.getByRole('checkbox', { name: /Xodimlar profili/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(total).getAllByText('$100.00')).toHaveLength(2)

    await user.click(screen.getByRole('checkbox', { name: /Xodimlar profili/ }))
    expect((screen.getByRole('radio', { name: /Faqat do‘kon egasi/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(total).getAllByText('$100.00')).toHaveLength(2)
  })

  it('enables prerequisites and disables dependents as one consistent snapshot', async () => {
    const user = userEvent.setup()
    render(<ShopPackageEditor initialValue={draft()} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('checkbox', { name: /Olib-sotdim/ }))

    expect((screen.getByRole('checkbox', { name: /Qurilmalar va ombor/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /Naqd savdo va Qarz/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /Olib-sotdim/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('status').textContent).toContain("bog'liq modullar ham yoqildi")

    await user.click(screen.getByRole('checkbox', { name: /Qurilmalar va ombor/ }))

    expect((screen.getByRole('checkbox', { name: /Naqd savdo va Qarz/ }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: /Olib-sotdim/ }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('status').textContent).toContain("bog'liq modullar ham o'chirildi")
  })

  it('rejects non-exact UZS money and submits only a complete validated draft', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ShopPackageEditor initialValue={draft({ currency: 'UZS', basePrice: 100 })} onSubmit={onSubmit} />)

    const basePrice = screen.getByLabelText('Asosiy oylik narx')
    await user.clear(basePrice)
    await user.type(basePrice, '100.25')
    await user.click(screen.getByRole('button', { name: 'Paket versiyasini saqlash' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/UZS narxi butun so'mda/)).toBeTruthy()

    await user.clear(basePrice)
    await user.type(basePrice, '125')
    await user.click(screen.getByRole('button', { name: 'Paket versiyasini saqlash' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const submitted = onSubmit.mock.calls[0][0] as ShopPackageDraft
    expect(submitted.basePrice).toBe(125)
    expect(submitted.features).toHaveLength(SHOP_FEATURE_CODES.length)
    expect(submitted.features.find((feature) => feature.featureCode === 'STAFF_ACCESS')).toMatchObject({
      enabled: false,
      recurringPrice: 0,
    })
  })
})
