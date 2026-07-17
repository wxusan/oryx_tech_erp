import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SHOP_PERMISSION_CODES,
  SHOP_PERMISSION_CATALOG,
} from '@/lib/access-control'
import {
  NOTIFICATION_TYPE_LABELS,
  accountingReconstructionLabel,
  allocationLedgerStateLabel,
  deviceConditionLabel,
  deviceStatusLabel,
  exchangeRateSourceLabel,
  logActionLabel,
  logTargetLabel,
  nasiyaLedgerHealthLabel,
  nasiyaResolutionEventLabel,
  nasiyaResolutionLabel,
  nasiyaStatusLabel,
  notificationStatusLabel,
  notificationTypeLabel,
  operationsEventLabel,
  operationsStatusLabel,
  scheduleStatusLabel,
  sessionPolicyLabel,
  shopPermissionLabel,
  supplierPayableStatusLabel,
} from '@/lib/presentation-labels'

describe('approved audit-log wording', () => {
  const direct = {
    IMPORT: 'Ma’lumotlar import qilindi',
    CREATE_NASIYA: 'Yangi nasiya yaratildi',
    IMPORT_NASIYA: 'Avvalgi nasiya import qilindi',
    NASIYA_COMPLETED: 'Nasiya to‘liq yopildi',
    NASIYA_DEFER: 'Nasiya to‘lovi muddati uzaytirildi',
    NASIYA_ARCHIVE: 'Nasiya arxivga olindi',
    NASIYA_REOPEN: 'Nasiya qayta ochildi',
    SELL: 'Qurilma sotildi',
    RETURN: 'Qurilma qaytarildi',
    RESTOCK: 'Qurilma qayta omborga qo‘shildi',
    CUSTOMER_CREATE: 'Yangi mijoz qo‘shildi',
    CUSTOMER_PASSPORT_REVEAL: 'Mijozning pasport raqami ko‘rildi',
    OLIB_SOTDIM_CREATE: 'Olib-sotdim savdosi yaratildi',
    SUPPLIER_PAYABLE_PAID: 'Yetkazib beruvchi qarzi to‘landi',
    UPDATE_REMINDER: 'Eslatma sozlamalari yangilandi',
    UPDATE_TELEGRAM_ID: 'Telegram ulanishi yangilandi',
    CHANGE_PASSWORD: 'Parol o‘zgartirildi',
    RESET_PASSWORD: 'Parol qayta o‘rnatildi',
    STAFF_CREATE: 'Yangi xodim qo‘shildi',
    STAFF_UPDATE: 'Xodim ma’lumotlari yangilandi',
    STAFF_DELETE: 'Xodim o‘chirildi',
    OWNER_CREATE: 'Do‘kon egasi profili yaratildi',
    OWNER_RESOLVE: 'Do‘kon egasi biriktirildi',
    PACKAGE_VERSION_CREATE: 'Paket uchun yangi narx belgilandi',
  }

  it.each(Object.entries(direct))('%s uses the approved label', (code, label) => {
    expect(logActionLabel(code)).toBe(label)
  })

  const historical = {
    CREATE_DEVICE: 'Qurilma avvalgi tizim orqali qo‘shildi',
    CREATE_SALE: 'Sotuv avvalgi tizim orqali yaratildi',
    RECORD_PAYMENT: 'To‘lov avvalgi tizimda qayd etildi',
    PROVISION_LOGIN_CREDENTIALS: 'Kirish ma’lumotlari tayyorlandi',
    SEED_DEMO: 'Sinov ma’lumotlari yaratildi',
    OWNER_REPAIR: 'Do‘kon egasi ma’lumoti tiklandi',
    RECONCILE_NASIYA_LEDGER_CACHE: 'Nasiya qoldig‘i tekshirilib, tuzatildi',
    NASIYA_NATIVE_LEDGER_STRUCTURAL_REPAIR: 'Nasiya hisob-kitobi tuzilmasi tiklandi',
  }

  it.each(Object.entries(historical))('%s historical action uses the approved label', (code, label) => {
    expect(logActionLabel(code)).toBe(label)
  })

  it.each([
    ['PAYMENT', 'NasiyaSchedule', 'Nasiya to‘lovi qabul qilindi'],
    ['PAYMENT', 'Nasiya', 'Nasiya to‘lovi qabul qilindi'],
    ['PAYMENT', 'Sale', 'Sotuv qarzi bo‘yicha to‘lov qabul qilindi'],
    ['PAYMENT', 'Shop', 'Obuna to‘lovi qabul qilindi'],
    ['PAYMENT', 'SupplierPayable', 'Yetkazib beruvchiga to‘lov qayd etildi'],
    ['PAYMENT', 'Unknown', 'To‘lov qabul qilindi'],
    ['CREATE', 'Device', 'Qurilma qo‘shildi'],
    ['CREATE', 'Customer', 'Mijoz qo‘shildi'],
    ['CREATE', 'Nasiya', 'Nasiya yaratildi'],
    ['CREATE', 'NasiyaSchedule', 'Nasiya to‘lov jadvali yaratildi'],
    ['CREATE', 'Sale', 'Sotuv yaratildi'],
    ['CREATE', 'Shop', 'Do‘kon yaratildi'],
    ['CREATE', 'ShopAdmin', 'Do‘kon foydalanuvchisi qo‘shildi'],
    ['CREATE', 'SuperAdmin', 'Bosh administrator qo‘shildi'],
    ['CREATE', 'CurrencyRate', 'Valyuta kursi qo‘shildi'],
    ['CREATE', 'SupplierPayable', 'Yetkazib beruvchi qarzi qo‘shildi'],
    ['CREATE', 'ShopPackageVersion', 'Paket narxi yaratildi'],
    ['CREATE', 'Database', 'Ma’lumot qo‘shildi'],
    ['CREATE', 'Unknown', 'Yangi ma’lumot qo‘shildi'],
    ['UPDATE', 'Device', 'Qurilma ma’lumotlari yangilandi'],
    ['UPDATE', 'Customer', 'Mijoz ma’lumotlari yangilandi'],
    ['UPDATE', 'Nasiya', 'Nasiya ma’lumotlari yangilandi'],
    ['UPDATE', 'NasiyaSchedule', 'Nasiya to‘lov jadvali yangilandi'],
    ['UPDATE', 'Sale', 'Sotuv ma’lumotlari yangilandi'],
    ['UPDATE', 'Shop', 'Do‘kon ma’lumotlari yangilandi'],
    ['UPDATE', 'ShopAdmin', 'Do‘kon foydalanuvchisi ma’lumotlari yangilandi'],
    ['UPDATE', 'SuperAdmin', 'Bosh administrator ma’lumotlari yangilandi'],
    ['UPDATE', 'CurrencyRate', 'Valyuta kursi yangilandi'],
    ['UPDATE', 'SupplierPayable', 'Yetkazib beruvchi qarzi yangilandi'],
    ['UPDATE', 'ShopPackageVersion', 'Paket narxi yangilandi'],
    ['UPDATE', 'Database', 'Ma’lumotlar yangilandi'],
    ['UPDATE', 'Unknown', 'Ma’lumotlar yangilandi'],
    ['DELETE', 'Device', 'Qurilma o‘chirildi'],
    ['DELETE', 'Customer', 'Mijoz o‘chirildi'],
    ['DELETE', 'Nasiya', 'Nasiya o‘chirildi'],
    ['DELETE', 'NasiyaSchedule', 'Nasiya to‘lov jadvali o‘chirildi'],
    ['DELETE', 'Sale', 'Sotuv o‘chirildi'],
    ['DELETE', 'Shop', 'Do‘kon o‘chirildi'],
    ['DELETE', 'ShopAdmin', 'Do‘kon foydalanuvchisi o‘chirildi'],
    ['DELETE', 'SuperAdmin', 'Bosh administrator o‘chirildi'],
    ['DELETE', 'CurrencyRate', 'Valyuta kursi o‘chirildi'],
    ['DELETE', 'SupplierPayable', 'Yetkazib beruvchi qarzi o‘chirildi'],
    ['DELETE', 'ShopPackageVersion', 'Paket narxi o‘chirildi'],
    ['DELETE', 'Database', 'Ma’lumot o‘chirildi'],
    ['DELETE', 'Unknown', 'Ma’lumot o‘chirildi'],
  ])('%s + %s is context-sensitive', (action, target, label) => {
    expect(logActionLabel(action, target)).toBe(label)
  })

  it('never exposes unknown action or target codes', () => {
    expect(logActionLabel('UNRECOGNIZED_ACTION')).toBe('Noma’lum amal')
    expect(logTargetLabel('UnrecognizedTarget')).toBe('Noma’lum obyekt')
  })
})

describe('approved status and source wording', () => {
  it('covers representative values from every status family', () => {
    expect(deviceStatusLabel('SOLD_NASIYA')).toBe('Nasiyaga sotilgan')
    expect(deviceConditionLabel('USED')).toBe('Ishlatilgan')
    expect(nasiyaStatusLabel('COMPLETED')).toBe('To‘liq yopilgan')
    expect(nasiyaResolutionLabel('WRITTEN_OFF')).toBe('Hisobdan chiqarilgan')
    expect(nasiyaResolutionEventLabel('WRITE_OFF')).toBe('Hisobdan chiqarish')
    expect(nasiyaLedgerHealthLabel('QUARANTINED')).toBe('Tekshiruv uchun ajratilgan')
    expect(allocationLedgerStateLabel('MISMATCH')).toBe('Nomuvofiqlik aniqlandi')
    expect(scheduleStatusLabel('DEFERRED')).toBe('Muddati uzaytirilgan')
    expect(accountingReconstructionLabel('UNRECONSTRUCTABLE')).toBe('Hisob-kitobni tiklab bo‘lmaydi')
    expect(supplierPayableStatusLabel('OVERDUE')).toBe('To‘lov muddati o‘tgan')
    expect(notificationStatusLabel('PROCESSING')).toBe('Yuborilmoqda')
    expect(sessionPolicyLabel('IDLE_10_MINUTES')).toBe('10 daqiqa faolsizlikdan so‘ng chiqish')
    expect(operationsStatusLabel('partial')).toBe('Qisman bajarildi')
    expect(operationsStatusLabel(null)).toBe('Holat ko‘rsatilmagan')
    expect(operationsStatusLabel('unrecognized')).toBe('Holat noma’lum')
  })

  it.each([
    ['CBU', 'Markaziy bank kursi'],
    ['MANUAL', 'Qo‘lda kiritilgan kurs'],
    ['RECORDED_FROZEN', 'To‘lov vaqtida saqlangan kurs'],
    ['UNAVAILABLE_SAME_CURRENCY', 'Valyuta almashtirish talab qilinmagan'],
    ['EXCEL', 'Excel faylidan import qilingan'],
    ['UNRECOGNIZED', 'Manba noma’lum'],
  ])('%s source is readable', (source, label) => {
    expect(exchangeRateSourceLabel(source)).toBe(label)
  })
})

describe('notification and operations wording', () => {
  it('maps every current and historical notification type', () => {
    expect(Object.keys(NOTIFICATION_TYPE_LABELS)).toHaveLength(24)
    for (const [type, label] of Object.entries(NOTIFICATION_TYPE_LABELS)) {
      expect(notificationTypeLabel(type)).toBe(label)
      expect(label.trim()).not.toBe('')
    }
    expect(notificationTypeLabel('UNKNOWN_NOTIFICATION')).toBe('Noma’lum xabarnoma')
  })

  it('maps operations events and hides unknown raw event codes', () => {
    expect(operationsEventLabel('auth.rate_limit_upstash_failed')).toBe('Kirish urinishlari cheklovini tekshirishda xatolik')
    expect(operationsEventLabel('UNKNOWN_EVENT')).toBe('Noma’lum tizim hodisasi')
  })
})

describe('permission wording', () => {
  it('gives every active permission a nonempty approved label', () => {
    const catalog = new Map(SHOP_PERMISSION_CATALOG.map((item) => [item.code, item.label]))
    for (const code of ACTIVE_SHOP_PERMISSION_CODES) {
      expect(catalog.get(code)?.trim(), code).toBeTruthy()
      expect(shopPermissionLabel(code), code).toBe(catalog.get(code))
    }
    expect(shopPermissionLabel('NASIYA_ARCHIVE')).toBe('Nasiyani arxivga olish')
    expect(shopPermissionLabel('UNKNOWN_PERMISSION')).toBe('Noma’lum ruxsat')
  })
})
