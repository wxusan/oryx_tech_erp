import type { CurrencyCode } from '@/lib/currency'

export type DeviceStatus = 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA' | 'RETURNED' | 'DELETED'

export interface DeviceListSaleInfo {
  saleType: 'CASH' | 'NASIYA'
  soldPrice: number
  interestAmount: number
  profit: number | null
  contractCurrency: CurrencyCode
  contractSoldPrice: number
  contractRemainingAmount: number | null
  contractProfit: number | null
  customerName: string | null
  soldAt: string
  returned: boolean
  refundAmount: number | null
}

export interface DeviceListItem {
  id: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  imei: string
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
