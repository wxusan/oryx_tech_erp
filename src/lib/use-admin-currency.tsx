'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { CurrencyCode, CurrencyContext } from '@/lib/currency'

interface AdminCurrencyValue {
  currency: CurrencyContext
  saving: boolean
  error: string
  setDisplayCurrency: (currency: CurrencyCode) => Promise<void>
}

const AdminCurrencyContext = createContext<AdminCurrencyValue | null>(null)

export function AdminCurrencyProvider({
  initialCurrency,
  children,
}: {
  initialCurrency: CurrencyContext
  children: ReactNode
}) {
  const [currency, setCurrency] = useState(initialCurrency)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setDisplayCurrency = useCallback(async (next: CurrencyCode) => {
    if (next === currency.currency || saving) return
    const previous = currency
    setCurrency((current) => ({ ...current, currency: next }))
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredCurrency: next }),
      })
      const json = await response.json() as { success?: boolean; error?: string }
      if (!response.ok || !json.success) throw new Error(json.error || 'Valyuta saqlanmadi')
    } catch (cause) {
      setCurrency(previous)
      setError(cause instanceof Error ? cause.message : 'Valyuta saqlanmadi')
    } finally {
      setSaving(false)
    }
  }, [currency, saving])

  return (
    <AdminCurrencyContext.Provider value={{ currency, saving, error, setDisplayCurrency }}>
      {children}
    </AdminCurrencyContext.Provider>
  )
}

export function useAdminCurrency() {
  const value = useContext(AdminCurrencyContext)
  if (!value) throw new Error('useAdminCurrency must be used within AdminCurrencyProvider')
  return value
}
