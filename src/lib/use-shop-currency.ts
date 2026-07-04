'use client'

import { useEffect, useState } from 'react'
import type { CurrencyContext } from '@/lib/currency'
import type { ApiResponse } from '@/types'

interface ShopCurrencyPayload {
  preferredCurrency: 'UZS' | 'USD'
  usdUzsRate: number | null
}

const DEFAULT_CURRENCY: CurrencyContext = { currency: 'UZS', usdUzsRate: null }

export function useShopCurrency() {
  const [currency, setCurrency] = useState<CurrencyContext>(DEFAULT_CURRENCY)
  const [currencyError, setCurrencyError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/shop/profile')
      .then((response) => response.json())
      .then((json: ApiResponse<ShopCurrencyPayload>) => {
        if (cancelled || !json.success || !json.data) return
        setCurrency({
          currency: json.data.preferredCurrency ?? 'UZS',
          usdUzsRate: json.data.usdUzsRate ?? null,
        })
      })
      .catch(() => {
        if (!cancelled) setCurrencyError('Valyuta sozlamasi yuklanmadi')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { currency, currencyError }
}
