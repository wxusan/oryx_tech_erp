import { hasValidMinorUnits, type CurrencyCode } from '@/lib/currency'

export const SHOP_FEATURE_CODES = [
  'INVENTORY',
  'CASH_SALES',
  'NASIYA',
  'OLIB_SOTDIM',
  'CUSTOMER_CRM',
  'TELEGRAM',
  'REMINDERS',
  'REPORTS',
  'IMPORTS',
  'EXPORTS',
  'STAFF_ACCESS',
] as const

export type ShopFeatureCode = (typeof SHOP_FEATURE_CODES)[number]

export interface ShopFeatureCatalogItem {
  code: ShopFeatureCode
  label: string
  description: string
  billable: boolean
  prerequisites: readonly ShopFeatureCode[]
}

export const SHOP_FEATURE_CATALOG: readonly ShopFeatureCatalogItem[] = [
  { code: 'INVENTORY', label: 'Qurilmalar va ombor', description: 'Qurilma kiritish, tahrirlash va ombor holati', billable: true, prerequisites: [] },
  { code: 'CASH_SALES', label: 'Naqd savdo va Qarz', description: "Naqd, aralash va keyinroq to'lanadigan savdolar", billable: true, prerequisites: ['INVENTORY'] },
  { code: 'NASIYA', label: 'Nasiya', description: "Nasiya shartnomalari, jadvallar va to'lovlar", billable: true, prerequisites: ['INVENTORY'] },
  { code: 'OLIB_SOTDIM', label: 'Olib-sotdim', description: "Boshqa do'kondan olib mijozga sotish", billable: true, prerequisites: ['INVENTORY', 'CASH_SALES'] },
  { code: 'CUSTOMER_CRM', label: 'Mijozlar va ishonch', description: "Mijoz profili, tarix va ishonch ko'rsatkichlari", billable: true, prerequisites: [] },
  { code: 'TELEGRAM', label: 'Telegram', description: 'Telegram bildirishnomalari', billable: true, prerequisites: [] },
  { code: 'REMINDERS', label: 'Eslatmalar', description: "To'lov va muddat eslatmalari", billable: true, prerequisites: ['TELEGRAM'] },
  { code: 'REPORTS', label: 'Hisobotlar', description: 'Moliyaviy va operatsion hisobotlar', billable: true, prerequisites: [] },
  { code: 'IMPORTS', label: 'Import', description: "Eski ma'lumotlarni boshqariladigan import qilish", billable: true, prerequisites: [] },
  { code: 'EXPORTS', label: 'Eksport', description: "Ma'lumotlarni faylga chiqarish", billable: true, prerequisites: [] },
  {
    code: 'STAFF_ACCESS',
    label: 'Xodimlar profili',
    description: "Do'kon egasidan tashqari xodim profillari",
    billable: false,
    prerequisites: [],
  },
] as const

const featureByCode = new Map(SHOP_FEATURE_CATALOG.map((item) => [item.code, item]))

export function isShopFeatureCode(value: unknown): value is ShopFeatureCode {
  return typeof value === 'string' && featureByCode.has(value as ShopFeatureCode)
}

export const SHOP_PERMISSION_CODES = [
  'INVENTORY_VIEW',
  'INVENTORY_MANAGE',
  'CASH_SALE_CREATE',
  'CASH_SALE_MANAGE',
  'NASIYA_VIEW',
  'NASIYA_CREATE',
  'NASIYA_MANAGE',
  'OLIB_VIEW',
  'OLIB_MANAGE',
  'PAYMENT_RECEIVE',
  'CUSTOMER_VIEW',
  'CUSTOMER_MANAGE',
  'CUSTOMER_PII_REVEAL',
  'RETURN_MANAGE',
  'WRITEOFF_MANAGE',
  'REPORT_VIEW',
  'EXPORT_DATA',
  'IMPORT_DATA',
  'LOG_VIEW',
  'SETTINGS_MANAGE',
  'MEMBER_MANAGE',
  'TELEGRAM_MANAGE',
] as const

export type ShopPermissionCode = (typeof SHOP_PERMISSION_CODES)[number]
export type ShopMemberKind = 'SHOP_OWNER' | 'SHOP_STAFF'

export interface ShopPermissionCatalogItem {
  code: ShopPermissionCode
  label: string
  featureCode: ShopFeatureCode | null
  ownerOnly: boolean
}

export const SHOP_PERMISSION_CATALOG: readonly ShopPermissionCatalogItem[] = [
  { code: 'INVENTORY_VIEW', label: "Omborni ko'rish", featureCode: 'INVENTORY', ownerOnly: false },
  { code: 'INVENTORY_MANAGE', label: 'Omborni boshqarish', featureCode: 'INVENTORY', ownerOnly: false },
  { code: 'CASH_SALE_CREATE', label: 'Naqd savdo qilish', featureCode: 'CASH_SALES', ownerOnly: false },
  { code: 'CASH_SALE_MANAGE', label: 'Sotuv ma\'lumotlarini boshqarish', featureCode: 'CASH_SALES', ownerOnly: false },
  { code: 'NASIYA_VIEW', label: "Nasiyalarni ko'rish", featureCode: 'NASIYA', ownerOnly: false },
  { code: 'NASIYA_CREATE', label: 'Nasiya yaratish', featureCode: 'NASIYA', ownerOnly: false },
  { code: 'NASIYA_MANAGE', label: 'Nasiya ma\'lumotlarini boshqarish', featureCode: 'NASIYA', ownerOnly: false },
  { code: 'OLIB_VIEW', label: "Olib-sotdimni ko'rish", featureCode: 'OLIB_SOTDIM', ownerOnly: false },
  { code: 'OLIB_MANAGE', label: 'Olib-sotdim qilish', featureCode: 'OLIB_SOTDIM', ownerOnly: false },
  { code: 'PAYMENT_RECEIVE', label: "To'lov qabul qilish", featureCode: null, ownerOnly: false },
  { code: 'CUSTOMER_VIEW', label: "Mijozlarni ko'rish", featureCode: 'CUSTOMER_CRM', ownerOnly: false },
  { code: 'CUSTOMER_MANAGE', label: 'Mijozlarni boshqarish', featureCode: 'CUSTOMER_CRM', ownerOnly: false },
  { code: 'CUSTOMER_PII_REVEAL', label: "Pasport raqamini to'liq ko'rish", featureCode: 'CUSTOMER_CRM', ownerOnly: true },
  { code: 'RETURN_MANAGE', label: 'Qaytarishni boshqarish', featureCode: 'INVENTORY', ownerOnly: true },
  // Never inherited through legacyFullAccess (see principalCan), but an owner
  // may deliberately grant it to a specific staff member.
  { code: 'WRITEOFF_MANAGE', label: 'Qarzni yopish va arxivlash', featureCode: 'NASIYA', ownerOnly: false },
  { code: 'REPORT_VIEW', label: "Hisobotlarni ko'rish", featureCode: 'REPORTS', ownerOnly: true },
  { code: 'EXPORT_DATA', label: 'Eksport qilish', featureCode: 'EXPORTS', ownerOnly: true },
  { code: 'IMPORT_DATA', label: 'Import qilish', featureCode: 'IMPORTS', ownerOnly: true },
  { code: 'LOG_VIEW', label: "Loglarni ko'rish", featureCode: null, ownerOnly: true },
  { code: 'SETTINGS_MANAGE', label: "Do'kon sozlamalarini boshqarish", featureCode: null, ownerOnly: true },
  { code: 'MEMBER_MANAGE', label: 'Xodimlarni boshqarish', featureCode: 'STAFF_ACCESS', ownerOnly: true },
  { code: 'TELEGRAM_MANAGE', label: 'Telegram sozlamalarini boshqarish', featureCode: 'TELEGRAM', ownerOnly: true },
] as const

const permissionByCode = new Map(SHOP_PERMISSION_CATALOG.map((item) => [item.code, item]))

export function isShopPermissionCode(value: unknown): value is ShopPermissionCode {
  return typeof value === 'string' && permissionByCode.has(value as ShopPermissionCode)
}

export function shopMemberKind(input: { memberId: string; ownerAdminId: string | null }): ShopMemberKind {
  return input.ownerAdminId === input.memberId ? 'SHOP_OWNER' : 'SHOP_STAFF'
}

export interface PackageFeatureInput {
  featureCode: ShopFeatureCode
  enabled: boolean
  recurringPrice: number | string
}

export interface PackagePriceInput {
  basePrice: number | string
  discountAmount: number | string
  currency: CurrencyCode
  features: readonly PackageFeatureInput[]
}

export interface PackagePriceBreakdown {
  basePrice: number
  addOnPrice: number
  discountAmount: number
  recurringPrice: number
  staffAccessPrice: 0
}

function exactMinorUnits(value: number | string, currency: CurrencyCode, field: string): bigint {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!hasValidMinorUnits(parsed, currency)) {
    throw new Error(`${field} valyuta aniqligiga mos emas`)
  }
  const scale = currency === 'USD' ? 100 : 1
  return BigInt(Math.round(parsed * scale))
}

function fromMinorUnits(value: bigint, currency: CurrencyCode) {
  return Number(value) / (currency === 'USD' ? 100 : 1)
}

export function validateCompletePackageFeatures(features: readonly PackageFeatureInput[]) {
  const codes = features.map((item) => item.featureCode)
  if (codes.length !== SHOP_FEATURE_CODES.length || new Set(codes).size !== SHOP_FEATURE_CODES.length) {
    throw new Error("Paket har bir modul uchun aynan bitta to'liq holatni saqlashi kerak")
  }
  if (SHOP_FEATURE_CODES.some((code) => !codes.includes(code))) {
    throw new Error("Paketda barcha modullar ko'rsatilishi kerak")
  }

  const enabled = new Set(features.filter((item) => item.enabled).map((item) => item.featureCode))
  for (const item of SHOP_FEATURE_CATALOG) {
    if (!enabled.has(item.code)) continue
    const missing = item.prerequisites.filter((code) => !enabled.has(code))
    if (missing.length) {
      throw new Error(`${item.label} uchun avval ${missing.map((code) => featureByCode.get(code)?.label ?? code).join(', ')} yoqilishi kerak`)
    }
  }
}

/**
 * Calculate one shop-wide recurring package price in exact minor units.
 * STAFF_ACCESS is deliberately excluded even if a caller submits a non-zero
 * value; that invalid value is rejected so the UI and server cannot disagree.
 */
export function calculateRecurringPackagePrice(input: PackagePriceInput): PackagePriceBreakdown {
  validateCompletePackageFeatures(input.features)
  const base = exactMinorUnits(input.basePrice, input.currency, 'Asosiy narx')
  const discount = exactMinorUnits(input.discountAmount, input.currency, 'Chegirma')
  let addOns = BigInt(0)

  for (const item of input.features) {
    const catalog = featureByCode.get(item.featureCode)!
    const price = exactMinorUnits(item.recurringPrice, input.currency, catalog.label)
    if (!catalog.billable && price !== BigInt(0)) {
      throw new Error(`${catalog.label} paket narxiga kiritilmaydi va narxi 0 bo'lishi shart`)
    }
    if (item.enabled && catalog.billable) addOns += price
  }

  const subtotal = base + addOns
  if (discount > subtotal) throw new Error("Chegirma paketning oylik narxidan oshmasligi kerak")
  const total = subtotal - discount

  return {
    basePrice: fromMinorUnits(base, input.currency),
    addOnPrice: fromMinorUnits(addOns, input.currency),
    discountAmount: fromMinorUnits(discount, input.currency),
    recurringPrice: fromMinorUnits(total, input.currency),
    staffAccessPrice: 0,
  }
}

export interface ShopPrincipalAccess {
  memberKind: ShopMemberKind
  legacyFullAccess: boolean
  enabledFeatures: ReadonlySet<ShopFeatureCode>
  grantedPermissions: ReadonlySet<ShopPermissionCode>
}

export function principalCan(principal: ShopPrincipalAccess, permission: ShopPermissionCode) {
  const definition = permissionByCode.get(permission)
  if (!definition) return false
  if (definition.featureCode && !principal.enabledFeatures.has(definition.featureCode)) return false
  if (principal.memberKind === 'SHOP_OWNER') return true
  // Migrated unresolved shops retain their pre-RBAC operational capability
  // until an owner explicitly saves a permission set. Keep this compatibility
  // before the new owner-only split, while never inheriting newly introduced
  // member-management or debt-write-off powers.
  if (principal.legacyFullAccess) return permission !== 'MEMBER_MANAGE' && permission !== 'WRITEOFF_MANAGE'
  if (definition.ownerOnly) return false
  return principal.grantedPermissions.has(permission)
}
