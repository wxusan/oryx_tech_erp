import type { CustomerProfileNativeMoney } from '@/lib/customer-profile-analytics'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'] as const

export function nativeMoneyLabel(value: CustomerProfileNativeMoney) {
  const parts: string[] = []
  if (value.UZS !== 0) parts.push(`${Math.round(value.UZS).toLocaleString('ru-RU')} UZS`)
  if (value.USD !== 0) {
    parts.push(`$${value.USD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  }
  return parts.length ? parts.join(' · ') : '0'
}

export function currencyMoneyLabel(value: number, currency: 'UZS' | 'USD') {
  return currency === 'USD'
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(value).toLocaleString('ru-RU')} UZS`
}

export function compactCurrencyValue(value: number, currency: 'UZS' | 'USD') {
  const absolute = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  const prefix = currency === 'USD' ? '$' : ''
  const suffix = currency === 'UZS' ? ' UZS' : ''
  if (absolute >= 1_000_000_000) return `${sign}${prefix}${(absolute / 1_000_000_000).toFixed(1)}B${suffix}`
  if (absolute >= 1_000_000) return `${sign}${prefix}${(absolute / 1_000_000).toFixed(1)}M${suffix}`
  if (absolute >= 1_000) return `${sign}${prefix}${Math.round(absolute / 1_000)}K${suffix}`
  return `${sign}${prefix}${Math.round(absolute)}${suffix}`
}

export function activityMonthLabel(month: string, includeYear = false) {
  const [yearText, monthText] = month.split('-')
  const monthIndex = Number(monthText) - 1
  const label = MONTHS[monthIndex] ?? month
  return includeYear ? `${label} ${yearText}` : label
}
