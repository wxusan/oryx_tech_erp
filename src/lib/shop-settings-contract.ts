import type { FxQuoteDto } from '@/lib/currency'

export interface ShopAdminProfileDto {
  id: string
  name: string
  phone: string
  login: string
  memberKind: 'SHOP_OWNER' | 'SHOP_STAFF'
  telegramAllowed: boolean
  telegramId: string | null
  telegramVerifiedAt: string | null
  passwordChangedAt: string
  shop?: {
    id: string
    name: string
    shopNumber: string
  }
}

export interface ShopProfileDto {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  address: string
  note: string | null
  status: string
  subscriptionDue: string
  preferredCurrency: 'UZS' | 'USD'
  usdUzsRate: number | null
  usdUzsRateSource: string | null
  usdUzsRateFetchedAt: string | null
  fxQuote: FxQuoteDto | null
  telegramNotificationsEnabled: boolean
}

export interface ShopSettingsInitialData {
  profile: ShopAdminProfileDto
  shop: ShopProfileDto | null
}
