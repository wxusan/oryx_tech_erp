import type { ShopStatus } from '@/lib/domain-types'

export interface AdminShopUser {
  id: string
  name: string
  phone: string
  telegramId: string | null
  telegramVerifiedAt: string | null
  login: string
  isActive: boolean
}

export interface AdminShopPayment {
  id: string
  paidAt: string
  amount: string | number
  months: number
  paymentMethod: string
  note: string | null
}

export interface AdminShopDetail {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  address: string
  note: string | null
  subscriptionDue: string
  status: ShopStatus
  deletedAt: string | null
  deletedBy: string | null
  deleteNote: string | null
  admins: AdminShopUser[]
  payments: AdminShopPayment[]
}
