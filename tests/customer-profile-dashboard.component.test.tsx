// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerProfileDashboard } from '@/app/(shop)/shop/mijozlar/[id]/customer-profile-dashboard'
import type { CustomerProfileAnalytics } from '@/lib/customer-profile-analytics'

vi.mock('@/lib/use-shop-currency', () => ({
  useShopCurrency: () => ({ currency: { currency: 'UZS', usdUzsRate: 12_500 } }),
}))

vi.mock('@/app/(shop)/shop/mijozlar/[id]/customer-profile-charts-loader', () => ({
  default: ({ currency }: { currency: string }) => <div data-testid="profile-charts">{currency} grafik</div>,
}))

afterEach(cleanup)

const analytics: CustomerProfileAnalytics = {
  asOf: '2026-07-19T00:00:00.000Z',
  timezone: 'Asia/Tashkent',
  months: 12,
  visibility: 'OWNER_FINANCIAL',
  obligations: {
    UZS: { overdue: 100_000, today: 50_000, next7Days: 25_000, days8To30: 10_000, later: 5_000 },
    USD: { overdue: 10, today: 5, next7Days: 2, days8To30: 1, later: 1 },
  },
  activity: [{
    month: '2026-07',
    contracts: { UZS: 1_000_000, USD: 100 },
    payments: { UZS: 500_000, USD: 50 },
    refunds: { UZS: 25_000, USD: 2 },
    writeOffs: { UZS: 0, USD: 0 },
  }],
  discipline: {
    paidInstallments: 2,
    onTimeInstallments: 1,
    lateInstallments: 1,
    onTimeRatio: 0.5,
    maxDaysLate: 5,
    currentOverdueSchedules: 1,
  },
  counts: { devices: 2, sales: 1, nasiyas: 1, activeNasiyas: 1, completedNasiyas: 0, returns: 0 },
  caveats: { legacyUsdPaymentCount: 1 },
}

describe('CustomerProfileDashboard', () => {
  it('changes the analytics range and keeps UZS and USD as explicit chart choices', async () => {
    const user = userEvent.setup()
    const onMonthsChange = vi.fn()
    render(
      <CustomerProfileDashboard
        analytics={analytics}
        selectedMonths={12}
        isFetching={false}
        error={null}
        onMonthsChange={onMonthsChange}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '12 oy' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: '24 oy' }))
    expect(onMonthsChange).toHaveBeenCalledWith(24)

    expect(screen.getByTestId('profile-charts').textContent).toContain('UZS grafik')
    await user.click(screen.getByRole('button', { name: 'USD' }))
    expect(screen.getByTestId('profile-charts').textContent).toContain('USD grafik')
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText(/1 ta muddati o‘tgan jadval/)).toBeTruthy()
    expect(screen.getByText(/1 ta eski USD to‘lovida/)).toBeTruthy()
  })

  it('keeps existing analysis visible with an accessible retry when refresh fails', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <CustomerProfileDashboard
        analytics={analytics}
        selectedMonths={12}
        isFetching={false}
        error="Tahlilni yuklab bo‘lmadi"
        onMonthsChange={vi.fn()}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByTestId('profile-charts')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Tahlilni yuklab bo‘lmadi')
    await user.click(screen.getByRole('button', { name: /Qayta urinish/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
