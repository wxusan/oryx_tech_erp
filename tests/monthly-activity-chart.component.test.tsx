// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthlyActivityChart } from '@/components/shop/monthly-activity-chart'

vi.mock('recharts', () => ({
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}))

afterEach(cleanup)

const activity = [{
  month: '2026-07',
  contracts: { UZS: 1_000, USD: 100 },
  payments: { UZS: 700, USD: 70 },
  refunds: { UZS: 200, USD: 20 },
  waivedProfit: { UZS: 50, USD: 5 },
  writeOffs: { UZS: 100, USD: 10 },
}]

describe('MonthlyActivityChart', () => {
  it('shows exact native values and toggles the historical write-off series', async () => {
    const user = userEvent.setup()
    render(
      <MonthlyActivityChart
        activity={activity}
        currency="UZS"
        showFinancials
        titleId="activity-title"
      />,
    )

    expect(screen.getByText('Oylik faollik')).toBeTruthy()
    expect(screen.getByText(/Shartnoma 1[\s.]000 UZS/)).toBeTruthy()
    expect(screen.getByText(/To‘lov 700 UZS/)).toBeTruthy()
    expect(screen.getByText(/Qaytarish 200 UZS/)).toBeTruthy()
    expect(screen.getByTestId('bar-waivedProfit')).toBeTruthy()
    expect(screen.getByText(/Kechilgan foyda 50 UZS/)).toBeTruthy()
    expect(screen.queryByTestId('bar-writeOffs')).toBeNull()

    const toggle = screen.getByRole('button', { name: 'Hisobdan chiqarish' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('bar-writeOffs')).toBeTruthy()
    expect(screen.getByText(/Hisobdan chiqarish 100 UZS/)).toBeTruthy()
  })

  it('keeps financial series out of the operational customer view', () => {
    render(
      <MonthlyActivityChart
        activity={activity}
        currency="USD"
        showFinancials={false}
        titleId="staff-activity-title"
      />,
    )

    expect(screen.getByText(/Shartnoma \$100.00/)).toBeTruthy()
    expect(screen.queryByText('To‘lovlar')).toBeNull()
    expect(screen.queryByText('Qaytarishlar (pastda)')).toBeNull()
    expect(screen.queryByText('Kechilgan foyda (pastda)')).toBeNull()
    expect(screen.queryByTestId('bar-waivedProfit')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hisobdan chiqarish' })).toBeNull()
  })
})
