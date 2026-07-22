export const CUSTOMER_PROFILE_ANALYTICS_RANGES = [6, 12, 24] as const

export type CustomerProfileAnalyticsMonths = (typeof CUSTOMER_PROFILE_ANALYTICS_RANGES)[number]
export type CustomerProfileAnalyticsVisibility = 'OPERATIONAL' | 'OWNER_FINANCIAL'
export type CustomerProfileCurrency = 'UZS' | 'USD'

export interface CustomerProfileNativeMoney {
  UZS: number
  USD: number
}

export interface CustomerProfileDueBuckets {
  overdue: number
  today: number
  next7Days: number
  days8To30: number
  later: number
}

export interface CustomerProfileActivityMonth {
  month: string
  contracts: CustomerProfileNativeMoney
  payments?: CustomerProfileNativeMoney
  refunds?: CustomerProfileNativeMoney
  waivedProfit?: CustomerProfileNativeMoney
  writeOffs?: CustomerProfileNativeMoney
}

export interface CustomerProfileDiscipline {
  paidInstallments: number
  onTimeInstallments: number
  lateInstallments: number
  onTimeRatio: number | null
  maxDaysLate: number
  currentOverdueSchedules: number
}

export interface CustomerProfileAnalyticsCounts {
  devices: number
  sales: number
  nasiyas: number
  activeNasiyas: number
  completedNasiyas: number
  returns: number
}

export interface CustomerProfileAnalytics {
  asOf: string
  timezone: 'Asia/Tashkent'
  months: CustomerProfileAnalyticsMonths
  visibility: CustomerProfileAnalyticsVisibility
  obligations: Record<CustomerProfileCurrency, CustomerProfileDueBuckets>
  activity: CustomerProfileActivityMonth[]
  discipline: CustomerProfileDiscipline
  counts: CustomerProfileAnalyticsCounts
  caveats: {
    legacyUsdPaymentCount?: number
  }
}

export function parseCustomerProfileAnalyticsMonths(
  value: string | number | null | undefined,
): CustomerProfileAnalyticsMonths | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return CUSTOMER_PROFILE_ANALYTICS_RANGES.includes(parsed as CustomerProfileAnalyticsMonths)
    ? parsed as CustomerProfileAnalyticsMonths
    : null
}

export function customerProfileAnalyticsWindow(
  months: CustomerProfileAnalyticsMonths,
  currentMonthStart: Date,
) {
  // Tashkent has no daylight-saving changes. Shift to its calendar, move by
  // calendar months from day one, then shift midnight back to UTC.
  const tashkentCalendar = new Date(currentMonthStart.getTime() + 5 * 60 * 60 * 1000)
  const start = new Date(Date.UTC(
    tashkentCalendar.getUTCFullYear(),
    tashkentCalendar.getUTCMonth() - (months - 1),
    1,
    -5,
  ))
  return { start, end: new Date(currentMonthStart) }
}

export function totalDueBuckets(value: CustomerProfileDueBuckets) {
  return value.overdue + value.today + value.next7Days + value.days8To30 + value.later
}
