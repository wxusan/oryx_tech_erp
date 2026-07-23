/**
 * Human-facing Uzbek labels for persisted/internal codes.
 *
 * These helpers must never be used to mutate stored values. They deliberately
 * return a safe, readable fallback instead of exposing an unknown raw code.
 */

import { SHOP_LOGIN_TAKEN_MESSAGE } from '@/lib/shop-login-conflict'

function labelFrom(
  labels: Readonly<Record<string, string>>,
  value: string | null | undefined,
  fallback: string,
) {
  if (!value) return fallback
  return labels[value] ?? fallback
}

export const PAYMENT_METHOD_LABELS = {
  CASH: 'Naqd pul',
  TRANSFER: 'Pul o‘tkazmasi',
  CARD: 'Karta orqali',
  OTHER: 'Boshqa',
} as const

export const CURRENCY_LABELS = {
  UZS: 'So‘m',
  USD: 'AQSH dollari',
} as const

export const SESSION_POLICY_LABELS = {
  IDLE_10_MINUTES: '10 daqiqa faolsizlikdan so‘ng chiqish',
  REMEMBERED_30_DAYS: '30 kun davomida eslab qolish',
} as const

export const DEVICE_STATUS_LABELS = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Naqdga sotilgan',
  SOLD_DEBT: 'Qarzga sotilgan',
  SOLD_NASIYA: 'Nasiyaga sotilgan',
  RETURNED: 'Qaytarilgan',
  DELETED: 'O‘chirilgan',
} as const

export const DEVICE_CONDITION_LABELS = {
  NEW: 'Yangi',
  USED: 'Ishlatilgan',
} as const

export const IMEI_SLOT_LABELS = {
  PRIMARY: 'Asosiy IMEI',
  SECONDARY: 'Qo‘shimcha IMEI',
} as const

export const NASIYA_STATUS_LABELS = {
  ACTIVE: 'Faol',
  COMPLETED: 'To‘liq yopilgan',
  OVERDUE: 'Muddati o‘tgan',
  CANCELLED: 'Bekor qilingan',
  RETURNED: 'Qaytarilgan',
} as const

export const NASIYA_RESOLUTION_LABELS = {
  ACTIVE: 'Faol',
  ARCHIVED: 'Arxivlangan',
  WRITTEN_OFF: 'Hisobdan chiqarilgan',
} as const

export const NASIYA_RESOLUTION_EVENT_LABELS = {
  ARCHIVE: 'Arxivga olish',
  WRITE_OFF: 'Hisobdan chiqarish',
  REOPEN: 'Qayta ochish',
} as const

export const NASIYA_LEDGER_HEALTH_LABELS = {
  HEALTHY: 'Hisob-kitob to‘g‘ri',
  REPAIRABLE_PARENT_CACHE: 'Qoldiqni qayta hisoblash kerak',
  QUARANTINED: 'Tekshiruv uchun ajratilgan',
} as const

export const ALLOCATION_LEDGER_STATE_LABELS = {
  COMPLETE: 'To‘liq taqsimlangan',
  UNAVAILABLE: 'Ma’lumot mavjud emas',
  MISMATCH: 'Nomuvofiqlik aniqlandi',
} as const

export const SCHEDULE_STATUS_LABELS = {
  PENDING: 'To‘lov kutilmoqda',
  PAID: 'To‘langan',
  SETTLED: 'Kelishuv bilan yopilgan',
  PARTIAL: 'Qisman to‘langan',
  OVERDUE: 'Muddati o‘tgan',
  DEFERRED: 'Muddati uzaytirilgan',
  CANCELLED: 'Bekor qilingan',
} as const

export const ACCOUNTING_RECONSTRUCTION_LABELS = {
  PENDING: 'Tiklash kutilmoqda',
  COMPLETE: 'To‘liq tiklangan',
  PARTIAL: 'Qisman tiklangan',
  UNRECONSTRUCTABLE: 'Hisob-kitobni tiklab bo‘lmaydi',
} as const

export const SUPPLIER_PAYABLE_STATUS_LABELS = {
  PENDING: 'To‘lanmagan',
  PARTIAL: 'Qisman to‘langan',
  PAID: 'To‘langan',
  CANCELLED: 'Bekor qilingan',
  OVERDUE: 'To‘lov muddati o‘tgan',
} as const

export const NOTIFICATION_STATUS_LABELS = {
  PENDING: 'Navbatda',
  PROCESSING: 'Yuborilmoqda',
  SENT: 'Yuborildi',
  FAILED: 'Yuborilmadi',
  CANCELLED: 'Bekor qilindi',
} as const

export const SHOP_STATUS_LABELS = {
  ACTIVE: 'Faol',
  SUSPENDED: 'Vaqtincha to‘xtatilgan',
  DELETED: 'O‘chirilgan',
} as const

export const SHOP_OWNERSHIP_LABELS = {
  RESOLVED: 'Do‘kon egasi biriktirilgan',
  UNMATCHED: 'Do‘kon egasi aniqlanmagan',
  AMBIGUOUS: 'Bir nechta ehtimoliy ega topilgan',
} as const

export const PACKAGE_PAYMENT_ALLOCATION_LABELS = {
  PACKAGE_ALLOCATED: 'Paket to‘loviga biriktirilgan',
  LEGACY_UNALLOCATED: 'Avvalgi to‘lov, paketga biriktirilmagan',
} as const

export const ACTOR_TYPE_LABELS = {
  SUPER_ADMIN: 'Bosh administrator',
  SHOP_ADMIN: 'Do‘kon foydalanuvchisi',
  SHOP_OWNER: 'Do‘kon egasi',
  SHOP_STAFF: 'Xodim',
} as const

export const LOG_TARGET_LABELS = {
  Database: 'Ma’lumotlar bazasi',
  Device: 'Qurilma',
  Customer: 'Mijoz',
  Nasiya: 'Nasiya',
  NasiyaSchedule: 'Nasiya to‘lov jadvali',
  Sale: 'Sotuv',
  Shop: 'Do‘kon',
  ShopAdmin: 'Do‘kon foydalanuvchisi',
  SuperAdmin: 'Bosh administrator',
  CurrencyRate: 'Valyuta kursi',
  SupplierPayable: 'Yetkazib beruvchiga qarz',
  SupplierPayablePayment: 'Yetkazib beruvchiga to‘lov',
  NasiyaSettlement: 'Nasiya yopish kelishuvi',
  OlibSotdimOperation: 'Olib-sotdim operatsiyasi',
  ShopPackageVersion: 'Paket narxi',
} as const

const DIRECT_ACTION_LABELS: Readonly<Record<string, string>> = {
  IMPORT: 'Ma’lumotlar import qilindi',
  CREATE_NASIYA: 'Yangi nasiya yaratildi',
  IMPORT_NASIYA: 'Avvalgi nasiya import qilindi',
  NASIYA_COMPLETED: 'Nasiya to‘liq yopildi',
  NASIYA_SETTLED_FULL_WITH_PROFIT: 'Nasiya foydasi bilan yopildi',
  NASIYA_SETTLED_PROFIT_WAIVED: 'Nasiya kelgusi foydasi kechilib yopildi',
  NASIYA_DEFER: 'Nasiya to‘lovi muddati uzaytirildi',
  NASIYA_ARCHIVE: 'Nasiya arxivga olindi',
  NASIYA_REOPEN: 'Nasiya qayta ochildi',
  SELL: 'Qurilma sotildi',
  RETURN: 'Qurilma qaytarildi',
  RESTOCK: 'Qurilma qayta omborga qo‘shildi',
  CUSTOMER_CREATE: 'Yangi mijoz qo‘shildi',
  CUSTOMER_PASSPORT_REVEAL: 'Mijozning pasport raqami ko‘rildi',
  OLIB_SOTDIM_CREATE: 'Olib-sotdim savdosi yaratildi',
  OLIB_SOTDIM_NASIYA_CREATE: 'Olib-sotdim orqali nasiya yaratildi',
  CREATE_DEVICE_PAY_LATER: 'Qurilma keyin to‘lash sharti bilan olindi',
  CREATE_SUPPLIER_PAYABLE: 'Yetkazib beruvchiga qarz yaratildi',
  SUPPLIER_PAYABLE_PAID: 'Yetkazib beruvchi qarzi to‘landi',
  SUPPLIER_PAYABLE_PARTIAL_PAYMENT: 'Yetkazib beruvchi qarzi qisman to‘landi',
  SUPPLIER_PAYABLE_PAYMENT: 'Yetkazib beruvchi qarzi bo‘yicha to‘lov yozildi',
  UPDATE_REMINDER: 'Eslatma sozlamalari yangilandi',
  UPDATE_TELEGRAM_ID: 'Telegram ulanishi yangilandi',
  CHANGE_PASSWORD: 'Parol o‘zgartirildi',
  RESET_PASSWORD: 'Parol qayta o‘rnatildi',
  STAFF_CREATE: 'Yangi xodim qo‘shildi',
  STAFF_UPDATE: 'Xodim ma’lumotlari yangilandi',
  STAFF_DELETE: 'Xodim o‘chirildi',
  STAFF_ROLE_CREATE: 'Yangi lavozim yaratildi',
  STAFF_ROLE_UPDATE: 'Lavozim yangilandi',
  STAFF_ROLE_ARCHIVE: 'Lavozim arxivlandi',
  OWNER_CREATE: 'Do‘kon egasi profili yaratildi',
  OWNER_RESOLVE: 'Do‘kon egasi biriktirildi',
  PACKAGE_VERSION_CREATE: 'Paket uchun yangi narx belgilandi',
  PAY_SUBSCRIPTION: 'Obuna to‘lovi qabul qilindi',
  CREATE_DEVICE: 'Qurilma avvalgi tizim orqali qo‘shildi',
  CREATE_SALE: 'Sotuv avvalgi tizim orqali yaratildi',
  RECORD_PAYMENT: 'To‘lov avvalgi tizimda qayd etildi',
  PROVISION_LOGIN_CREDENTIALS: 'Kirish ma’lumotlari tayyorlandi',
  SEED_DEMO: 'Sinov ma’lumotlari yaratildi',
  OWNER_REPAIR: 'Do‘kon egasi ma’lumoti tiklandi',
  RECONCILE_NASIYA_LEDGER_CACHE: 'Nasiya qoldig‘i tekshirilib, tuzatildi',
  NASIYA_NATIVE_LEDGER_STRUCTURAL_REPAIR: 'Nasiya hisob-kitobi tuzilmasi tiklandi',
}

const CONTEXT_ACTION_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  PAYMENT: {
    NasiyaSchedule: 'Nasiya to‘lovi qabul qilindi',
    Nasiya: 'Nasiya to‘lovi qabul qilindi',
    Sale: 'Sotuv qarzi bo‘yicha to‘lov qabul qilindi',
    Shop: 'Obuna to‘lovi qabul qilindi',
    SupplierPayable: 'Yetkazib beruvchiga to‘lov qayd etildi',
    '*': 'To‘lov qabul qilindi',
  },
  CREATE: {
    Device: 'Qurilma qo‘shildi',
    Customer: 'Mijoz qo‘shildi',
    Nasiya: 'Nasiya yaratildi',
    NasiyaSchedule: 'Nasiya to‘lov jadvali yaratildi',
    Sale: 'Sotuv yaratildi',
    Shop: 'Do‘kon yaratildi',
    ShopAdmin: 'Do‘kon foydalanuvchisi qo‘shildi',
    SuperAdmin: 'Bosh administrator qo‘shildi',
    CurrencyRate: 'Valyuta kursi qo‘shildi',
    SupplierPayable: 'Yetkazib beruvchi qarzi qo‘shildi',
    ShopPackageVersion: 'Paket narxi yaratildi',
    Database: 'Ma’lumot qo‘shildi',
    '*': 'Yangi ma’lumot qo‘shildi',
  },
  UPDATE: {
    Device: 'Qurilma ma’lumotlari yangilandi',
    Customer: 'Mijoz ma’lumotlari yangilandi',
    Nasiya: 'Nasiya ma’lumotlari yangilandi',
    NasiyaSchedule: 'Nasiya to‘lov jadvali yangilandi',
    Sale: 'Sotuv ma’lumotlari yangilandi',
    Shop: 'Do‘kon ma’lumotlari yangilandi',
    ShopAdmin: 'Do‘kon foydalanuvchisi ma’lumotlari yangilandi',
    SuperAdmin: 'Bosh administrator ma’lumotlari yangilandi',
    CurrencyRate: 'Valyuta kursi yangilandi',
    SupplierPayable: 'Yetkazib beruvchi qarzi yangilandi',
    ShopPackageVersion: 'Paket narxi yangilandi',
    Database: 'Ma’lumotlar yangilandi',
    '*': 'Ma’lumotlar yangilandi',
  },
  DELETE: {
    Device: 'Qurilma o‘chirildi',
    Customer: 'Mijoz o‘chirildi',
    Nasiya: 'Nasiya o‘chirildi',
    NasiyaSchedule: 'Nasiya to‘lov jadvali o‘chirildi',
    Sale: 'Sotuv o‘chirildi',
    Shop: 'Do‘kon o‘chirildi',
    ShopAdmin: 'Do‘kon foydalanuvchisi o‘chirildi',
    SuperAdmin: 'Bosh administrator o‘chirildi',
    CurrencyRate: 'Valyuta kursi o‘chirildi',
    SupplierPayable: 'Yetkazib beruvchi qarzi o‘chirildi',
    ShopPackageVersion: 'Paket narxi o‘chirildi',
    Database: 'Ma’lumot o‘chirildi',
    '*': 'Ma’lumot o‘chirildi',
  },
}

export function logActionLabel(action: string | null | undefined, targetType?: string | null) {
  if (!action) return 'Noma’lum amal'
  const contextual = CONTEXT_ACTION_LABELS[action]
  if (contextual) return contextual[targetType ?? ''] ?? contextual['*']
  return DIRECT_ACTION_LABELS[action] ?? 'Noma’lum amal'
}

export function logTargetLabel(value?: string | null) {
  return labelFrom(LOG_TARGET_LABELS, value, 'Noma’lum obyekt')
}

export function actorTypeLabel(value?: string | null) {
  return labelFrom(ACTOR_TYPE_LABELS, value, 'Noma’lum foydalanuvchi')
}

export function paymentMethodLabel(value?: string | null) {
  return labelFrom(PAYMENT_METHOD_LABELS, value, 'Noma’lum to‘lov usuli')
}

export function currencyLabel(value?: string | null) {
  return labelFrom(CURRENCY_LABELS, value, 'Noma’lum valyuta')
}

export function sessionPolicyLabel(value?: string | null) {
  return labelFrom(SESSION_POLICY_LABELS, value, 'Seans turi noma’lum')
}

export function deviceStatusLabel(value?: string | null) {
  return labelFrom(DEVICE_STATUS_LABELS, value, 'Holat noma’lum')
}

export function deviceConditionLabel(value?: string | null) {
  return labelFrom(DEVICE_CONDITION_LABELS, value, 'Holat noma’lum')
}

export function imeiSlotLabel(value?: string | null) {
  return labelFrom(IMEI_SLOT_LABELS, value, 'IMEI turi noma’lum')
}

export function nasiyaStatusLabel(value?: string | null) {
  return labelFrom(NASIYA_STATUS_LABELS, value, 'Holat noma’lum')
}

export function nasiyaResolutionLabel(value?: string | null) {
  return labelFrom(NASIYA_RESOLUTION_LABELS, value, 'Holat noma’lum')
}

export function nasiyaResolutionEventLabel(value?: string | null) {
  return labelFrom(NASIYA_RESOLUTION_EVENT_LABELS, value, 'Noma’lum amal')
}

export function nasiyaLedgerHealthLabel(value?: string | null) {
  return labelFrom(NASIYA_LEDGER_HEALTH_LABELS, value, 'Holat noma’lum')
}

export function allocationLedgerStateLabel(value?: string | null) {
  return labelFrom(ALLOCATION_LEDGER_STATE_LABELS, value, 'Holat noma’lum')
}

export function scheduleStatusLabel(value?: string | null) {
  return labelFrom(SCHEDULE_STATUS_LABELS, value, 'Holat noma’lum')
}

export function accountingReconstructionLabel(value?: string | null) {
  return labelFrom(ACCOUNTING_RECONSTRUCTION_LABELS, value, 'Holat noma’lum')
}

export function supplierPayableStatusLabel(value?: string | null) {
  return labelFrom(SUPPLIER_PAYABLE_STATUS_LABELS, value, 'Holat noma’lum')
}

export function notificationStatusLabel(value?: string | null) {
  return labelFrom(NOTIFICATION_STATUS_LABELS, value, 'Holat noma’lum')
}

export function shopStatusLabel(value?: string | null) {
  return labelFrom(SHOP_STATUS_LABELS, value, 'Holat noma’lum')
}

export function shopOwnershipLabel(value?: string | null) {
  return labelFrom(SHOP_OWNERSHIP_LABELS, value, 'Holat noma’lum')
}

export function packagePaymentAllocationLabel(value?: string | null) {
  return labelFrom(PACKAGE_PAYMENT_ALLOCATION_LABELS, value, 'Holat noma’lum')
}

export const EXCHANGE_RATE_SOURCE_LABELS = {
  CBU: 'Markaziy bank kursi',
  MANUAL: 'Qo‘lda kiritilgan kurs',
  RECORDED_FROZEN: 'To‘lov vaqtida saqlangan kurs',
  UNAVAILABLE_SAME_CURRENCY: 'Valyuta almashtirish talab qilinmagan',
  EXCEL: 'Excel faylidan import qilingan',
  FRESH: 'Yangilangan kurs',
  FALLBACK: 'Zaxira kursdan foydalanildi',
  UNAVAILABLE: 'Kurs mavjud emas',
  FROZEN: 'Saqlangan tarixiy kurs',
} as const

export function exchangeRateSourceLabel(value?: string | null) {
  return labelFrom(EXCHANGE_RATE_SOURCE_LABELS, value, 'Manba noma’lum')
}

export const NOTIFICATION_TYPE_LABELS = {
  RESTOCK: 'Qurilma omborga qaytarildi',
  NASIYA: 'Yangi nasiya yaratildi',
  RETURN: 'Qurilma qaytarildi',
  SALE: 'Yangi sotuv amalga oshirildi',
  DEVICE_CREATED: 'Yangi qurilma qo‘shildi',
  REMINDER: 'To‘lov eslatmasi',
  EARLY_REMINDER: 'Oldindan to‘lov eslatmasi',
  OVERDUE: 'Muddati o‘tgan to‘lov',
  SALE_REMINDER: 'Sotuv qarzi bo‘yicha eslatma',
  SALE_OVERDUE: 'Sotuv qarzi muddati o‘tgan',
  SALE_EARLY_REMINDER: 'Sotuv qarzi bo‘yicha oldindan eslatma',
  SUPPLIER_PAYABLE_REMINDER: 'Yetkazib beruvchi to‘lovi bo‘yicha eslatma',
  SUPPLIER_PAYABLE_OVERDUE: 'Yetkazib beruvchi to‘lovi muddati o‘tgan',
  SUPPLIER_PAYABLE_EARLY_REMINDER: 'Yetkazib beruvchi to‘lovi bo‘yicha oldindan eslatma',
  PAYMENT_RECEIVED: 'To‘lov qabul qilindi',
  NASIYA_IMPORTED: 'Avvalgi nasiya import qilindi',
  OLIB_SOTDIM_CREATED: 'Olib-sotdim savdosi yaratildi',
  OLIB_SOTDIM_NASIYA_CREATED: 'Olib-sotdim orqali nasiya yaratildi',
  SUPPLIER_PAYABLE_PAID: 'Yetkazib beruvchi qarzi to‘landi',
  SUPPLIER_PAYABLE_PARTIAL_PAYMENT: 'Yetkazib beruvchi qarzi qisman to‘landi',
  NASIYA_COMPLETED: 'Nasiya to‘liq yopildi',
  NASIYA_REMINDER: 'Nasiya to‘lovi eslatmasi',
  SALE_PAYMENT: 'Sotuv qarzi bo‘yicha to‘lov',
  SALE_DUE: 'Sotuv qarzi to‘lovi muddati keldi',
  TELEGRAM: 'Telegram xabarnomasi',
  SHOP_SUBSCRIPTION: 'Do‘kon obunasi',
} as const

export function notificationTypeLabel(value?: string | null) {
  return labelFrom(NOTIFICATION_TYPE_LABELS, value, 'Noma’lum xabarnoma')
}

export const NOTIFICATION_CANCELLATION_LABELS = {
  legacy_recipient_unbound: 'Qabul qiluvchi avvalgi tizimdan qolgan va hisobga biriktirilmagan',
  recipient_revoked_or_unverified: 'Qabul qiluvchining Telegram ulanishi tasdiqlanmagan yoki bekor qilingan',
  recipient_not_entitled_or_notifications_disabled: 'Qabul qiluvchida ruxsat yo‘q yoki xabarnomalar o‘chirilgan',
  reminders_not_entitled: 'Eslatmalar funksiyasidan foydalanish huquqi mavjud emas',
  invalid_reminder_reference: 'Eslatma tegishli yozuv bilan bog‘lanmagan',
  debt_resolved_or_changed: 'Qarz yopilgan yoki qarz ma’lumotlari o‘zgargan',
  unlinked_or_unverified: 'Telegram hisobi ulanmagan yoki tasdiqlanmagan',
  personal_disabled: 'Xodim uchun Telegram xabarlari o‘chirilgan',
  shop_disabled: 'Do‘kon uchun Telegram xabarlari o‘chirilgan',
  package_not_entitled: 'Do‘kon paketida Telegram yoki xodimlar imkoniyati mavjud emas',
  recipient_limit_reached: 'Faol xodimlar soni Telegram qabul qiluvchilarining xavfsiz chegarasidan oshgan',
} as const

export function notificationCancellationLabel(value?: string | null) {
  return labelFrom(NOTIFICATION_CANCELLATION_LABELS, value, 'Bekor qilish sababi noma’lum')
}

export const TELEGRAM_AUDIENCE_LABELS = {
  OWNER_ONLY: 'Faqat do‘kon egasi',
  OWNER_AND_ACTIVE_STAFF: 'Do‘kon egasi va faol xodimlar',
} as const

export function telegramAudienceLabel(value?: string | null) {
  return labelFrom(TELEGRAM_AUDIENCE_LABELS, value, 'Qabul qiluvchilar noma’lum')
}

export const OPERATIONS_EVENT_LABELS: Readonly<Record<string, string>> = {
  'api.route_error': 'API so‘rovida xatolik',
  'auth.invalid_request': 'Noto‘g‘ri kirish so‘rovi',
  'auth.login_blocked': 'Kirish vaqtincha bloklandi',
  'auth.login_failed': 'Tizimga kirish muvaffaqiyatsiz',
  'auth.login_invalidated': 'Kirish seansi bekor qilindi',
  'auth.login_succeeded': 'Tizimga muvaffaqiyatli kirildi',
  'auth.rate_limit_upstash_failed': 'Kirish urinishlari cheklovini tekshirishda xatolik',
  'cron.reminders.started': 'Eslatmalarni yaratish jarayoni boshlandi',
  'cron.reminders.completed': 'Eslatmalarni yaratish jarayoni yakunlandi',
  'cron.reminders.failed': 'Eslatmalarni yaratish jarayonida xatolik',
  'currency.nasiya_ledger_mismatch_detected': 'Nasiya valyuta hisobida nomuvofiqlik aniqlandi',
  'currency.nasiya_ledger_monitor_failed': 'Nasiya valyuta hisobini tekshirishda xatolik',
  'currency.nasiya_ledger_reconciliation': 'Nasiya valyuta hisobi tekshirilib, moslashtirildi',
  'currency.rate_fetch_failed': 'Valyuta kursini olishda xatolik',
  'health.db_failed': 'Ma’lumotlar bazasi tekshiruvida xatolik',
  migration_resolution_complete: 'Ma’lumotlar migratsiyasi yakunlandi',
  'notification.broadcast': 'Xabarnoma ommaviy yuborildi',
  'notification.broadcast_failed': 'Ommaviy xabarnoma yuborishda xatolik',
  'notification.broadcast_partial': 'Xabarnomalar qisman yuborildi',
  'notification.cancelled': 'Xabarnoma bekor qilindi',
  'notification.flush_failed': 'Xabarnomalar navbatini qayta ishlashda xatolik',
  'notification.no_recipients': 'Qabul qiluvchilar topilmadi',
  'notification.queue_failed': 'Xabarnomani navbatga qo‘shishda xatolik',
  'notification.recipient_unavailable': 'Telegram qabul qiluvchisi mavjud emas',
  'notification.queued': 'Xabarnoma yuborish navbatiga qo‘shildi',
  'notification.run': 'Xabarnomalarni yuborish jarayoni ishga tushdi',
  'notification.run_failed': 'Xabarnomalarni yuborish jarayonida xatolik',
  'notification.run_failure_log_failed': 'Xabarnoma xatoligini jurnalga yozib bo‘lmadi',
  'ops.persist_failed': 'Tizim hodisasini saqlashda xatolik',
  'performance.api_authorization': 'API ruxsat tekshiruvi samaradorligi',
  'performance.nasiya_payment': 'Nasiya to‘lovi samaradorligi',
  'rate_limit.upstash_failed': 'So‘rovlar cheklovini tekshirishda xatolik',
  'sync.bootstrap': 'Dastlabki sinxronlash',
  'sync.delta': 'O‘zgarishlar sinxronlandi',
  'sync.failed': 'Sinxronlashda xatolik',
  'telegram.send': 'Telegram xabari yuborildi',
  'telegram.send_failed': 'Telegram xabarini yuborib bo‘lmadi',
  'telegram.start': 'Telegram botda boshlash so‘rovi qabul qilindi',
  'telegram.start_unlinked': 'Telegram hisobi tizimga biriktirilmagan',
  'telegram.verify_stamp_failed': 'Telegram tasdiqlash ma’lumotini tekshirib bo‘lmadi',
  'telegram.webhook_error': 'Telegram webhookida xatolik',
  'telegram.webhook_misconfigured': 'Telegram webhooki noto‘g‘ri sozlangan',
  'telegram.webhook_unauthorized': 'Telegram webhook so‘rovi tasdiqlanmadi',
}

export function operationsEventLabel(value?: string | null) {
  return labelFrom(OPERATIONS_EVENT_LABELS, value, 'Noma’lum tizim hodisasi')
}

export const OPERATIONS_LEVEL_LABELS = {
  INFO: 'Ma’lumot',
  WARN: 'Ogohlantirish',
  ERROR: 'Xatolik',
} as const

export function operationsLevelLabel(value?: string | null) {
  return labelFrom(OPERATIONS_LEVEL_LABELS, value, 'Holat noma’lum')
}

export function operationsStatusLabel(value?: string | null) {
  if (value == null || value === '') return 'Holat ko‘rsatilmagan'
  const common: Readonly<Record<string, string>> = {
    ok: 'Muvaffaqiyatli',
    partial: 'Qisman bajarildi',
    error: 'Xatolik',
    APPLIED: 'Qo‘llandi',
  }
  if (common[value]) return common[value]
  if (value in NOTIFICATION_TYPE_LABELS) return notificationTypeLabel(value)
  return 'Holat noma’lum'
}

export const SHOP_FEATURE_LABELS: Readonly<Record<string, string>> = {
  INVENTORY: 'Ombor boshqaruvi',
  CASH_SALES: 'Naqd sotuvlar',
  NASIYA: 'Nasiya savdolari',
  OLIB_SOTDIM: 'Olib-sotdim',
  CUSTOMER_CRM: 'Mijozlar bazasi',
  TELEGRAM: 'Telegram xabarnomalari',
  REMINDERS: 'To‘lov eslatmalari',
  REPORTS: 'Hisobotlar',
  IMPORTS: 'Ma’lumot importi',
  EXPORTS: 'Ma’lumot eksporti',
  STAFF_ACCESS: 'Xodimlar uchun kirish',
}

export function shopFeatureLabel(value?: string | null) {
  return labelFrom(SHOP_FEATURE_LABELS, value, 'Noma’lum imkoniyat')
}

export const SHOP_PERMISSION_LABELS: Readonly<Record<string, string>> = {
  INVENTORY_VIEW: 'Ombordagi qurilmalarni ko‘rish',
  DEVICE_CREATE: 'Qurilma qo‘shish',
  DEVICE_PURCHASE_ON_CREDIT: 'Qurilmani keyin to‘lashga olish',
  DEVICE_EDIT: 'Qurilma ma’lumotlarini tahrirlash',
  DEVICE_DELETE: 'Qurilmani o‘chirish',
  DEVICE_RESTOCK: 'Qurilmani qayta omborga qo‘shish',
  SALE_VIEW: 'Sotuvlarni ko‘rish',
  SALE_CREATE: 'Sotuv yaratish',
  SALE_EDIT: 'Sotuv ma’lumotlarini tahrirlash',
  SALE_PAYMENT_RECEIVE: 'Sotuv qarzi bo‘yicha to‘lov qabul qilish',
  SALE_REMINDER_MANAGE: 'Sotuv to‘lov eslatmalarini boshqarish',
  SALE_RETURN_REFUND: 'Sotuvni qaytarish va pul qaytarishni rasmiylashtirish',
  RECEIVABLES_VIEW: 'Olinishi kutilayotgan to‘lovlarni ko‘rish',
  NASIYA_VIEW: 'Nasiyalarni ko‘rish',
  NASIYA_CREATE: 'Nasiya yaratish',
  NASIYA_EDIT: 'Nasiya ma’lumotlarini tahrirlash',
  NASIYA_PAYMENT_RECEIVE: 'Nasiya to‘lovini qabul qilish',
  NASIYA_PROFIT_WAIVE: 'Nasiya foydasidan kechish',
  NASIYA_RETURN_REFUND: 'Nasiyani qaytarish va pulni qaytarish',
  NASIYA_DEFER: 'Nasiya to‘lovi muddatini uzaytirish',
  NASIYA_REMINDER_MANAGE: 'Nasiya eslatmalarini boshqarish',
  NASIYA_ARCHIVE: 'Nasiyani arxivga olish',
  NASIYA_REOPEN: 'Nasiyani qayta ochish',
  OLIB_VIEW: 'Olib-sotdim yozuvlarini ko‘rish',
  OLIB_CREATE: 'Olib-sotdim savdosini yaratish',
  SUPPLIER_PAYABLE_VIEW: 'Bizning yetkazib beruvchi qarzlarimizni ko‘rish',
  SUPPLIER_PAYMENT_RECORD: 'Yetkazib beruvchi qarzi bo‘yicha to‘lov yozish',
  SUPPLIER_PAYMENT_MARK_PAID: 'Yetkazib beruvchiga to‘lovni to‘langan deb belgilash',
  CUSTOMER_VIEW: 'Mijozlarni ko‘rish',
  CUSTOMER_CREATE: 'Mijoz qo‘shish',
  CUSTOMER_EDIT: 'Mijoz ma’lumotlarini tahrirlash',
  CUSTOMER_PASSPORT_PHOTO_VIEW: 'Pasport rasmini ko‘rish',
  CUSTOMER_PASSPORT_REVEAL: 'Pasport raqamini ko‘rish',
  CUSTOMER_PASSPORT_MANAGE: 'Pasport ma’lumotlarini boshqarish',
  CUSTOMER_TRUST_OVERRIDE: 'Mijozning ishonch darajasini qo‘lda o‘zgartirish',
  DASHBOARD_OPERATIONAL_VIEW: 'Asosiy operatsion ko‘rsatkichlarni ko‘rish',
  DASHBOARD_FINANCIAL_VIEW: 'Moliyaviy ko‘rsatkichlarni ko‘rish',
  REPORT_VIEW: 'Hisobotlarni ko‘rish',
  LOG_VIEW: 'Faoliyat tarixini ko‘rish',
  IMPORT_CUSTOMERS: 'Mijozlarni import qilish',
  IMPORT_OLD_NASIYA: 'Avvalgi nasiyalarni import qilish',
  EXPORT_DEVICES: 'Qurilmalarni eksport qilish',
  EXPORT_CUSTOMERS: 'Mijozlarni eksport qilish',
  EXPORT_SALES: 'Sotuvlarni eksport qilish',
  EXPORT_NASIYA: 'Nasiyalarni eksport qilish',
  EXPORT_OLIB: 'Olib-sotdim ma’lumotlarini eksport qilish',
  EXPORT_RETURNS: 'Qaytarishlarni eksport qilish',
  EXPORT_LOGS: 'Faoliyat tarixini eksport qilish',
  EXPORT_REPORTS: 'Hisobotlarni eksport qilish',
  STAFF_VIEW: 'Xodimlarni ko‘rish',
  STAFF_CREATE: 'Xodim qo‘shish',
  STAFF_EDIT_PROFILE: 'Xodim profilini tahrirlash',
  STAFF_RESET_PASSWORD: 'Xodim parolini qayta o‘rnatish',
  STAFF_STATUS_MANAGE: 'Xodim holatini boshqarish',
  STAFF_DELETE: 'Xodimni o‘chirish',
  STAFF_PERMISSION_MANAGE: 'Xodim ruxsatlarini boshqarish',
  STAFF_NOTIFICATION_MANAGE: 'Xodim xabarnomalarini boshqarish',
  SHOP_PROFILE_EDIT: 'Do‘kon profilini tahrirlash',
  SHOP_CURRENCY_MANAGE: 'Valyuta kursi sozlamalarini boshqarish',
  SHOP_TELEGRAM_MANAGE: 'Telegram ulanishini boshqarish',
  INVENTORY_MANAGE: 'Omborni boshqarish',
  CASH_SALE_CREATE: 'Naqd sotuv yaratish',
  CASH_SALE_MANAGE: 'Naqd sotuvlarni boshqarish',
  NASIYA_MANAGE: 'Nasiyalarni boshqarish',
  OLIB_MANAGE: 'Olib-sotdimni boshqarish',
  PAYMENT_RECEIVE: 'To‘lov qabul qilish',
  CUSTOMER_MANAGE: 'Mijozlarni boshqarish',
  CUSTOMER_PII_REVEAL: 'Mijozning maxfiy ma’lumotlarini ko‘rish',
  RETURN_MANAGE: 'Qaytarishlarni boshqarish',
  WRITEOFF_MANAGE: 'Qarzlarni hisobdan chiqarishni boshqarish',
  EXPORT_DATA: 'Ma’lumotlarni eksport qilish',
  IMPORT_DATA: 'Ma’lumotlarni import qilish',
  SETTINGS_MANAGE: 'Sozlamalarni boshqarish',
  MEMBER_MANAGE: 'Xodimlar va foydalanuvchilarni boshqarish',
  TELEGRAM_MANAGE: 'Telegram ulanishini boshqarish',
  NASIYA_CANCEL: 'Nasiyani bekor qilish',
  NASIYA_WRITE_OFF: 'Nasiyani hisobdan chiqarish',
}

export function shopPermissionLabel(value?: string | null) {
  return labelFrom(SHOP_PERMISSION_LABELS, value, 'Noma’lum ruxsat')
}

export const PERMISSION_RISK_LABELS = {
  ROUTINE: 'Oddiy amal',
  FINANCIAL: 'Moliyaviy amal',
  PRIVATE: 'Maxfiy ma’lumot',
  DESTRUCTIVE: 'Qaytarib bo‘lmaydigan amal',
  ADMINISTRATIVE: 'Ma’muriy amal',
} as const

export function permissionRiskLabel(value?: string | null) {
  return labelFrom(PERMISSION_RISK_LABELS, value, 'Xavf turi noma’lum')
}

export const PAYMENT_MODE_LABELS = {
  FULL: 'To‘liq to‘lov',
  PARTIAL: 'Qisman to‘lov',
  LATER: 'Keyinroq to‘lash',
} as const

export const CUSTOMER_SELECTION_LABELS = {
  EXISTING: 'Mavjud mijoz',
  NEW: 'Yangi mijoz',
} as const

export const TRUST_LEVEL_LABELS = {
  NEW: 'Yangi mijoz',
  LOW: 'Past',
  MEDIUM: 'O‘rtacha',
  HIGH: 'Yuqori',
  VERY_HIGH: 'Juda yuqori',
} as const

export const PAYMENT_RISK_LABELS = {
  LOW: 'Past xavf',
  MEDIUM: 'O‘rtacha xavf',
  HIGH: 'Yuqori xavf',
  UNKNOWN: 'Aniqlanmagan',
} as const

export const COLLECTION_COHORT_LABELS = {
  OVERDUE: 'Muddati o‘tgan',
  DUE_TODAY: 'Bugun to‘lanishi kerak',
  UPCOMING: 'Yaqin kunlardagi to‘lovlar',
} as const

export const REPORT_RANGE_LABELS = {
  single: 'Tanlangan davr',
  trailing3: 'So‘nggi 3 oy',
  trailing6: 'So‘nggi 6 oy',
  trailing12: 'So‘nggi 12 oy',
  custom: 'Maxsus davr',
} as const

export const EXPORT_ENTITY_LABELS = {
  devices: 'Qurilmalar',
  customers: 'Mijozlar',
  sales: 'Sotuvlar',
  nasiya: 'Nasiyalar',
  olib: 'Olib-sotdim',
  returns: 'Qaytarishlar',
  logs: 'Faoliyat tarixi',
  report: 'Hisobot',
} as const

export const SHOP_ACCESS_MODE_LABELS = {
  OWNER_ONLY: 'Faqat do‘kon egasi',
  OWNER_AND_STAFF: 'Do‘kon egasi va xodimlar',
} as const

export const IMAGE_UPLOAD_STATUS_LABELS = {
  ready: 'Tayyor',
  uploading: 'Yuklanmoqda',
  uploaded: 'Yuklandi',
  error: 'Yuklashda xatolik',
} as const

export const NAVIGATION_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  devices: 'Qurilmalar',
  sales: 'Sotuvlar',
  nasiyas: 'Nasiyalar',
  payments: 'To‘lovlar',
  returns: 'Qaytarishlar',
  customers: 'Mijozlar',
  reports: 'Hisobotlar',
  logs: 'Faoliyat tarixi',
  currency: 'Valyuta kursi',
  overdue: 'Muddati o‘tgan to‘lovlar',
  olibSotdim: 'Olib-sotdim',
  debts: 'Qarzlarim',
  settings: 'Sozlamalar',
  access: 'Kirish va ruxsatlar',
  adminShops: 'Do‘konlar boshqaruvi',
  adminPayments: 'Obuna to‘lovlari',
  adminReports: 'Umumiy hisobotlar',
  adminLogs: 'Tizim faoliyati',
  adminOps: 'Tizim holati',
}

export function navigationDomainLabel(value?: string | null) {
  return labelFrom(NAVIGATION_DOMAIN_LABELS, value, 'Noma’lum bo‘lim')
}

export const MUTATION_CODE_LABELS: Readonly<Record<string, string>> = {
  'device.created': 'Qurilma qo‘shildi',
  'device.updated': 'Qurilma ma’lumotlari yangilandi',
  'device.deleted': 'Qurilma o‘chirildi',
  'device.restocked': 'Qurilma qayta omborga qo‘shildi',
  'sale.created': 'Sotuv yaratildi',
  'sale.updated': 'Sotuv ma’lumotlari yangilandi',
  'sale.paymentRecorded': 'Sotuv qarzi bo‘yicha to‘lov qayd etildi',
  'nasiya.created': 'Nasiya yaratildi',
  'nasiya.imported': 'Avvalgi nasiya import qilindi',
  'nasiya.updated': 'Nasiya ma’lumotlari yangilandi',
  'nasiya.reminderUpdated': 'Nasiya eslatmasi yangilandi',
  'nasiya.paymentRecorded': 'Nasiya to‘lovi qayd etildi',
  'nasiya.deferred': 'Nasiya to‘lovi muddati uzaytirildi',
  'nasiya.archived': 'Nasiya arxivga olindi',
  'nasiya.writtenOff': 'Nasiya hisobdan chiqarildi',
  'nasiya.reopened': 'Nasiya qayta ochildi',
  'return.created': 'Qurilma qaytarildi',
  'olibSotdim.created': 'Olib-sotdim savdosi yaratildi',
  'olibSotdim.paymentRecorded': 'Yetkazib beruvchiga to‘lov qayd etildi',
  'customer.updated': 'Mijoz ma’lumotlari yangilandi',
  'shop.profileUpdated': 'Do‘kon profili yangilandi',
  'shop.currencyUpdated': 'Do‘kon valyuta sozlamalari yangilandi',
  'shopAdmin.profileUpdated': 'Do‘kon foydalanuvchisi profili yangilandi',
  'currency.updated': 'Valyuta kursi yangilandi',
  'admin.profileUpdated': 'Bosh administrator profili yangilandi',
  'admin.shopCreated': 'Do‘kon yaratildi',
  'admin.shopUpdated': 'Do‘kon ma’lumotlari yangilandi',
  'admin.shopDeleted': 'Do‘kon o‘chirildi',
  'admin.shopPaymentRecorded': 'Do‘kon obuna to‘lovi qayd etildi',
  'admin.shopAdminsUpdated': 'Do‘kon foydalanuvchilari yangilandi',
  'admin.shopPackageUpdated': 'Do‘kon paketi yangilandi',
  'admin.shopOwnerUpdated': 'Do‘kon egasi yangilandi',
  'shop.staffUpdated': 'Xodim ma’lumotlari yangilandi',
}

export function mutationCodeLabel(value?: string | null) {
  return labelFrom(MUTATION_CODE_LABELS, value, 'Noma’lum o‘zgarish')
}

export const REMINDER_PHASE_LABELS = {
  NASIYA_DUE: 'Nasiya to‘lovi muddati keldi',
  NASIYA_OVERDUE: 'Nasiya to‘lovi muddati o‘tdi',
  NASIYA_EARLY: 'Nasiya to‘lovi bo‘yicha oldindan eslatma',
  SALE_DUE: 'Sotuv qarzi to‘lovi muddati keldi',
  SALE_OVERDUE: 'Sotuv qarzi to‘lovi muddati o‘tdi',
  SALE_EARLY: 'Sotuv qarzi bo‘yicha oldindan eslatma',
  SUPPLIER_DUE: 'Yetkazib beruvchiga to‘lov muddati keldi',
  SUPPLIER_OVERDUE: 'Yetkazib beruvchiga to‘lov muddati o‘tdi',
  SUPPLIER_EARLY: 'Yetkazib beruvchiga to‘lov bo‘yicha oldindan eslatma',
} as const

export function reminderPhaseLabel(value?: string | null) {
  return labelFrom(REMINDER_PHASE_LABELS, value, 'Noma’lum eslatma bosqichi')
}

export const INTERNAL_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ALREADY_SETTLED: 'Bu qarz allaqachon to‘liq yopilgan.',
  INVALID_AMOUNT: 'Kiritilgan summa noto‘g‘ri.',
  OVERPAYMENT: 'To‘lov summasi qolgan qarzdan oshib ketdi.',
  AUTHORIZATION_CHANGED: 'Ruxsatlaringiz o‘zgargan. Sahifani yangilab, qayta urinib ko‘ring.',
  CREATED_DEVICE_DTO_NOT_FOUND: 'Qurilma yaratildi, ammo yangilangan ma’lumotni yuklab bo‘lmadi. Sahifani yangilang.',
  UPDATED_DEVICE_DTO_NOT_FOUND: 'Qurilma yangilandi, ammo yangilangan ma’lumotni yuklab bo‘lmadi. Sahifani yangilang.',
  DELEGATED_CREATE_SCOPE: 'Ushbu amal faqat ruxsat berilgan doirada bajarilishi mumkin.',
  DELEGATION_FORBIDDEN: 'Bu amalni boshqa foydalanuvchi nomidan bajarishga ruxsat yo‘q.',
  LOGIN_OWNER_ONLY: 'Tizimga faqat do‘kon egasi kira oladi.',
  LOGIN_TAKEN: SHOP_LOGIN_TAKEN_MESSAGE,
  LOGS_OWNER_ONLY: 'Faoliyat tarixini faqat do‘kon egasi ko‘ra oladi.',
  PERMISSION_INVALID: 'Tanlangan ruxsat noto‘g‘ri.',
  REMINDER_GENERATION_LEASE_LOST: 'Eslatmalarni yaratish jarayoni to‘xtatildi. Qayta urinib ko‘ring.',
  RETURN_TRANSACTION_RETRY_EXHAUSTED: 'Qaytarishni yakunlab bo‘lmadi. Iltimos, qayta urinib ko‘ring.',
  SERIALIZABLE_TRANSACTION_FAILED: 'Amalni yakunlab bo‘lmadi. Iltimos, qayta urinib ko‘ring.',
  STAFF_ACCESS_DISABLED: 'Xodimlar uchun kirish o‘chirilgan.',
  STAFF_DATE_INVALID: 'Xodim uchun kiritilgan sana noto‘g‘ri.',
  STAFF_NOT_FOUND: 'Xodim topilmadi.',
  TELEGRAM_DISABLED: 'Telegram funksiyasi o‘chirilgan.',
  TELEGRAM_TAKEN: 'Bu Telegram hisobi boshqa foydalanuvchiga biriktirilgan.',
  OWNER_ADMIN_REQUIRED: 'Do‘kon egasi administrator huquqiga ega bo‘lishi kerak.',
  OWNER_ALREADY_RESOLVED: 'Do‘kon egasi allaqachon biriktirilgan.',
  OWNER_NOT_FOUND: 'Do‘kon egasi topilmadi.',
  OWNER_TARGET: 'Tanlangan foydalanuvchini do‘kon egasi sifatida biriktirib bo‘lmaydi.',
  OWNER_UNRESOLVED: 'Do‘kon egasi hali biriktirilmagan.',
  PACKAGE_NOT_FOUND: 'Paket topilmadi.',
  PRICE_BOUNDARY: 'Kiritilgan narx ruxsat etilgan chegaradan tashqarida.',
  SHOP_NOT_FOUND: 'Do‘kon topilmadi.',
  INVALID_SYNC_CURSOR: 'Sinxronlash ma’lumoti yaroqsiz. Sahifani yangilang.',
  INVALID_SYNC_DOMAINS: 'Sinxronlash bo‘limlari noto‘g‘ri tanlangan.',
  LEGACY_AMOUNT_UNAVAILABLE: 'Avvalgi yozuv summasi mavjud emas.',
  NASIYA_LEDGER_MONITOR_FAILED: 'Nasiya hisob-kitobini tekshirib bo‘lmadi.',
  P2002: 'Bu ma’lumot allaqachon mavjud.',
  P2034: 'Amal boshqa o‘zgarish bilan to‘qnashdi. Iltimos, qayta urinib ko‘ring.',
}

export function internalErrorMessage(value?: string | null) {
  return labelFrom(INTERNAL_ERROR_MESSAGES, value, 'Amalni bajarib bo‘lmadi. Iltimos, qayta urinib ko‘ring.')
}

/** Compact state evidence used in customer and device history rows. */
export function historyStatusLabel(value?: string | null) {
  if (!value) return 'Holat noma’lum'
  const labels: Readonly<Record<string, string>> = {
    ...DEVICE_STATUS_LABELS,
    ...NASIYA_STATUS_LABELS,
    ...SCHEDULE_STATUS_LABELS,
    ...NASIYA_RESOLUTION_LABELS,
    ...NASIYA_RESOLUTION_EVENT_LABELS,
    DEBT: 'Qarz',
    RECORDED: 'Qayd etilgan',
    FULL_WITH_PROFIT: 'Foydasi bilan yopish',
    WAIVE_REMAINING_PROFIT: 'Foydani kechib yopish',
    LEGACY_AMOUNT_UNAVAILABLE: 'Avvalgi yozuvda aniq summa mavjud emas',
  }
  return value.split(':').map((part) => labels[part] ?? 'Holat noma’lum').join(' → ')
}
