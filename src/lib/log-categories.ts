export type LogCategory =
  | 'all'
  | 'nasiya'
  | 'sale'
  | 'device'
  | 'payment'
  | 'return'
  | 'restock'
  | 'import_nasiya'
  | 'customer'
  | 'settings'
  | 'telegram'
  | 'account'

export const logCategoryOptions: { value: LogCategory; label: string }[] = [
  { value: 'all', label: 'Barchasi' },
  { value: 'nasiya', label: 'Nasiya' },
  { value: 'sale', label: 'Sotuv' },
  { value: 'device', label: 'Yangi mahsulot' },
  { value: 'payment', label: "To'lovlar" },
  { value: 'return', label: 'Qaytarish' },
  { value: 'restock', label: 'Qayta sotuv' },
  { value: 'import_nasiya', label: 'Eski nasiya import' },
  { value: 'customer', label: 'Mijozlar' },
  { value: 'settings', label: 'Sozlamalar' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'account', label: 'Admin/account' },
]

export function isLogCategory(value: string | null | undefined): value is LogCategory {
  return Boolean(value && logCategoryOptions.some((option) => option.value === value))
}

export function logCategoryLabel(category: LogCategory) {
  return logCategoryOptions.find((option) => option.value === category)?.label ?? 'Barchasi'
}

export function logCategoryFor(action: string, targetType: string): LogCategory {
  if (action === 'IMPORT_NASIYA') return 'import_nasiya'
  if (targetType === 'Nasiya' || targetType === 'NasiyaSchedule') return action === 'PAYMENT' ? 'payment' : 'nasiya'
  if (targetType === 'Sale') return action === 'PAYMENT' ? 'payment' : 'sale'
  if (targetType === 'Device') {
    if (action === 'SELL') return 'sale'
    if (action === 'RETURN') return 'return'
    if (action === 'RESTOCK') return 'restock'
    return 'device'
  }
  if (targetType === 'Customer') return 'customer'
  if (targetType === 'Shop') return 'settings'
  if (targetType === 'ShopAdmin') {
    if (action === 'UPDATE_TELEGRAM_ID') return 'telegram'
    return 'account'
  }
  if (action.includes('TELEGRAM')) return 'telegram'
  if (action === 'PAYMENT' || action === 'PAY_SUBSCRIPTION') return 'payment'
  return 'settings'
}

export function logCategoryWhere(category: LogCategory) {
  if (category === 'all') return {}
  const pairs = logCategoryPairs[category]
  return {
    OR: pairs.map((pair) => ({
      ...(pair.action ? { action: pair.action } : {}),
      ...(pair.targetType ? { targetType: pair.targetType } : {}),
    })),
  }
}

const logCategoryPairs: Record<Exclude<LogCategory, 'all'>, Array<{ action?: string; targetType?: string }>> = {
  nasiya: [
    { targetType: 'Nasiya' },
    { targetType: 'NasiyaSchedule' },
  ],
  sale: [
    { action: 'SELL', targetType: 'Device' },
    { targetType: 'Sale' },
  ],
  device: [
    { action: 'CREATE', targetType: 'Device' },
    { action: 'UPDATE', targetType: 'Device' },
    { action: 'DELETE', targetType: 'Device' },
  ],
  payment: [
    { action: 'PAYMENT', targetType: 'Sale' },
    { action: 'PAYMENT', targetType: 'NasiyaSchedule' },
    { action: 'PAY_SUBSCRIPTION', targetType: 'Shop' },
  ],
  return: [{ action: 'RETURN', targetType: 'Device' }],
  restock: [{ action: 'RESTOCK', targetType: 'Device' }],
  import_nasiya: [{ action: 'IMPORT_NASIYA', targetType: 'Nasiya' }],
  customer: [
    { targetType: 'Customer' },
    { action: 'IMPORT', targetType: 'Customer' },
  ],
  settings: [
    { targetType: 'Shop' },
    { action: 'UPDATE_REMINDER' },
  ],
  telegram: [{ action: 'UPDATE_TELEGRAM_ID', targetType: 'ShopAdmin' }],
  account: [
    { targetType: 'ShopAdmin' },
    { action: 'CHANGE_PASSWORD', targetType: 'ShopAdmin' },
  ],
}
