export type LogCategory =
  | 'all'
  | 'nasiya'
  | 'nasiya_payment'
  | 'sale'
  | 'device'
  | 'payment'
  | 'supplier_payment'
  | 'return'
  | 'import_nasiya'
  | 'customer'
  | 'settings'
  | 'telegram'
  | 'account'

export const logCategoryOptions: { value: LogCategory; label: string }[] = [
  { value: 'all', label: 'Barchasi' },
  { value: 'nasiya', label: 'Nasiya' },
  { value: 'nasiya_payment', label: "Nasiya to'lovlari" },
  { value: 'sale', label: 'Sotuv' },
  { value: 'device', label: 'Yangi mahsulot' },
  { value: 'payment', label: "Sotuv to'lovlari" },
  { value: 'supplier_payment', label: "Yetkazib beruvchi to'lovi" },
  { value: 'return', label: 'Qaytarish' },
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

/**
 * Item 11 — nasiya creation/edit/completion/deferral/reminder actions are a
 * distinct category from nasiya PAYMENT actions (previously both lumped
 * under a single "Nasiya" bucket that also silently mixed in payments, and
 * separately, a generic "To'lovlar" bucket that mixed nasiya, sale, and
 * subscription payments together with no way to filter just one kind).
 */
export function logCategoryFor(action: string, targetType: string): LogCategory {
  if (action === 'IMPORT_NASIYA') return 'import_nasiya'
  if (targetType === 'Nasiya') return 'nasiya'
  // NasiyaSchedule is only ever used for the PAYMENT and NASIYA_DEFER
  // actions (see nasiya/[id]/payment/route.ts) — deferring a schedule is a
  // nasiya-management action, not a payment, so it stays in 'nasiya'.
  if (targetType === 'NasiyaSchedule') return action === 'PAYMENT' ? 'nasiya_payment' : 'nasiya'
  if (targetType === 'Sale') return action === 'PAYMENT' ? 'payment' : 'sale'
  if (targetType === 'SupplierPayable') return 'supplier_payment'
  if (targetType === 'Device') {
    if (action === 'SELL') return 'sale'
    if (action === 'RETURN') return 'return'
    // RESTOCK remains an immutable audit event, but it is deliberately
    // excluded from every shop-facing log query. This fallback prevents a
    // stale cached record from creating a now-removed presentation category.
    if (action === 'RESTOCK') return 'device'
    return 'device'
  }
  if (targetType === 'Customer') return 'customer'
  if (targetType === 'Shop') return 'settings'
  if (targetType === 'ShopAdmin') {
    if (action === 'UPDATE_TELEGRAM_ID') return 'telegram'
    return 'account'
  }
  if (action.includes('TELEGRAM')) return 'telegram'
  if (action === 'PAY_SUBSCRIPTION') return 'payment'
  if (action === 'PAYMENT') return 'payment'
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
    { action: 'NASIYA_DEFER', targetType: 'NasiyaSchedule' },
  ],
  nasiya_payment: [{ action: 'PAYMENT', targetType: 'NasiyaSchedule' }],
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
    { action: 'PAY_SUBSCRIPTION', targetType: 'Shop' },
  ],
  supplier_payment: [{ targetType: 'SupplierPayable' }],
  return: [{ action: 'RETURN', targetType: 'Device' }],
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
