import type { CustomerProfileAnalytics } from '@/lib/customer-profile-analytics'

export interface CustomerProfileNativeMoney {
  UZS: number
  USD: number
}

export interface CustomerProfileMetrics {
  contractValue: CustomerProfileNativeMoney
  dueThisMonth: CustomerProfileNativeMoney
  overdue: CustomerProfileNativeMoney
  cashCollected: CustomerProfileNativeMoney
  refunds: CustomerProfileNativeMoney
  writeOffs: CustomerProfileNativeMoney
  waivedNasiyaProfit: CustomerProfileNativeMoney
  accountingAccrualGrossProfitUzs: number
  nasiyaInterestUzs: number
  legacyUsdPaymentCount: number
}

export type CustomerProfileOperationalMetrics = Pick<CustomerProfileMetrics, 'contractValue' | 'dueThisMonth' | 'overdue'>
export type CustomerProfileOwnerFinancialMetrics = Omit<CustomerProfileMetrics, keyof CustomerProfileOperationalMetrics>
export type CustomerProfileVisibleMetrics = CustomerProfileOperationalMetrics & Partial<CustomerProfileOwnerFinancialMetrics>

/**
 * Omit, rather than nulling, owner financial values so they cannot be
 * mistaken for valid zeroes or retained in a worker's client cache.
 */
export function redactShopStaffCustomerProfileMetrics(metrics: CustomerProfileMetrics): CustomerProfileOperationalMetrics {
  return {
    contractValue: metrics.contractValue,
    dueThisMonth: metrics.dueThisMonth,
    overdue: metrics.overdue,
  }
}

/** Owner cash-flow series and caveats never cross the staff API boundary. */
export function redactShopStaffCustomerProfileAnalytics(
  analytics: CustomerProfileAnalytics,
): CustomerProfileAnalytics {
  return {
    asOf: analytics.asOf,
    timezone: analytics.timezone,
    months: analytics.months,
    visibility: 'OPERATIONAL',
    obligations: analytics.obligations,
    activity: analytics.activity.map(({ month, contracts }) => ({ month, contracts })),
    discipline: analytics.discipline,
    counts: analytics.counts,
    caveats: {},
  }
}
