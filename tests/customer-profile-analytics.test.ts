import { describe, expect, it } from 'vitest'
import {
  customerProfileAnalyticsWindow,
  parseCustomerProfileAnalyticsMonths,
  totalDueBuckets,
  type CustomerProfileAnalytics,
} from '@/lib/customer-profile-analytics'
import { redactShopStaffCustomerProfileAnalytics } from '@/lib/customer-profile-visibility'

function ownerAnalytics(): CustomerProfileAnalytics {
  return {
    asOf: '2026-07-19T00:00:00.000Z',
    timezone: 'Asia/Tashkent',
    months: 12,
    visibility: 'OWNER_FINANCIAL',
    obligations: {
      UZS: { overdue: 1, today: 2, next7Days: 3, days8To30: 4, later: 5 },
      USD: { overdue: 6, today: 7, next7Days: 8, days8To30: 9, later: 10 },
    },
    activity: [{
      month: '2026-07',
      contracts: { UZS: 100, USD: 10 },
      payments: { UZS: 80, USD: 8 },
      refunds: { UZS: 5, USD: 0 },
      waivedProfit: { UZS: 2, USD: 0 },
      writeOffs: { UZS: 1, USD: 0 },
    }],
    discipline: {
      paidInstallments: 10,
      onTimeInstallments: 8,
      lateInstallments: 2,
      onTimeRatio: 0.8,
      maxDaysLate: 4,
      currentOverdueSchedules: 1,
    },
    counts: { devices: 2, sales: 1, nasiyas: 1, activeNasiyas: 1, completedNasiyas: 0, returns: 1 },
    caveats: { legacyUsdPaymentCount: 2 },
  }
}

describe('customer profile analytics contract', () => {
  it('accepts only the bounded dashboard periods', () => {
    expect(parseCustomerProfileAnalyticsMonths('6')).toBe(6)
    expect(parseCustomerProfileAnalyticsMonths(12)).toBe(12)
    expect(parseCustomerProfileAnalyticsMonths('24')).toBe(24)
    for (const value of [null, '', '0', '7', '36', '12.5', 'private search']) {
      expect(parseCustomerProfileAnalyticsMonths(value)).toBeNull()
    }
  })

  it('builds an inclusive month window without crossing the Tashkent offset', () => {
    const current = new Date('2026-06-30T19:00:00.000Z')
    expect(customerProfileAnalyticsWindow(6, current)).toEqual({
      start: new Date('2026-01-31T19:00:00.000Z'),
      end: current,
    })
    expect(customerProfileAnalyticsWindow(24, current).start).toEqual(new Date('2024-07-31T19:00:00.000Z'))
  })

  it('keeps native currencies separate when totaling due buckets', () => {
    const analytics = ownerAnalytics()
    expect(totalDueBuckets(analytics.obligations.UZS)).toBe(15)
    expect(totalDueBuckets(analytics.obligations.USD)).toBe(40)
  })

  it('omits every owner-only aggregate and series for staff', () => {
    const redacted = redactShopStaffCustomerProfileAnalytics(ownerAnalytics())
    expect(redacted.visibility).toBe('OPERATIONAL')
    expect(redacted.activity).toEqual([{ month: '2026-07', contracts: { UZS: 100, USD: 10 } }])
    expect(redacted.caveats).toEqual({})
    const serialized = JSON.stringify(redacted)
    for (const restricted of ['payments', 'refunds', 'waivedProfit', 'writeOffs', 'legacyUsdPaymentCount']) {
      expect(serialized).not.toContain(restricted)
    }
  })
})
