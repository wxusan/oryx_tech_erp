import type { CurrencyCode } from '@/lib/currency'
import type { DeviceStatus } from '@/lib/domain-types'
export type { DeviceStatus } from '@/lib/domain-types'

export interface DeviceListSaleInfo {
  saleType: 'CASH' | 'NASIYA'
  soldPrice: number
  interestAmount: number
  /**
   * Owner-only margin. This property is deliberately omitted (rather than
   * zeroed) from every SHOP_STAFF response so a cached device DTO cannot
   * reveal inventory cost or margin after a role change.
   */
  profit?: number | null
  contractCurrency: CurrencyCode
  contractSoldPrice: number
  contractRemainingAmount: number | null
  /** Owner-only native-currency margin; omitted for SHOP_STAFF. */
  contractProfit?: number | null
  customerName: string | null
  soldAt: string
  /** Current Qarz deadline; null for fully paid or Nasiya device sales. */
  dueDate: string | null
  returned: boolean
  refundAmount: number | null
}

export interface DeviceListItem {
  id: string
  model: string
  color: string | null
  storage: string | null
  storageAmount: number | null
  storageUnit: 'GB' | 'TB' | null
  storageDisplay: string
  conditionCode: 'NEW' | 'USED' | null
  conditionLabel: 'Yangi' | 'Ishlatilgan' | 'Belgilanmagan'
  batteryHealth: number | null
  /** Owner-only inventory cost; omitted from SHOP_STAFF DTOs. */
  purchasePrice?: number
  imei: string
  primaryImei: string
  secondaryImei: string | null
  status: DeviceStatus
  createdAt: string
  note: string | null
  supplierName: string | null
  supplierPhone: string | null
  saleInfo: DeviceListSaleInfo | null
}

export interface DeviceListPage {
  items: DeviceListItem[]
  total: number
  skip: number
  take: number
}
