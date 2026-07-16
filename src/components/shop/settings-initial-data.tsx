'use client'

import { createContext, useContext } from 'react'
import type { ShopSettingsInitialData } from '@/lib/shop-settings-contract'

const ShopSettingsInitialDataContext = createContext<ShopSettingsInitialData | null>(null)

export function ShopSettingsInitialDataProvider({
  value,
  children,
}: {
  value: ShopSettingsInitialData
  children: React.ReactNode
}) {
  return <ShopSettingsInitialDataContext.Provider value={value}>{children}</ShopSettingsInitialDataContext.Provider>
}

export function useShopSettingsInitialData() {
  const value = useContext(ShopSettingsInitialDataContext)
  if (!value) throw new Error('Shop settings initial data is missing')
  return value
}
