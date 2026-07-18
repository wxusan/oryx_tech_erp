'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { useShopSettingsInitialData } from '@/components/shop/settings-initial-data'
import type {
  ShopAdminProfileDto,
  ShopProfileDto,
  ShopSettingsInitialData,
} from '@/lib/shop-settings-contract'
import type { ApiResponse } from '@/types'
import { SettingsAccountSection } from './settings-account-section'
import { SettingsPasswordSection } from './settings-password-section'
import { SettingsShopSection } from './settings-shop-section'
import { SettingsTelegramSection } from './settings-telegram-section'
import { readSettingsApiError } from './settings-shared'

export const SHOP_SETTINGS_QUERY_KEY = ['shop', 'settings'] as const
const SETTINGS_STALE_TIME_MS = 5 * 60 * 1000

async function readSettingsResponse<T>(response: Response) {
  if (!response.ok) throw new Error(await readSettingsApiError(response))
  const json: ApiResponse<T> = await response.json()
  if (!json.data) throw new Error(json.error || 'Sozlamalar topilmadi')
  return json.data
}

async function fetchSettings(canManageShop: boolean): Promise<ShopSettingsInitialData> {
  const [profileResponse, shopResponse] = await Promise.all([
    fetch('/api/shop-admin/profile', { cache: 'no-store' }),
    canManageShop
      ? fetch('/api/shop/profile', { cache: 'no-store' })
      : Promise.resolve(null),
  ])
  const [profile, shop] = await Promise.all([
    readSettingsResponse<ShopAdminProfileDto>(profileResponse),
    shopResponse ? readSettingsResponse<ShopProfileDto>(shopResponse) : Promise.resolve(null),
  ])
  return { profile, shop }
}

export function ShopSettingsClient() {
  const initialData = useShopSettingsInitialData()
  const queryClient = useQueryClient()
  const { can, memberKind } = useShopAccess()
  const isStaff = memberKind === 'SHOP_STAFF'
  const canEditShopProfile = can('SHOP_PROFILE_EDIT')
  const canManageCurrency = can('SHOP_CURRENCY_MANAGE')
  const canManageShopTelegram = can('SHOP_TELEGRAM_MANAGE')
  const canManageShop = canEditShopProfile || canManageCurrency || canManageShopTelegram
  const settingsQuery = useQuery({
    queryKey: SHOP_SETTINGS_QUERY_KEY,
    queryFn: () => fetchSettings(canManageShop),
    initialData,
    staleTime: SETTINGS_STALE_TIME_MS,
  })
  const settings = settingsQuery.data

  function updateProfile(profile: ShopAdminProfileDto) {
    queryClient.setQueryData<ShopSettingsInitialData>(SHOP_SETTINGS_QUERY_KEY, (current) => ({
      profile,
      shop: current?.shop ?? settings.shop,
    }))
  }

  function updateShop(shop: ShopProfileDto) {
    queryClient.setQueryData<ShopSettingsInitialData>(SHOP_SETTINGS_QUERY_KEY, (current) => ({
      profile: current?.profile ?? settings.profile,
      shop,
    }))
  }

  return (
    <div className="max-w-5xl space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Sozlamalar</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {isStaff ? 'Shaxsiy ma’lumotlar va parol xavfsizligi' : 'Profil, Telegram ulanishi va parol xavfsizligi'}
          </p>
        </div>
        {settings.profile.shop && (
          <Badge variant="outline" className="h-6 w-fit rounded-md border-zinc-200 text-zinc-600">
            {settings.profile.shop.name}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy={settingsQuery.isFetching}>
        <SettingsAccountSection
          profile={settings.profile}
          isStaff={isStaff}
          onProfileChange={updateProfile}
        />
        {canManageShop && settings.shop && (
          <SettingsShopSection
            shop={settings.shop}
            canEditShopProfile={canEditShopProfile}
            canManageCurrency={canManageCurrency}
            canManageShopTelegram={canManageShopTelegram}
            onShopChange={updateShop}
          />
        )}
        {(settings.profile.telegramAllowed || Boolean(settings.profile.telegramId)) && (
          <SettingsTelegramSection profile={settings.profile} onProfileChange={updateProfile} />
        )}
        <SettingsPasswordSection />
      </div>
    </div>
  )
}
