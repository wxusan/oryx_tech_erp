// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

describe('shared Select labels', () => {
  it('renders the selected human label instead of the raw persisted value', () => {
    render(
      <Select value="CASH">
        <SelectTrigger aria-label="To'lov usuli">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CASH">Naqd</SelectItem>
          <SelectItem value="TRANSFER">Bank o&apos;tkazmasi</SelectItem>
        </SelectContent>
      </Select>,
    )

    const trigger = screen.getByRole('combobox', { name: "To'lov usuli" })
    expect(trigger.textContent).toContain('Naqd')
    expect(trigger.textContent).not.toContain('CASH')
  })

  it('infers labels from dynamically rendered items', () => {
    const months = [{ value: '2026-08', label: 'Avgust 2026' }]
    render(
      <Select value="2026-08">
        <SelectTrigger aria-label="Hisobot oyi">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Hisobot oyi' })
    expect(trigger.textContent).toContain('Avgust 2026')
    expect(trigger.textContent).not.toContain('2026-08')
  })
})
