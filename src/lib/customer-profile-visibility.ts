export interface CustomerProfileNativeMoney {
  UZS: number
  USD: number
}

export interface CustomerProfileMetrics {
  contractValue: CustomerProfileNativeMoney
  dueToday: CustomerProfileNativeMoney
  overdue: CustomerProfileNativeMoney
  cashCollected: CustomerProfileNativeMoney
  refunds: CustomerProfileNativeMoney
  writeOffs: CustomerProfileNativeMoney
  accountingAccrualGrossProfitUzs: number
  nasiyaInterestUzs: number
  legacyUsdPaymentCount: number
}

export type CustomerProfileOperationalMetrics = Pick<CustomerProfileMetrics, 'contractValue' | 'dueToday' | 'overdue'>
export type CustomerProfileOwnerFinancialMetrics = Omit<CustomerProfileMetrics, keyof CustomerProfileOperationalMetrics>
export type CustomerProfileVisibleMetrics = CustomerProfileOperationalMetrics & Partial<CustomerProfileOwnerFinancialMetrics>

/**
 * Omit, rather than nulling, owner financial values so they cannot be
 * mistaken for valid zeroes or retained in a worker's client cache.
 */
export function redactShopStaffCustomerProfileMetrics(metrics: CustomerProfileMetrics): CustomerProfileOperationalMetrics {
  return {
    contractValue: metrics.contractValue,
    dueToday: metrics.dueToday,
    overdue: metrics.overdue,
  }
}
