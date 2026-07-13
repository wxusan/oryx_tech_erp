/**
 * Zod v4 validation schemas for Oryx Tech ERP.
 * All error messages are in Uzbek.
 */

import { z } from 'zod'
import { MAX_NASIYA_INTEREST_PERCENT } from '@/lib/nasiya-utils'
import { isValidPhone, normalizeUzPhone, PHONE_ERROR } from '@/lib/phone'
import { isValidImei } from '@/lib/device-specs'
import {
  BCRYPT_PASSWORD_TOO_LONG_MESSAGE,
  isBcryptPasswordWithinLimit,
} from '@/lib/password-policy'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

export const phoneSchema = z
  .string({ error: "Telefon raqam kiritilishi shart" })
  .trim()
  .refine(isValidPhone, PHONE_ERROR)
  .transform((phone) => normalizeUzPhone(phone)!)

export const passwordSchema = z
  .string({ error: "Parol kiritilishi shart" })
  .min(10, "Parol kamida 10 ta belgidan iborat bo'lishi kerak")
  .refine(isBcryptPasswordWithinLimit, BCRYPT_PASSWORD_TOO_LONG_MESSAGE)

export const currentPasswordSchema = z
  .string({ error: 'Joriy parol kiritilishi shart' })
  .min(1, 'Joriy parol kiritilishi shart')
  .refine(isBcryptPasswordWithinLimit, BCRYPT_PASSWORD_TOO_LONG_MESSAGE)

const telegramIdInputSchema = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak")
  .optional()
  .or(z.literal(''))

const deviceImageKeySchema = z
  .string()
  .regex(/^shops\/[^/]+\/devices\/[^/]+$/, 'Faqat Oryx private storage rasmi qabul qilinadi')

const paymentMethodSchema = z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER'], {
  error: "To'lov usuli noto'g'ri",
})

const currencyCodeSchema = z.enum(['UZS', 'USD'], {
  error: "Valyuta noto'g'ri",
})

// Item 12 — split payment (e.g. half cash, half card). Optional; a normal
// single-method payment omits this entirely. Sum-matches-total and
// part-count validation happens in the route handler via
// validatePaymentBreakdown (needs the payment's own `amount`, not available
// to a field-level Zod schema alone).
const paymentBreakdownSchema = z
  .array(
    z.object({
      method: paymentMethodSchema,
      amount: z.number().positive("Har bir qism musbat summa bo'lishi kerak"),
    }),
  )
  .min(2, "Aralash to'lov kamida 2 ta usulni o'z ichiga olishi kerak")
  .optional()

// "Ertaroq eslatilsinmi?" — shared by nasiya creation and later-payment sale.
const earlyReminderEnabledSchema = z.boolean().optional().default(false)
const earlyReminderDaysSchema = z
  .number({ error: "Kunlar soni kiritilishi shart" })
  .int("Kunlar soni butun son bo'lishi kerak")
  .min(1, "Kamida 1 kun bo'lishi kerak")
  .max(60, "Ko'pi bilan 60 kun bo'lishi mumkin")
  .optional()

const privateFileKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^shops\/[^/]+\/passports\/[^/]+$/, "Pasport rasmi private storage kaliti noto'g'ri")
  .refine((value) => !/^https?:\/\//i.test(value), {
    message: "Pasport rasmi public URL bo'lmasligi kerak",
  })

// ---------------------------------------------------------------------------
// createShopSchema
// ---------------------------------------------------------------------------

const shopAdminInputSchema = z.object({
  name: z.string({ error: "Admin ismi kiritilishi shart" }).min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak").max(100),
  phone: phoneSchema,
  telegramId: telegramIdInputSchema,
  login: z
    .string({ error: "Login kiritilishi shart" })
    .min(3, "Login kamida 3 ta belgidan iborat bo'lishi kerak")
    .max(64, "Login 64 ta belgidan oshmasligi kerak")
    .regex(/^[a-zA-Z0-9_]+$/, "Login faqat lotin harflari, raqamlar va _ belgisidan iborat bo'lishi kerak"),
  password: passwordSchema,
})

export const createShopSchema = z.object({
  name: z
    .string({ error: "Do'kon nomi kiritilishi shart" })
    .min(2, "Do'kon nomi kamida 2 ta harfdan iborat bo'lishi kerak")
    .max(120, "Do'kon nomi 120 ta belgidan oshmasligi kerak"),
  ownerName: z
    .string({ error: "Egasi ismi kiritilishi shart" })
    .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
    .max(100, "Ism 100 ta belgidan oshmasligi kerak"),
  ownerPhone: phoneSchema,
  shopNumber: z
    .string({ error: "Do'kon raqami kiritilishi shart" })
    .min(1, "Do'kon raqami bo'sh bo'lmasligi kerak")
    .max(64, "Do'kon raqami 64 ta belgidan oshmasligi kerak"),
  address: z.string().max(255, "Manzil 255 ta belgidan oshmasligi kerak").optional(),
  note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
  admins: z
    .array(shopAdminInputSchema)
    .min(1, "Kamida bitta admin qo'shilishi shart")
    .max(20, "Ko'pi bilan 20 ta admin qo'shish mumkin"),
})

export type CreateShopInput = z.infer<typeof createShopSchema>

// ---------------------------------------------------------------------------
// addDeviceSchema
// ---------------------------------------------------------------------------

export const addDeviceSchema = z.object({
  model: z
    .string({ error: "Model kiritilishi shart" })
    .min(1, "Model bo'sh bo'lmasligi kerak")
    .max(120, "Model 120 ta belgidan oshmasligi kerak"),
  color: z.string().max(50, "Rang 50 ta belgidan oshmasligi kerak").optional(),
  storageAmount: z.number().positive("Xotira hajmi 0 dan katta bo'lishi kerak"),
  storageUnit: z.enum(['GB', 'TB']),
  conditionCode: z.enum(['NEW', 'USED'], { error: "Qurilma holati tanlanishi shart" }),
  batteryHealth: z
    .number()
    .int("Batareya holati butun son bo'lishi kerak")
    .min(0, "Batareya holati 0 dan kam bo'lmasligi kerak")
    .max(100, "Batareya holati 100 dan oshmasligi kerak")
    .optional(),
  purchasePrice: z
    .number({ error: "Sotib olish narxi kiritilishi shart" })
    .positive("Narx musbat son bo'lishi kerak"),
  imei: z
    .string({ error: "IMEI kiritilishi shart" })
    .trim()
    .refine(isValidImei, "IMEI 15 ta raqamdan iborat bo'lishi kerak"),
  secondaryImei: z.string().trim().refine((value) => !value || isValidImei(value), "Ikkinchi IMEI 15 ta raqamdan iborat bo'lishi kerak").optional(),
  supplierName: z.string().max(100, "Ta'minotchi nomi 100 ta belgidan oshmasligi kerak").optional(),
  supplierPhone: phoneSchema.optional(),
  note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
  imageUrls: z.array(deviceImageKeySchema).optional(),
  inputCurrency: currencyCodeSchema.optional(),
}).refine((data) => !data.secondaryImei || data.secondaryImei.replace(/[\s-]/g, '') !== data.imei.replace(/[\s-]/g, ''), {
  message: "Asosiy va ikkinchi IMEI bir xil bo'lishi mumkin emas",
  path: ['secondaryImei'],
})

export type AddDeviceInput = z.infer<typeof addDeviceSchema>

// ---------------------------------------------------------------------------
// createSaleSchema
// ---------------------------------------------------------------------------

export const createSaleSchema = z
  .object({
    deviceId: z.string({ error: "Qurilma ID kiritilishi shart" }).min(1),
    customerName: z
      .string({ error: "Xaridor ismi kiritilishi shart" })
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak"),
    customerPhone: phoneSchema,
    salePrice: z
      .number({ error: "Sotish narxi kiritilishi shart" })
      .positive("Narx musbat son bo'lishi kerak"),
    paymentMethod: paymentMethodSchema,
    paidFully: z.boolean({ error: "To'liq to'langan yoki yo'qligi ko'rsatilishi shart" }),
    amountPaid: z.number().positive("To'langan summa musbat son bo'lishi kerak").optional(),
    dueDate: z.coerce.date().optional(),
    reminderEnabled: z.boolean().optional().default(false),
    earlyReminderEnabled: earlyReminderEnabledSchema,
    earlyReminderDays: earlyReminderDaysSchema,
    note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    inputCurrency: currencyCodeSchema.optional(),
  })
  .refine(
    (data) => {
      if (!data.paidFully && data.amountPaid === undefined) {
        return false
      }
      return true
    },
    {
      message: "To'lanmagan savdoda to'langan summa ko'rsatilishi shart",
      path: ['amountPaid'],
    },
  )
  .refine((data) => !data.earlyReminderEnabled || data.earlyReminderDays !== undefined, {
    message: "Necha kun oldin ekanligi kiritilishi shart",
    path: ['earlyReminderDays'],
  })
  .refine(
    (data) => data.amountPaid === undefined || data.amountPaid <= data.salePrice,
    {
      message: "To'langan summa sotuv narxidan oshmasligi kerak",
      path: ['amountPaid'],
    },
  )
  .refine(
    (data) => data.paidFully || (data.amountPaid ?? 0) < data.salePrice,
    {
      message: "Qisman savdoda to'langan summa sotuv narxidan kam bo'lishi kerak",
      path: ['amountPaid'],
    },
  )
  .refine(
    (data) => !data.paidFully || data.amountPaid === undefined || data.amountPaid === data.salePrice,
    {
      message: "To'liq savdoda to'langan summa sotuv narxiga teng bo'lishi kerak",
      path: ['amountPaid'],
    },
  )
  .refine(
    (data) => data.paidFully || data.dueDate !== undefined,
    {
      message: "Qolgan to'lov sanasi kiritilishi shart",
      path: ['dueDate'],
    },
  )

export type CreateSaleInput = z.infer<typeof createSaleSchema>

export const addSalePaymentSchema = z.object({
  amount: z
    .number({ error: "To'lov summasi kiritilishi shart" })
    .positive("To'lov summasi musbat bo'lishi kerak"),
  paymentMethod: paymentMethodSchema,
  paymentBreakdown: paymentBreakdownSchema,
  paidAt: z.coerce.date().optional(),
  nextDueDate: z.coerce.date().optional(),
  note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
  reason: z.string().max(1000, "Sabab 1000 ta belgidan oshmasligi kerak").optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  inputCurrency: currencyCodeSchema.optional(),
})

export type AddSalePaymentInput = z.infer<typeof addSalePaymentSchema>

// ---------------------------------------------------------------------------
// createNasiyaSchema
// ---------------------------------------------------------------------------

export const createNasiyaSchema = z
  .object({
    deviceId: z.string({ error: "Qurilma ID kiritilishi shart" }).min(1),
    customerName: z
      .string({ error: "Xaridor ismi kiritilishi shart" })
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak"),
    customerPhone: phoneSchema,
    passportPhotoUrl: privateFileKeySchema,
    totalAmount: z
      .number({ error: "Umumiy summa kiritilishi shart" })
      .positive("Summa musbat son bo'lishi kerak"),
    downPayment: z
      .number({ error: "Boshlang'ich to'lov kiritilishi shart" })
      .min(0, "Boshlang'ich to'lov manfiy bo'lmasligi kerak"),
    months: z
      .number({ error: "Oy soni kiritilishi shart" })
      .int("Oy soni butun son bo'lishi kerak")
      .min(1, "Kamida 1 oy bo'lishi kerak")
      .max(24, "Ko'pi bilan 24 oy bo'lishi mumkin"),
    interestPercent: z
      .number({ error: "Nasiya foizi kiritilishi shart" })
      .int("Nasiya foizi butun son bo'lishi kerak")
      .min(0, "Nasiya foizi manfiy bo'lmasligi kerak")
      .max(MAX_NASIYA_INTEREST_PERCENT, `Nasiya foizi ${MAX_NASIYA_INTEREST_PERCENT}% dan oshmasligi kerak`)
      .optional()
      .default(0),
    monthlyPayment: z.number().positive("Oylik to'lov musbat son bo'lishi kerak").optional(),
    // Item 6: when true, `monthlyPayment` (not `interestPercent`) is the
    // source of truth — the server derives interest FROM the monthly
    // payment (calculateNasiyaAmountsFromMonthlyPayment), mirroring exactly
    // what the create-nasiya form previewed. `interestPercent` is still
    // required by the schema above but is ignored in this mode.
    useMonthlyPaymentOverride: z.boolean().optional(),
    startDate: z.coerce.date({ error: "Boshlanish sanasi kiritilishi shart" }),
    paymentMethod: paymentMethodSchema,
    earlyReminderEnabled: earlyReminderEnabledSchema,
    earlyReminderDays: earlyReminderDaysSchema,
    note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    inputCurrency: currencyCodeSchema.optional(),
  })
  .refine((data) => data.downPayment <= data.totalAmount, {
    message: "Boshlang'ich to'lov umumiy summadan oshmasligi kerak",
    path: ['downPayment'],
  })
  .refine((data) => !data.earlyReminderEnabled || data.earlyReminderDays !== undefined, {
    message: "Necha kun oldin ekanligi kiritilishi shart",
    path: ['earlyReminderDays'],
  })
  .refine((data) => !data.useMonthlyPaymentOverride || data.monthlyPayment !== undefined, {
    message: "Oylik to'lov kiritilishi shart",
    path: ['monthlyPayment'],
  })

export type CreateNasiyaInput = z.infer<typeof createNasiyaSchema>

// ---------------------------------------------------------------------------
// importNasiyaSchema — manual import of an EXISTING (pre-Oryx) nasiya.
//
// This is carried-over debt, NOT a new sale. originalTotalAmount and
// alreadyPaidBeforeImport are informational; only remainingDebt drives the
// future schedule and only future payments count as collected money.
// ---------------------------------------------------------------------------

export const importNasiyaSchema = z
  .object({
    customerName: z
      .string({ error: "Xaridor ismi kiritilishi shart" })
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak"),
    customerPhone: phoneSchema,
    deviceModel: z.string({ error: "Qurilma nomi kiritilishi shart" }).min(1, "Qurilma nomi kiritilishi shart").max(120),
    imei: z.string().trim().refine((value) => !value || isValidImei(value), "IMEI 15 ta raqamdan iborat bo'lishi kerak").optional(),
    secondaryImei: z.string().trim().refine((value) => !value || isValidImei(value), "Ikkinchi IMEI 15 ta raqamdan iborat bo'lishi kerak").optional(),
    storage: z.string().trim().max(50, "Xotira 50 ta belgidan oshmasligi kerak").optional(),
    storageAmount: z.number().positive("Xotira hajmi 0 dan katta bo'lishi kerak").optional(),
    storageUnit: z.enum(['GB', 'TB']).optional(),
    conditionCode: z.enum(['NEW', 'USED'], { error: "Qurilma holati tanlanishi shart" }),
    color: z.string().trim().max(50, "Rang 50 ta belgidan oshmasligi kerak").optional(),
    batteryHealth: z.number().int().min(0).max(100).optional(),
    originalTotalAmount: z
      .number({ error: "Eski nasiya umumiy summasi kiritilishi shart" })
      .positive("Eski nasiya summasi musbat son bo'lishi kerak"),
    alreadyPaidBeforeImport: z
      .number({ error: "Importgacha to'langan summa kiritilishi shart" })
      .min(0, "Importgacha to'langan summa manfiy bo'lmasligi kerak")
      .default(0),
    remainingDebt: z
      .number({ error: "Qolgan qarz kiritilishi shart" })
      .positive("Qolgan qarz 0 dan katta bo'lishi kerak"),
    monthlyPayment: z
      .number({ error: "Oylik to'lov kiritilishi shart" })
      .positive("Oylik to'lov 0 dan katta bo'lishi kerak"),
    nextPaymentDate: z.coerce.date({ error: "Keyingi to'lov sanasi kiritilishi shart" }),
    originalSaleDate: z.coerce.date().optional(),
    totalMonths: z.number().int().min(1).max(60).optional(),
    importNote: z.string().trim().max(500).optional(),
    inputCurrency: currencyCodeSchema.optional(),
  })
  .refine((data) => data.remainingDebt <= data.originalTotalAmount, {
    message: "Qolgan qarz eski nasiya umumiy summasidan oshmasligi kerak",
    path: ['remainingDebt'],
  })
  .refine((data) => {
    const units = data.inputCurrency === 'USD' ? 100 : 1
    return Math.round(data.originalTotalAmount * units) ===
      Math.round((data.alreadyPaidBeforeImport + data.remainingDebt) * units)
  }, {
    message: "Eski nasiya jami to'langan summa va qolgan qarz yig'indisiga teng bo'lishi kerak",
    path: ['remainingDebt'],
  })
  .refine((data) => !data.secondaryImei || Boolean(data.imei), { message: 'Ikkinchi IMEI uchun asosiy IMEI ham kiritilishi kerak', path: ['secondaryImei'] })
  .refine((data) => !data.secondaryImei || data.secondaryImei.replace(/[\s-]/g, '') !== data.imei?.replace(/[\s-]/g, ''), { message: "Asosiy va ikkinchi IMEI bir xil bo'lishi mumkin emas", path: ['secondaryImei'] })
  .refine((data) => (data.storageAmount == null) === (data.storageUnit == null), { message: 'Xotira hajmi va birligi birga kiritilishi kerak', path: ['storageUnit'] })

export type ImportNasiyaInput = z.infer<typeof importNasiyaSchema>

// ---------------------------------------------------------------------------
// addNasiyaPaymentSchema
// ---------------------------------------------------------------------------

export const addNasiyaPaymentSchema = z
  .object({
    nasiyaScheduleId: z
      .string({ error: "Jadval ID kiritilishi shart" })
      .min(1),
    amount: z
      .number({ error: "To'lov summasi kiritilishi shart" })
      .min(0, "Summa manfiy bo'lmasligi kerak"),
    paymentMethod: paymentMethodSchema.optional(),
    paymentBreakdown: paymentBreakdownSchema,
    date: z.coerce.date({ error: "To'lov sanasi kiritilishi shart" }),
    delayedUntil: z.coerce.date().optional(),
    note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    deferredToNext: z.boolean().optional().default(false),
    inputCurrency: currencyCodeSchema.optional(),
  })
  .refine((data) => data.deferredToNext || data.amount > 0, {
    message: "To'lov summasi musbat son bo'lishi kerak",
    path: ['amount'],
  })
  .refine((data) => data.deferredToNext || data.paymentMethod !== undefined, {
    message: "To'lov usuli kiritilishi shart",
    path: ['paymentMethod'],
  })
  .refine((data) => !data.deferredToNext || (data.note?.trim().length ?? 0) >= 5, {
    message: "Kechiktirish sababi kamida 5 ta belgidan iborat bo'lishi kerak",
    path: ['note'],
  })
  .refine((data) => !data.deferredToNext || data.delayedUntil !== undefined, {
    message: "Yangi to'lov sanasi kiritilishi shart",
    path: ['delayedUntil'],
  })
  .refine((data) => !data.deferredToNext || data.amount === 0, {
    message: "Muddat uzaytirilganda to'lov summasi 0 bo'lishi kerak",
    path: ['amount'],
  })

export type AddNasiyaPaymentInput = z.infer<typeof addNasiyaPaymentSchema>

// ---------------------------------------------------------------------------
// addShopPaymentSchema
// ---------------------------------------------------------------------------

export const addShopPaymentSchema = z.object({
  shopId: z.string({ error: "Do'kon ID kiritilishi shart" }).min(1),
  amount: z
    .number({ error: "To'lov summasi kiritilishi shart" })
    .positive("Summa musbat son bo'lishi kerak"),
  months: z
    .number({ error: "Oy soni kiritilishi shart" })
    .int("Oy soni butun son bo'lishi kerak")
    .min(1, "Kamida 1 oy bo'lishi kerak"),
  paymentMethod: paymentMethodSchema,
  note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
})

export type AddShopPaymentInput = z.infer<typeof addShopPaymentSchema>

// ---------------------------------------------------------------------------
// createOlibSotdimSchema — "Olib-sotdim": source a device from another
// shop/person and sell it to our customer in the same operation.
// ---------------------------------------------------------------------------

export const createOlibSotdimSchema = z
  .object({
    // Section 1 — device
    model: z.string({ error: "Model kiritilishi shart" }).min(1, "Model bo'sh bo'lmasligi kerak").max(120),
    color: z.string().max(50, "Rang 50 ta belgidan oshmasligi kerak").optional(),
    storageAmount: z.number().positive("Xotira hajmi 0 dan katta bo'lishi kerak"),
    storageUnit: z.enum(['GB', 'TB']),
    batteryHealth: z.number().int().min(0).max(100).optional(),
    conditionCode: z.enum(['NEW', 'USED'], { error: "Qurilma holati tanlanishi shart" }),
    imei: z.string({ error: "IMEI kiritilishi shart" }).trim().refine(isValidImei, "IMEI 15 ta raqamdan iborat bo'lishi kerak"),
    secondaryImei: z.string().trim().refine((value) => !value || isValidImei(value), "Ikkinchi IMEI 15 ta raqamdan iborat bo'lishi kerak").optional(),
    deviceNote: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    imageUrls: z.array(deviceImageKeySchema).optional(),

    // Section 2 — supplier ("kimdan olindi")
    supplierName: z
      .string({ error: "Yetkazib beruvchi ismi kiritilishi shart" })
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(150, "Ism 150 ta belgidan oshmasligi kerak"),
    supplierPhone: phoneSchema,
    supplierLocation: z.string().max(200, "Manzil 200 ta belgidan oshmasligi kerak").optional(),
    supplierNote: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    purchasePrice: z
      .number({ error: "Olingan narx kiritilishi shart" })
      .positive("Narx musbat son bo'lishi kerak"),
    supplierPaidNow: z.boolean({ error: "To'lov holati ko'rsatilishi shart" }),
    supplierPaymentMethod: paymentMethodSchema.optional(),
    supplierPaidDate: z.coerce.date().optional(),
    supplierDueDate: z.coerce.date().optional(),
    supplierReminderEnabled: z.boolean().optional().default(true),
    earlyReminderEnabled: earlyReminderEnabledSchema,
    earlyReminderDays: earlyReminderDaysSchema,

    // Section 3 — customer ("kimga sotildi")
    customerName: z
      .string({ error: "Xaridor ismi kiritilishi shart" })
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak"),
    customerPhone: phoneSchema,

    // Section 4 — sale to the customer (mirrors createSaleSchema)
    salePrice: z
      .number({ error: "Sotish narxi kiritilishi shart" })
      .positive("Narx musbat son bo'lishi kerak"),
    paymentMethod: paymentMethodSchema,
    paidFully: z.boolean({ error: "To'liq to'langan yoki yo'qligi ko'rsatilishi shart" }),
    amountPaid: z.number().positive("To'langan summa musbat son bo'lishi kerak").optional(),
    dueDate: z.coerce.date().optional(),
    customerReminderEnabled: z.boolean().optional().default(false),
    note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    inputCurrency: currencyCodeSchema.optional(),
  })
  .refine((data) => !data.secondaryImei || data.secondaryImei.replace(/[\s-]/g, '') !== data.imei.replace(/[\s-]/g, ''), {
    message: "Asosiy va ikkinchi IMEI bir xil bo'lishi mumkin emas",
    path: ['secondaryImei'],
  })
  .refine((data) => !data.supplierPaidNow || data.supplierPaymentMethod !== undefined, {
    message: "Yetkazib beruvchiga to'lov usuli kiritilishi shart",
    path: ['supplierPaymentMethod'],
  })
  .refine((data) => data.supplierPaidNow || data.supplierDueDate !== undefined, {
    message: "Yetkazib beruvchiga to'lov muddati kiritilishi shart",
    path: ['supplierDueDate'],
  })
  .refine((data) => !data.earlyReminderEnabled || data.earlyReminderDays !== undefined, {
    message: "Necha kun oldin ekanligi kiritilishi shart",
    path: ['earlyReminderDays'],
  })
  .refine(
    (data) => {
      if (!data.paidFully && data.amountPaid === undefined) return false
      return true
    },
    { message: "To'lanmagan savdoda to'langan summa ko'rsatilishi shart", path: ['amountPaid'] },
  )
  .refine((data) => data.amountPaid === undefined || data.amountPaid <= data.salePrice, {
    message: "To'langan summa sotuv narxidan oshmasligi kerak",
    path: ['amountPaid'],
  })
  .refine((data) => data.paidFully || (data.amountPaid ?? 0) < data.salePrice, {
    message: "Qisman savdoda to'langan summa sotuv narxidan kam bo'lishi kerak",
    path: ['amountPaid'],
  })
  .refine((data) => data.paidFully || data.dueDate !== undefined, {
    message: "Qolgan to'lov sanasi kiritilishi shart",
    path: ['dueDate'],
  })

export type CreateOlibSotdimInput = z.infer<typeof createOlibSotdimSchema>

// ---------------------------------------------------------------------------
// markSupplierPayablePaidSchema
// ---------------------------------------------------------------------------

export const markSupplierPayablePaidSchema = z.object({
  paymentMethod: paymentMethodSchema,
  paidAt: z.coerce.date().optional(),
  note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
  inputCurrency: currencyCodeSchema.optional(),
})

export type MarkSupplierPayablePaidInput = z.infer<typeof markSupplierPayablePaidSchema>
