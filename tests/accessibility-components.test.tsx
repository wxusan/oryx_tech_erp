// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { NasiyaHistorySections } from '@/components/shop/nasiya-history-sections'
import { NasiyaSchedulePreview } from '@/components/shop/nasiya-schedule-preview'
import { ShopStatusBadge } from '@/components/admin/shop-status-badge'
import { createMoneyDto } from '@/lib/currency'

afterEach(cleanup)

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:accessibility-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

function ImageSelectionHarness() {
  const selection = useImageSelection({ mode: 'multiple', uploadEndpoint: '/api/uploads/device' })
  return <ImageSelectionField inputId="images" label="Rasmlar" mode="multiple" selection={selection} />
}

function LazyHistoryHarness() {
  const [historyLoading, setHistoryLoading] = useState(false)

  return (
    <NasiyaHistorySections
      schedules={[]}
      payments={[]}
      logs={[]}
      formatMoney={(amount) => `${amount.minorUnits} ${amount.currency}`}
      historyLoaded={false}
      historyLoading={historyLoading}
      onLoadHistory={() => setHistoryLoading(true)}
    />
  )
}

describe('extracted accessible presentation components', () => {
  it('associates the image picker label and help text with its file input', () => {
    render(<ImageSelectionHarness />)
    const input = screen.getByLabelText('Rasm tanlash')
    expect(input.getAttribute('type')).toBe('file')
    expect(input.getAttribute('aria-describedby')).toBe('images-help')
    expect(document.getElementById('images-help')?.textContent).toContain('5 MB')
  })

  it('names the schedule preview table from its visible heading', () => {
    render(<NasiyaSchedulePreview rows={[{ month: 1, date: '2026-08-13', amount: 100 }]} formatAmount={(amount) => `${amount} USD`} />)
    expect(screen.getByRole('table', { name: "Nasiya to'lov jadvali" })).toBeTruthy()
    expect(screen.getByText('100 USD')).toBeTruthy()
  })

  it('names loaded nasiya history tables from their visible section headings', () => {
    const usd100 = createMoneyDto('USD', 100)
    const usd0 = createMoneyDto('USD', 0)

    render(
      <NasiyaHistorySections
        schedules={[{
          id: 'schedule-1',
          monthNumber: 1,
          dueDate: '2026-08-13',
          delayedUntil: null,
          status: 'PENDING',
          expected: usd100,
          paid: usd0,
          remaining: usd100,
          legacyExpected: usd100,
          legacyPaid: usd0,
        }]}
        payments={[{
          id: 'payment-1',
          paymentMethod: 'CASH',
          paidAt: '2026-07-22T08:00:00.000Z',
          note: null,
          nasiyaScheduleId: 'schedule-1',
          recordedUzs: createMoneyDto('UZS', 1_260_000),
          input: usd100,
          applied: usd100,
          paymentFxQuote: null,
        }]}
        logs={[]}
        formatMoney={(amount) => `${amount.minorUnits} ${amount.currency}`}
      />,
    )

    expect(screen.getByRole('table', { name: "To'lov jadvali" })).toBeTruthy()
    expect(screen.getByRole('table', { name: "To'lov tarixi" })).toBeTruthy()
  })

  it('shows lazy-history feedback in the same interaction turn', () => {
    render(<LazyHistoryHarness />)
    const button = screen.getByRole('button', { name: 'Batafsil tarixni yuklash' })
    const startedAt = performance.now()

    fireEvent.click(button)

    expect(performance.now() - startedAt).toBeLessThan(100)
    expect((screen.getByRole('button', { name: 'Tarix yuklanmoqda...' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the centralized shop status label', () => {
    render(<ShopStatusBadge status="SUSPENDED" />)
    expect(screen.getByText('Vaqtincha to‘xtatilgan')).toBeTruthy()
  })
})
