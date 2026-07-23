// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerPassportPanel } from '@/components/shop/customer-passport-panel'
import { ShopAccessProvider } from '@/components/shop/shop-access-context'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderStaffPanel(grantedPermissions: Array<'CUSTOMER_PASSPORT_PHOTO_VIEW'>) {
  return render(
    <ShopAccessProvider
      memberKind="SHOP_STAFF"
      enabledFeatures={['CUSTOMER_CRM']}
      grantedPermissions={grantedPermissions}
      legacyFullAccess={false}
    >
      <CustomerPassportPanel
        customerId="customer-1"
        passportMasked="AA•••••12"
        hasPassportPhoto
      />
    </ShopAccessProvider>,
  )
}

describe('customer passport viewer permissions', () => {
  it('does not fetch or expose a photo control to staff without permission', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderStaffPanel([])

    expect(screen.queryByRole('button', { name: /Rasmni ko'rish/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /kattalashtirish/ })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reuses the authorized signed URL for a permitted staff viewer', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { url: 'https://signed.example/passport.jpg' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    renderStaffPanel(['CUSTOMER_PASSPORT_PHOTO_VIEW'])

    const revealButton = await screen.findByRole('button', { name: /Rasmni ko'rish/ })
    await user.click(revealButton)
    const expandButton = await screen.findByRole('button', {
      name: 'Mijozning pasport rasmini kattalashtirish',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await user.click(expandButton)
    expect(screen.getByRole('img', { name: 'Mijozning pasport rasmi' }).getAttribute('src'))
      .toBe('https://signed.example/passport.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Oldingi rasm' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Keyingi rasm' })).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mijozning pasport rasmi' })).toBeNull())
  })
})
