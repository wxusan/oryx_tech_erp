'use client'

import { createContext, createElement, useContext, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { CurrencyContext } from '@/lib/currency'

interface ShopCurrencyValue {
  currency: CurrencyContext
  currencyError: string
  setCurrency: Dispatch<SetStateAction<CurrencyContext>>
}

const ShopCurrencyContext = createContext<ShopCurrencyValue | null>(null)

export function ShopCurrencyProvider({ initialCurrency, children }: { initialCurrency: CurrencyContext; children?: ReactNode }) {
  const [currency, setCurrency] = useState<CurrencyContext>(initialCurrency)

  return createElement(ShopCurrencyContext.Provider, { value: { currency, currencyError: '', setCurrency } }, children)
}

export function useShopCurrency() {
  const value = useContext(ShopCurrencyContext)
  if (!value) throw new Error('useShopCurrency must be used within ShopCurrencyProvider')
  return value
}
