import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('shop monthly activity dashboard', () => {
  const sharedChart = source('src/components/shop/monthly-activity-chart.tsx')
  const activity = source('src/app/(shop)/shop/hisobot/hisobot-activity-chart.tsx')
  const loader = source('src/app/(shop)/shop/hisobot/hisobot-activity-chart-loader.tsx')
  const single = source('src/app/(shop)/shop/hisobot/hisobot-client.tsx')
  const range = source('src/app/(shop)/shop/hisobot/shop-range-report-panel.tsx')

  it('renders the same lazy, accessible, non-animated chart in single and range reports', () => {
    expect(loader).toContain("dynamic(() => import('./hisobot-activity-chart')")
    expect(loader).toContain('ssr: false')
    expect(loader).toContain('aria-label="Oylik faollik grafigi yuklanmoqda"')
    expect(single).toContain('<HisobotActivityChartLoader months={rangeReport.months}')
    expect(range).toContain('<HisobotActivityChartLoader months={report.months}')
    expect(range).not.toContain('function TrendBars')
    expect(sharedChart).toContain('<BarChart accessibilityLayer')
    expect(sharedChart).toContain('<ReferenceLine y={0}')
    expect(sharedChart.match(/isAnimationActive=\{false\}/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps native currencies separate and exposes exact values plus the audit-only write-off toggle', () => {
    expect(activity).toContain("(['UZS', 'USD'] as MonthlyActivityCurrency[])")
    expect(activity).toContain('aria-label="Grafik valyutasi"')
    expect(activity).toContain('contracts: { UZS: month.contracts.uzs, USD: month.contracts.usd }')
    expect(sharedChart).toContain('Qaytarishlar (pastda)')
    expect(sharedChart).toContain('Hisobdan chiqarish (pastda)')
    expect(sharedChart).toContain('aria-pressed={showWriteOffs}')
    expect(sharedChart).toContain('Tarixiy hisobdan chiqarish')
    expect(sharedChart).toContain('Aniq oylik qiymatlar')
  })

  it('reconciles the exact monthly table to the contract series', () => {
    expect(range).toContain('<th scope="col" className="px-4 py-3 font-medium">Shartnomalar</th>')
    expect(range).toContain('partitionText(month.contracts, currency)')
  })
})
