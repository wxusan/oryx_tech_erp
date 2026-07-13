import type { Prisma } from '@/generated/prisma/client'

/**
 * Log history is useful to a staff member only when it remains a history of
 * operational events. These keys disclose the shop's cost basis, margin, or
 * return-accounting ledger and must never cross a SHOP_STAFF response/cache
 * boundary. Individual sale/payment amounts intentionally remain: a worker
 * authorized to collect a payment needs to understand that specific event.
 */
const OWNER_FINANCIAL_LOG_KEYS = new Set([
  'purchaseprice',
  'purchasecurrency',
  'purchaseinputamount',
  'purchaseexchangerateatcreation',
  'purchaseamountuzssnapshot',
  'contractpurchaseprice',
  'profit',
  'contractprofit',
  'grossprofit',
  'netprofit',
  'margin',
  'inventorycostrecoveryuzs',
  'revenuereversalamountuzs',
  'retainedvalueamountuzs',
  'interestreversalamountuzs',
  'profitadjustmentuzs',
  'contractreceiptsatreturn',
  'contractretainedamount',
  'contractcancelleddebt',
])

function isOwnerFinancialLogKey(key: string) {
  return OWNER_FINANCIAL_LOG_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())
}

/**
 * Deep, non-mutating redaction for JSON stored in Log.newValue/oldValue.
 * Omit fields rather than replacing them with zero/null: a sentinel value
 * can be mistaken for an actual accounting result and would be retained by a
 * client-side cache after role changes.
 */
export function redactShopStaffLogValue(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactShopStaffLogValue(item))

  const safeValue: Record<string, Prisma.JsonValue> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isOwnerFinancialLogKey(key)) continue
    safeValue[key] = redactShopStaffLogValue(nestedValue as Prisma.JsonValue) as Prisma.JsonValue
  }
  return safeValue
}
