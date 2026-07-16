export interface SalesListItem {
  id: string
  dueDate: string | null
  reminderEnabled: boolean
  contractCurrency: 'UZS' | 'USD'
  contractSalePrice: number
  contractRemainingAmount: number
  contractProfit?: number | null
  createdAt: string
  customer: { id: string; name: string; phone: string }
  device: {
    id: string
    model: string
    color: string | null
    storage: string | null
    imei: string
  }
}

export interface SalesListPage {
  items: SalesListItem[]
  skip: number
  take: number
  hasNext: boolean
}
