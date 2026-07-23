// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NasiyaReturnModal } from '@/components/shop/nasiya-return-modal'
import { createFxQuoteDto, createMoneyDto } from '@/lib/currency'
import type { NasiyaReturnQuoteDto } from '@/lib/nasiya-return'

vi.mock('@/lib/client-events', () => ({ commitNavigationMutation: vi.fn(async () => undefined) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const quote: NasiyaReturnQuoteDto = {
  eligible: true,
  ineligibilityReason: null,
  contractCurrency: 'UZS',
  displayCurrency: 'UZS',
  fxQuote: createFxQuoteDto({
    rate: 12_500,
    source: 'CBU',
    fetchedAt: '2026-07-23T08:00:00.000Z',
  }),
  requiresFxForRefund: false,
  receipts: createMoneyDto('UZS', 250),
  defaultRefund: createMoneyDto('UZS', 100),
  defaultRetained: createMoneyDto('UZS', 150),
  maxRefund: createMoneyDto('UZS', 250),
  cancelledDebt: createMoneyDto('UZS', 850),
  contractReceipts: createMoneyDto('UZS', 250),
  contractCancelledDebt: createMoneyDto('UZS', 850),
  receiptEvidenceVerified: true,
}

function renderModal() {
  return render(
    <NasiyaReturnModal
      nasiyaId="nasiya-1"
      shopId="shop-1"
      deviceId="device-1"
      customerName="Ali"
      deviceName="iPhone 15"
      quote={quote}
      open
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
    />,
  )
}

describe('Nasiya return modal', () => {
  it('opens with the down payment, shows the real accounting summary, and keeps the refund editable', async () => {
    renderModal()

    const refund = await screen.findByLabelText('Mijozga qaytariladigan summa') as HTMLInputElement
    await waitFor(() => expect(refund.value).toBe('100'))
    expect(screen.getByText('Mijozdan jami olingan summa')).toBeTruthy()
    expect(screen.getByText('Bekor qilinadigan qolgan qarz')).toBeTruthy()
    expect(screen.getByText('Do‘konda qoladigan summa')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(refund, { target: { value: '75' } })
    expect(refund.value).toBe('75')
    expect(screen.getByText(/175 so['‘]m/)).toBeTruthy()
  })

  it('requires a reason, exposes pending feedback immediately, and blocks a same-turn double submit', async () => {
    const fetchMock = vi.fn((
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): ReturnType<typeof fetch> => {
      void input
      void init
      return new Promise<Response>(() => undefined)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderModal()

    const refund = await screen.findByLabelText('Mijozga qaytariladigan summa') as HTMLInputElement
    await waitFor(() => expect(refund.value).toBe('100'))
    fireEvent.change(screen.getByLabelText(/Qaytarish sababi/), {
      target: { value: 'Mijoz bilan kelishilgan qaytarish' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Qaytarish usuli' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Naqd pul' }))
    const confirm = screen.getByRole('button', { name: /Qaytarishni tasdiqlash/ })
    expect(confirm.hasAttribute('disabled')).toBe(false)

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Qaytarilmoqda…')).toBeTruthy()
    expect(confirm.getAttribute('aria-busy')).toBe('true')
    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      refundAmount: 100,
      refundMethod: 'CASH',
      inputCurrency: 'UZS',
      expectedContractReceiptsMinorUnits: 250,
      expectedContractRemainingMinorUnits: 850,
      expectedFxRateMinorUnits: 125_000_000,
      note: 'Mijoz bilan kelishilgan qaytarish',
    })
  })
})
