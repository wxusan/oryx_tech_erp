// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { NasiyaSchedulePreview } from '@/components/shop/nasiya-schedule-preview'
import { ShopStatusBadge } from '@/components/admin/shop-status-badge'

afterEach(cleanup)

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:accessibility-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

function ImageSelectionHarness() {
  const selection = useImageSelection({ mode: 'multiple', uploadEndpoint: '/api/uploads/device' })
  return <ImageSelectionField inputId="images" label="Rasmlar" mode="multiple" selection={selection} />
}

describe('extracted accessible presentation components', () => {
  it('associates the image picker label and help text with its file input', () => {
    render(<ImageSelectionHarness />)
    const input = screen.getByLabelText('Rasm tanlash')
    expect(input.getAttribute('type')).toBe('file')
    expect(input.getAttribute('aria-describedby')).toBe('images-help')
    expect(document.getElementById('images-help')?.textContent).toContain('5 MB')
  })

  it('gives the schedule table an accessible caption', () => {
    render(<NasiyaSchedulePreview rows={[{ month: 1, date: '2026-08-13', amount: 100 }]} formatAmount={(amount) => `${amount} USD`} />)
    expect(screen.getByRole('table', { name: "Nasiya to'lov jadvali" })).toBeTruthy()
    expect(screen.getByText('100 USD')).toBeTruthy()
  })

  it('renders the centralized shop status label', () => {
    render(<ShopStatusBadge status="SUSPENDED" />)
    expect(screen.getByText("To'xtatilgan")).toBeTruthy()
  })
})
