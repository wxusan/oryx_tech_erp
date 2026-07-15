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

export const ACTIVE_SHOP_PERMISSION_CODES = [
  'INVENTORY_VIEW',
  'DEVICE_CREATE',
  'DEVICE_EDIT',
  'DEVICE_DELETE',
  'DEVICE_RESTOCK',
  'SALE_VIEW',
  'SALE_CREATE',
  'SALE_EDIT',
  'SALE_PAYMENT_RECEIVE',
  'SALE_REMINDER_MANAGE',
  'SALE_RETURN_REFUND',
  'RECEIVABLES_VIEW',
  'NASIYA_VIEW',
  'NASIYA_CREATE',
  'NASIYA_EDIT',
  'NASIYA_PAYMENT_RECEIVE',
  'NASIYA_DEFER',
  'NASIYA_REMINDER_MANAGE',
  'NASIYA_CANCEL',
  'NASIYA_ARCHIVE',
  'NASIYA_WRITE_OFF',
  'NASIYA_REOPEN',
  'OLIB_VIEW',
  'OLIB_CREATE',
  'SUPPLIER_PAYMENT_MARK_PAID',
  'CUSTOMER_VIEW',
  'CUSTOMER_CREATE',
  'CUSTOMER_EDIT',
  'CUSTOMER_PASSPORT_PHOTO_VIEW',
  'CUSTOMER_PASSPORT_REVEAL',
  'CUSTOMER_PASSPORT_MANAGE',
  'CUSTOMER_TRUST_OVERRIDE',
  'DASHBOARD_OPERATIONAL_VIEW',
  'DASHBOARD_FINANCIAL_VIEW',
  'REPORT_VIEW',
  'LOG_VIEW',
  'IMPORT_CUSTOMERS',
  'IMPORT_OLD_NASIYA',
  'EXPORT_DEVICES',
  'EXPORT_CUSTOMERS',
  'EXPORT_SALES',
  'EXPORT_NASIYA',
  'EXPORT_OLIB',
  'EXPORT_RETURNS',
  'EXPORT_LOGS',
  'EXPORT_REPORTS',
  'STAFF_VIEW',
  'STAFF_CREATE',
  'STAFF_EDIT_PROFILE',
  'STAFF_RESET_PASSWORD',
  'STAFF_STATUS_MANAGE',
  'STAFF_DELETE',
  'STAFF_PERMISSION_MANAGE',
  'STAFF_NOTIFICATION_MANAGE',
  'SHOP_PROFILE_EDIT',
  'SHOP_CURRENCY_MANAGE',
  'SHOP_TELEGRAM_MANAGE',
] as const

export const RETIRED_SHOP_PERMISSION_CODES = [
  'INVENTORY_MANAGE',
  'CASH_SALE_CREATE',
  'CASH_SALE_MANAGE',
  'NASIYA_MANAGE',
  'OLIB_MANAGE',
  'PAYMENT_RECEIVE',
  'CUSTOMER_MANAGE',
  'CUSTOMER_PII_REVEAL',
  'RETURN_MANAGE',
  'WRITEOFF_MANAGE',
  'EXPORT_DATA',
  'IMPORT_DATA',
  'SETTINGS_MANAGE',
  'MEMBER_MANAGE',
  'TELEGRAM_MANAGE',
] as const

export const SHOP_PERMISSION_CODES = [
  ...ACTIVE_SHOP_PERMISSION_CODES,
  ...RETIRED_SHOP_PERMISSION_CODES,
] as const

export type ActiveShopPermissionCode = (typeof ACTIVE_SHOP_PERMISSION_CODES)[number]
export type RetiredShopPermissionCode = (typeof RETIRED_SHOP_PERMISSION_CODES)[number]
export type ShopPermissionCode = (typeof SHOP_PERMISSION_CODES)[number]
export type ShopMemberKind = 'SHOP_OWNER' | 'SHOP_STAFF'
export type ShopPermissionRisk = 'ROUTINE' | 'FINANCIAL' | 'PRIVATE' | 'DESTRUCTIVE' | 'ADMINISTRATIVE'
export type ShopPermissionGroup =
  | 'INVENTORY'
  | 'SALES'
  | 'NASIYA'
  | 'OLIB'
  | 'CUSTOMERS'
  | 'INSIGHTS'
  | 'DATA'
  | 'STAFF'
  | 'SETTINGS'

export interface ShopPermissionCatalogItem {
  code: ShopPermissionCode
  label: string
  description: string
  featureCode: ShopFeatureCode | null
  ownerOnly: boolean
  retired: boolean
  group: ShopPermissionGroup
  risk: ShopPermissionRisk
  staffManagerDelegable: boolean
  legacyOperational: boolean
}

export const SHOP_PERMISSION_CATALOG: readonly ShopPermissionCatalogItem[] = [
  { code: 'INVENTORY_VIEW', label: "Qurilmalarni ko'rish", description: "Ombor ro'yxati va qurilma tafsilotlari", featureCode: 'INVENTORY', ownerOnly: false, retired: false, group: 'INVENTORY', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'DEVICE_CREATE', label: "Qurilma qo'shish", description: "Yangi qurilma va rasmlarini omborga kiritish", featureCode: 'INVENTORY', ownerOnly: false, retired: false, group: 'INVENTORY', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'DEVICE_EDIT', label: 'Qurilmani tahrirlash', description: "Mavjud qurilma ma'lumotlarini o'zgartirish", featureCode: 'INVENTORY', ownerOnly: false, retired: false, group: 'INVENTORY', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'DEVICE_DELETE', label: "Sotilmagan qurilmani o'chirish", description: "Moliyaviy tarixsiz qurilmani sabab bilan o'chirish", featureCode: 'INVENTORY', ownerOnly: false, retired: false, group: 'INVENTORY', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: true },
  { code: 'DEVICE_RESTOCK', label: 'Qurilmani omborga qaytarish', description: 'Qaytarilgan qurilmani qayta omborga kiritish', featureCode: 'INVENTORY', ownerOnly: false, retired: false, group: 'INVENTORY', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'SALE_VIEW', label: "Sotuvlarni ko'rish", description: "Naqd va qarz sotuvlarni ko'rish", featureCode: 'CASH_SALES', ownerOnly: false, retired: false, group: 'SALES', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'SALE_CREATE', label: 'Sotuv qilish', description: 'Qurilmani naqd, aralash yoki qarzga sotish', featureCode: 'CASH_SALES', ownerOnly: false, retired: false, group: 'SALES', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'SALE_EDIT', label: 'Sotuvni tahrirlash', description: "Sotuvning ruxsat etilgan ma'lumotlarini o'zgartirish", featureCode: 'CASH_SALES', ownerOnly: false, retired: false, group: 'SALES', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'SALE_PAYMENT_RECEIVE', label: "Sotuv to'lovini qabul qilish", description: "Qarz sotuv bo'yicha kirim to'lovini yozish", featureCode: 'CASH_SALES', ownerOnly: false, retired: false, group: 'SALES', risk: 'FINANCIAL', staffManagerDelegable: true, legacyOperational: true },
  { code: 'SALE_REMINDER_MANAGE', label: 'Sotuv eslatmalarini boshqarish', description: "Qarz sotuv eslatmasini yoqish yoki o'chirish", featureCode: 'CASH_SALES', ownerOnly: false, retired: false, group: 'SALES', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'SALE_RETURN_REFUND', label: 'Sotuvni qaytarish va pulni qaytarish', description: "Sotuvni bekor qilish va yig'ilgan pul chegarasida refund", featureCode: 'CASH_SALES', ownerOnly: false, retired: false, group: 'SALES', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'RECEIVABLES_VIEW', label: "Muddatli va kechikkan qarzlarni ko'rish", description: "To'lov vakolatisiz qarzdorlik navbatini ko'rish", featureCode: null, ownerOnly: false, retired: false, group: 'SALES', risk: 'FINANCIAL', staffManagerDelegable: true, legacyOperational: false },
  { code: 'NASIYA_VIEW', label: "Nasiyalarni ko'rish", description: "Nasiya ro'yxati va tafsilotlarini ko'rish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'NASIYA_CREATE', label: 'Nasiya yaratish', description: 'Yangi nasiya shartnomasi va jadvalini yaratish', featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'NASIYA_EDIT', label: 'Nasiyani tahrirlash', description: "Nasiya ruxsat etilgan ma'lumotlarini o'zgartirish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'NASIYA_PAYMENT_RECEIVE', label: "Nasiya to'lovini qabul qilish", description: "Nasiya jadvali bo'yicha kirim to'lovini yozish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'FINANCIAL', staffManagerDelegable: true, legacyOperational: true },
  { code: 'NASIYA_DEFER', label: "Nasiya to'lovini kechiktirish", description: "Bitta jadval sanasini idempotent tarzda ko'chirish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'FINANCIAL', staffManagerDelegable: true, legacyOperational: true },
  { code: 'NASIYA_REMINDER_MANAGE', label: 'Nasiya eslatmalarini boshqarish', description: "Nasiya eslatmasini yoqish yoki o'chirish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'NASIYA_CANCEL', label: 'Nasiyani bekor qilish', description: "Mos nasiyani xavfsiz qaytarish/refund hisobi bilan bekor qilish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'NASIYA_ARCHIVE', label: 'Nasiyani arxivlash mumkin', description: 'Xodimga nasiyani arxivlash va qayta ochish ruxsatini beradi', featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'NASIYA_WRITE_OFF', label: 'Nasiya qarzini hisobdan chiqarish', description: "Qoldiq qarzni o'zgarmas hodisa bilan yopish", featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'NASIYA_REOPEN', label: 'Nasiyani qayta ochish', description: 'Arxivlangan yoki yopilgan nasiyani qayta ochish', featureCode: 'NASIYA', ownerOnly: false, retired: false, group: 'NASIYA', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'OLIB_VIEW', label: "Olib-sotdimni ko'rish", description: "Olib-sotdim ro'yxati va tafsilotlari", featureCode: 'OLIB_SOTDIM', ownerOnly: false, retired: false, group: 'OLIB', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'OLIB_CREATE', label: 'Olib-sotdim qilish', description: "Tashqi qurilma, yetkazuvchi va mijoz sotuvini yozish", featureCode: 'OLIB_SOTDIM', ownerOnly: false, retired: false, group: 'OLIB', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'SUPPLIER_PAYMENT_MARK_PAID', label: "Yetkazuvchiga to'lovni yopish", description: "Chiqim yetkazuvchi to'lovini to'langan deb yozish", featureCode: 'OLIB_SOTDIM', ownerOnly: false, retired: false, group: 'OLIB', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: true },
  { code: 'CUSTOMER_VIEW', label: "Mijozlarni ko'rish", description: "Mijoz ro'yxati va xodimga xavfsiz profil", featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'CUSTOMER_CREATE', label: "Mijoz qo'shish", description: 'Alohida mijoz profilini yaratish', featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'CUSTOMER_EDIT', label: 'Mijozni tahrirlash', description: "Mijozning asosiy aloqa ma'lumotlarini o'zgartirish", featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: true },
  { code: 'CUSTOMER_PASSPORT_PHOTO_VIEW', label: "Pasport rasmini ko'rish", description: "Bitta mijozning yopiq pasport rasmini ko'rish", featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: true },
  { code: 'CUSTOMER_PASSPORT_REVEAL', label: "Pasport raqamini to'liq ko'rish", description: "Shifrlangan pasport raqamini audit bilan ochish", featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'CUSTOMER_PASSPORT_MANAGE', label: 'Pasport ma\'lumotlarini boshqarish', description: "Pasport raqami yoki rasmini qo'shish, almashtirish, o'chirish", featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: true },
  { code: 'CUSTOMER_TRUST_OVERRIDE', label: "Mijoz ishonch darajasini o'zgartirish", description: "Qo'lda ishonch darajasini belgilash yoki tozalash", featureCode: 'CUSTOMER_CRM', ownerOnly: false, retired: false, group: 'CUSTOMERS', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: true },
  { code: 'DASHBOARD_OPERATIONAL_VIEW', label: "Operatsion statistikani ko'rish", description: "Moliyaviy bo'lmagan sonlar va ish holati", featureCode: 'REPORTS', ownerOnly: false, retired: false, group: 'INSIGHTS', risk: 'ROUTINE', staffManagerDelegable: true, legacyOperational: false },
  { code: 'DASHBOARD_FINANCIAL_VIEW', label: "Moliyaviy statistikani ko'rish", description: "Tushum, foyda, tannarx va refund ko'rsatkichlari", featureCode: 'REPORTS', ownerOnly: false, retired: false, group: 'INSIGHTS', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'REPORT_VIEW', label: "Tarixiy hisobotlarni ko'rish", description: "Oy, oraliq va xodim filtrlari bilan hisobotlar", featureCode: 'REPORTS', ownerOnly: false, retired: false, group: 'INSIGHTS', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'LOG_VIEW', label: "Faoliyat loglarini ko'rish", description: "Audit jurnalining xodimga xavfsiz ko'rinishi", featureCode: null, ownerOnly: false, retired: false, group: 'INSIGHTS', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: true },
  { code: 'IMPORT_CUSTOMERS', label: 'Mijozlarni import qilish', description: 'Mijoz ma\'lumotlarini boshqariladigan import qilish', featureCode: 'IMPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'IMPORT_OLD_NASIYA', label: 'Eski nasiyalarni import qilish', description: 'Oldingi nasiya qoldiqlarini xavfsiz import qilish', featureCode: 'IMPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_DEVICES', label: 'Qurilmalarni eksport qilish', description: 'Qurilma eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_CUSTOMERS', label: 'Mijozlarni eksport qilish', description: 'Mijoz eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_SALES', label: 'Sotuvlarni eksport qilish', description: 'Sotuv eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_NASIYA', label: 'Nasiyalarni eksport qilish', description: 'Nasiya eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_OLIB', label: 'Olib-sotdimni eksport qilish', description: 'Olib-sotdim eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_RETURNS', label: 'Qaytarishlarni eksport qilish', description: 'Qaytarish va refund eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_LOGS', label: 'Loglarni eksport qilish', description: 'Audit log eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'PRIVATE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_REPORTS', label: 'Hisobotlarni eksport qilish', description: 'Moliyaviy hisobot eksport faylini olish', featureCode: 'EXPORTS', ownerOnly: false, retired: false, group: 'DATA', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_VIEW', label: "Xodimlarni ko'rish", description: "Do'kon egasidan tashqari xodimlar ro'yxati", featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_CREATE', label: "Xodim qo'shish", description: 'Yangi xodim profilini ruxsatsiz holatda yaratish', featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_EDIT_PROFILE', label: "Xodim ma'lumotlarini tahrirlash", description: "Xodim ism va telefonini o'zgartirish", featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_RESET_PASSWORD', label: 'Xodim parolini tiklash', description: "Yangi parol o'rnatish va sessiyalarni bekor qilish", featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_STATUS_MANAGE', label: 'Xodimni faollashtirish yoki bloklash', description: 'Xodim faol holatini boshqarish', featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_DELETE', label: "Xodimni o'chirish", description: "Xodimni sabab bilan yumshoq o'chirish", featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'DESTRUCTIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_PERMISSION_MANAGE', label: 'Xodim ruxsatlarini boshqarish', description: 'Boshqa xodimga faqat oddiy ruxsatlarni berish', featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'STAFF_NOTIFICATION_MANAGE', label: 'Xodim Telegram xabarlarini boshqarish', description: "Boshqa xodimning Telegram qabul qilish huquqini yoqish yoki o'chirish", featureCode: 'STAFF_ACCESS', ownerOnly: false, retired: false, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'SHOP_PROFILE_EDIT', label: "Do'kon ma'lumotlarini tahrirlash", description: "Do'kon nomi, egasi va aloqa ma'lumotlari", featureCode: null, ownerOnly: false, retired: false, group: 'SETTINGS', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'SHOP_CURRENCY_MANAGE', label: "Do'kon valyutasini boshqarish", description: "Do'kon ko'rsatish valyutasini o'zgartirish", featureCode: null, ownerOnly: false, retired: false, group: 'SETTINGS', risk: 'FINANCIAL', staffManagerDelegable: false, legacyOperational: false },
  { code: 'SHOP_TELEGRAM_MANAGE', label: "Do'kon Telegramini boshqarish", description: "Do'kon bo'yicha Telegram master holatini o'zgartirish", featureCode: 'TELEGRAM', ownerOnly: false, retired: false, group: 'SETTINGS', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'INVENTORY_MANAGE', label: 'Eski ombor boshqaruvi', description: 'V2 ruxsatlariga almashtirilgan', featureCode: 'INVENTORY', ownerOnly: true, retired: true, group: 'INVENTORY', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'CASH_SALE_CREATE', label: 'Eski sotuv yaratish', description: 'SALE_CREATE bilan almashtirilgan', featureCode: 'CASH_SALES', ownerOnly: true, retired: true, group: 'SALES', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'CASH_SALE_MANAGE', label: 'Eski sotuv boshqaruvi', description: 'V2 ruxsatlariga almashtirilgan', featureCode: 'CASH_SALES', ownerOnly: true, retired: true, group: 'SALES', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'NASIYA_MANAGE', label: 'Eski nasiya boshqaruvi', description: 'V2 ruxsatlariga almashtirilgan', featureCode: 'NASIYA', ownerOnly: true, retired: true, group: 'NASIYA', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'OLIB_MANAGE', label: 'Eski olib-sotdim boshqaruvi', description: 'OLIB_CREATE bilan almashtirilgan', featureCode: 'OLIB_SOTDIM', ownerOnly: true, retired: true, group: 'OLIB', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'PAYMENT_RECEIVE', label: "Eski umumiy to'lov ruxsati", description: "Kirim va chiqim to'lov ruxsatlariga ajratilgan", featureCode: null, ownerOnly: true, retired: true, group: 'SALES', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'CUSTOMER_MANAGE', label: 'Eski mijoz boshqaruvi', description: 'V2 ruxsatlariga almashtirilgan', featureCode: 'CUSTOMER_CRM', ownerOnly: true, retired: true, group: 'CUSTOMERS', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'CUSTOMER_PII_REVEAL', label: 'Eski pasport ochish', description: 'CUSTOMER_PASSPORT_REVEAL bilan almashtirilgan', featureCode: 'CUSTOMER_CRM', ownerOnly: true, retired: true, group: 'CUSTOMERS', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'RETURN_MANAGE', label: 'Eski qaytarish boshqaruvi', description: 'Sotuv va nasiya ruxsatlariga ajratilgan', featureCode: 'INVENTORY', ownerOnly: true, retired: true, group: 'SALES', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'WRITEOFF_MANAGE', label: 'Eski qarz yopish boshqaruvi', description: 'Arxiv, hisobdan chiqarish va qayta ochishga ajratilgan', featureCode: 'NASIYA', ownerOnly: true, retired: true, group: 'NASIYA', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'EXPORT_DATA', label: 'Eski umumiy eksport', description: 'Har bir eksport turiga ajratilgan', featureCode: 'EXPORTS', ownerOnly: true, retired: true, group: 'DATA', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'IMPORT_DATA', label: 'Eski umumiy import', description: 'Har bir import turiga ajratilgan', featureCode: 'IMPORTS', ownerOnly: true, retired: true, group: 'DATA', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'SETTINGS_MANAGE', label: 'Eski sozlamalar boshqaruvi', description: 'V2 sozlama ruxsatlariga ajratilgan', featureCode: null, ownerOnly: true, retired: true, group: 'SETTINGS', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'MEMBER_MANAGE', label: 'Eski xodim boshqaruvi', description: 'V2 xodim ruxsatlariga ajratilgan', featureCode: 'STAFF_ACCESS', ownerOnly: true, retired: true, group: 'STAFF', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
  { code: 'TELEGRAM_MANAGE', label: 'Eski Telegram boshqaruvi', description: 'SHOP_TELEGRAM_MANAGE bilan almashtirilgan', featureCode: 'TELEGRAM', ownerOnly: true, retired: true, group: 'SETTINGS', risk: 'ADMINISTRATIVE', staffManagerDelegable: false, legacyOperational: false },
] as const

const permissionByCode = new Map(SHOP_PERMISSION_CATALOG.map((item) => [item.code, item]))

export function isShopPermissionCode(value: unknown): value is ShopPermissionCode {
  return typeof value === 'string' && permissionByCode.has(value as ShopPermissionCode)
}

export function isActiveShopPermissionCode(value: unknown): value is ActiveShopPermissionCode {
  return typeof value === 'string' && ACTIVE_SHOP_PERMISSION_CODES.includes(value as ActiveShopPermissionCode)
}

export function permissionDefinition(code: ShopPermissionCode) {
  return permissionByCode.get(code)!
}

const ADDITIONAL_PERMISSION_FEATURES: Partial<Record<ActiveShopPermissionCode, readonly ShopFeatureCode[]>> = {
  IMPORT_CUSTOMERS: ['CUSTOMER_CRM'],
  IMPORT_OLD_NASIYA: ['NASIYA'],
}

/** Package modules required by a capability. These are commercial/module
 * constraints, never implied staff permissions. */
export function permissionRequiredFeatures(code: ShopPermissionCode): readonly ShopFeatureCode[] {
  const definition = permissionDefinition(code)
  return [...new Set([
    ...(definition.featureCode ? [definition.featureCode] : []),
    ...(isActiveShopPermissionCode(code) ? ADDITIONAL_PERMISSION_FEATURES[code] ?? [] : []),
  ])]
}

export const LEGACY_PERMISSION_EXPANSIONS: Readonly<Record<RetiredShopPermissionCode, readonly ActiveShopPermissionCode[]>> = {
  INVENTORY_MANAGE: ['DEVICE_CREATE', 'DEVICE_EDIT', 'DEVICE_DELETE'],
  CASH_SALE_CREATE: ['SALE_CREATE'],
  CASH_SALE_MANAGE: ['SALE_EDIT', 'SALE_REMINDER_MANAGE'],
  NASIYA_MANAGE: ['NASIYA_EDIT', 'NASIYA_DEFER', 'NASIYA_REMINDER_MANAGE'],
  OLIB_MANAGE: ['OLIB_CREATE'],
  PAYMENT_RECEIVE: ['SALE_PAYMENT_RECEIVE', 'NASIYA_PAYMENT_RECEIVE', 'SUPPLIER_PAYMENT_MARK_PAID'],
  CUSTOMER_MANAGE: ['CUSTOMER_CREATE', 'CUSTOMER_EDIT', 'CUSTOMER_PASSPORT_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'],
  CUSTOMER_PII_REVEAL: ['CUSTOMER_PASSPORT_REVEAL'],
  RETURN_MANAGE: ['SALE_RETURN_REFUND', 'NASIYA_CANCEL', 'DEVICE_RESTOCK'],
  WRITEOFF_MANAGE: ['NASIYA_ARCHIVE', 'NASIYA_WRITE_OFF', 'NASIYA_REOPEN'],
  EXPORT_DATA: ['EXPORT_DEVICES', 'EXPORT_CUSTOMERS', 'EXPORT_SALES', 'EXPORT_NASIYA', 'EXPORT_OLIB', 'EXPORT_RETURNS', 'EXPORT_LOGS', 'EXPORT_REPORTS'],
  IMPORT_DATA: ['IMPORT_CUSTOMERS', 'IMPORT_OLD_NASIYA'],
  SETTINGS_MANAGE: ['SHOP_PROFILE_EDIT', 'SHOP_CURRENCY_MANAGE', 'SHOP_TELEGRAM_MANAGE'],
  MEMBER_MANAGE: ['STAFF_VIEW', 'STAFF_CREATE', 'STAFF_EDIT_PROFILE', 'STAFF_RESET_PASSWORD', 'STAFF_STATUS_MANAGE', 'STAFF_DELETE', 'STAFF_PERMISSION_MANAGE', 'STAFF_NOTIFICATION_MANAGE'],
  TELEGRAM_MANAGE: ['SHOP_TELEGRAM_MANAGE'],
}

export function expandShopPermissionCodes(codes: readonly string[]): Set<ShopPermissionCode> {
  const expanded = new Set<ShopPermissionCode>()
  for (const value of codes) {
    if (!isShopPermissionCode(value)) continue
    expanded.add(value)
    if (RETIRED_SHOP_PERMISSION_CODES.includes(value as RetiredShopPermissionCode)) {
      for (const replacement of LEGACY_PERMISSION_EXPANSIONS[value as RetiredShopPermissionCode]) {
        expanded.add(replacement)
      }
    }
  }
  return expanded
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
  if (permissionRequiredFeatures(permission).some((feature) => !principal.enabledFeatures.has(feature))) return false
  if (principal.memberKind === 'SHOP_OWNER') return true
  if (definition.retired || definition.ownerOnly) return false
  if (principal.legacyFullAccess) return definition.legacyOperational
  return principal.grantedPermissions.has(permission)
}
