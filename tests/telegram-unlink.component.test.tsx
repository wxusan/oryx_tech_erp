// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsTelegramSection } from '@/app/(shop)/shop/settings/settings-telegram-section'
import type { ShopAdminProfileDto } from '@/lib/shop-settings-contract'

vi.mock('@/lib/client-events', () => ({
  commitNavigationMutation: vi.fn(() => Promise.resolve(true)),
}))

const linkedProfile: ShopAdminProfileDto = {
  id: 'staff-1',
  name: 'Test xodim',
  phone: '+998901234567',
  login: 'test_staff',
  memberKind: 'SHOP_STAFF',
  telegramAllowed: true,
  telegramId: '123456789',
  telegramVerifiedAt: '2026-07-18T08:00:00.000Z',
  passwordChangedAt: '2026-07-18T08:00:00.000Z',
}

function successfulProfileResponse(profile: ShopAdminProfileDto, message: string) {
  return {
    ok: true,
    json: async () => ({ data: profile, message }),
  } as Response
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Telegram unlink presentation contract', () => {
  it('keeps an unlink-only action visible for a disabled legacy link', () => {
    render(
      <SettingsTelegramSection
        profile={{ ...linkedProfile, telegramAllowed: false }}
        onProfileChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'Telegram ID' })).toBeNull()
    expect(screen.getByRole('button', { name: /Telegramni uzish/ })).toBeTruthy()
    expect(screen.getByText(/Yangi ID ulash mumkin emas/)).toBeTruthy()
    expect(screen.queryByText(/Bildirishnomalar shu ID ga yuboriladi/)).toBeNull()
  })

  it('confirms unlink, sends an explicit blank ID, and exposes pending and success feedback', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveRequest: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => new Promise<Response>((resolve) => { resolveRequest = resolve }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onProfileChange = vi.fn()
    render(<SettingsTelegramSection profile={linkedProfile} onProfileChange={onProfileChange} />)

    const unlink = screen.getByRole('button', { name: /Telegramni uzish/ })
    fireEvent.click(unlink)
    fireEvent.click(unlink)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(unlink.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Uzilmoqda...')).toBeTruthy()
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ telegramId: '' })

    const unlinked = { ...linkedProfile, telegramId: null, telegramVerifiedAt: null }
    resolveRequest?.(successfulProfileResponse(unlinked, "Telegram ulanishi o'chirildi."))

    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(unlinked))
    expect(screen.getByRole('status').textContent).toContain("Telegram ulanishi o'chirildi")
  })

  it('does not use a blank save as an implicit unlink', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <SettingsTelegramSection
        profile={{ ...linkedProfile, telegramId: null, telegramVerifiedAt: null }}
        onProfileChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Telegram ID saqlash/ }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Telegramni uzish')
  })
})
