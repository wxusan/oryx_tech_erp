/**
 * Zod v4 validation schemas for Oryx Tech ERP.
 * All error messages are in Uzbek.
 */

import { z } from 'zod'
import { MAX_NASIYA_INTEREST_PERCENT } from '@/lib/nasiya-utils'
import { isValidPhone, normalizeUzPhone, PHONE_ERROR } from '@/lib/phone'
import { isValidPassportIdentifier } from '@/lib/passport-identifier-format'
import { isValidImei } from '@/lib/device-specs'
import {
  BCRYPT_PASSWORD_TOO_LONG_MESSAGE,
  isBcryptPasswordWithinLimit,
} from '@/lib/password-policy'
import { shopAccessModeSchema, shopPackageDraftSchema } from '@/lib/shop-package-contract'

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

const opaquePrivateReferencePattern = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

function isPrivateUploadInput(value: string, kind: 'device' | 'passport') {
  if (opaquePrivateReferencePattern.test(value)) return true

  const storageDirectory = kind === 'device' ? 'devices' : 'passports'
  if (new RegExp(`^shops/[^/]+/${storageDirectory}/[^/]+$`).test(value)) return true

  if (!value.startsWith(`/api/uploads/${kind}?`)) return false
  try {
    const url = new URL(value, 'http://oryx.invalid')
    const reference = url.searchParams.get('reference')
    return url.origin === 'http://oryx.invalid' &&
      url.pathname === `/api/uploads/${kind}` &&
      url.searchParams.size === 1 &&
      Boolean(reference && opaquePrivateReferencePattern.test(reference))
  } catch {
    return false
  }
}

const privateUploadInputSchema = (kind: 'device' | 'passport', tooLongMessage: string) => z
  .string()
  .trim()
  .min(1)
  .max(2_048, tooLongMessage)
  .refine((value) => isPrivateUploadInput(value, kind), 'Rasm havolasi yaroqsiz')

const deviceImageKeySchema = privateUploadInputSchema('device', 'Rasm havolasi juda uzun')

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

// Supplier debt payments intentionally support either one method or exactly
// two methods. Keeping this stricter contract separate avoids changing the
// already-deployed Sale and Nasiya payment behavior.
const supplierPaymentBreakdownSchema = z
  .array(
    z.object({
      method: paymentMethodSchema,
      amount: z.number().positive("Har bir qism musbat summa bo'lishi kerak"),
    }),
  )
  .length(2, "Aralash to'lovda aynan 2 ta usul bo'lishi kerak")
  .optional()

// "Ertaroq eslatilsinmi?" — shared by nasiya creation and later-payment sale.
const earlyReminderEnabledSchema = z.boolean().optional().default(false)
const earlyReminderDaysSchema = z
  .number({ error: "Kunlar soni kiritilishi shart" })
  .int("Kunlar soni butun son bo'lishi kerak")
  .min(1, "Kamida 1 kun bo'lishi kerak")
  .max(60, "Ko'pi bilan 60 kun bo'lishi mumkin")
  .optional()

const privateFileKeySchema = privateUploadInputSchema('passport', 'Pasport rasmi havolasi juda uzun')

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
  accessMode: shopAccessModeSchema.optional(),
  package: shopPackageDraftSchema.optional(),
  admins: z
    .array(shopAdminInputSchema)
    .min(1, "Kamida bitta admin qo'shilishi shart")
    .max(20, "Ko'pi bilan 20 ta admin qo'shish mumkin"),
}).superRefine((value, context) => {
  const accessMode = value.accessMode ?? (value.admins.length > 1 ? 'OWNER_AND_STAFF' : 'OWNER_ONLY')
  if (accessMode === 'OWNER_ONLY' && value.admins.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['admins'],
      message: 'Faqat do‘kon egasi rejimida aynan bitta kirish profili bo‘lishi kerak',
    })
  }
  if (accessMode === 'OWNER_AND_STAFF' && value.admins.length < 2) {
    context.addIssue({
      code: 'custom',
      path: ['admins'],
      message: 'Do‘kon egasi va xodimlar rejimida kamida ikkita kirish profili bo‘lishi kerak',
    })
  }
  if (value.package) {
    const staffEnabled = value.package.features.find((item) => item.featureCode === 'STAFF_ACCESS')?.enabled
    const expected = accessMode === 'OWNER_AND_STAFF'
    if (staffEnabled !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['package', 'features'],
        message: 'Xodimlar uchun kirish tanlangan kirish rejimiga mos bo‘lishi kerak',
      })
    }
  }
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
  color: z
    .string({ error: "Rang kiritilishi shart" })
    .trim()
    .min(1, "Rang kiritilishi shart")
    .max(50, "Rang 50 ta belgidan oshmasligi kerak"),
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
  secondaryImei: z.string().trim().refine((value) => !value || isValidImei(value), 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak').optional(),
  supplierName: z.string().max(100, "Ta'minotchi nomi 100 ta belgidan oshmasligi kerak").optional(),
  supplierPhone: phoneSchema.optional(),
  note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
  imageUrls: z.array(deviceImageKeySchema).optional(),
  inputCurrency: currencyCodeSchema.optional(),
  purchaseSettlement: z.enum(['PAID_NOW', 'PAY_LATER']).optional().default('PAID_NOW'),
  supplierDueDate: z.coerce.date().optional(),
  supplierReminderEnabled: z.boolean().optional().default(true),
  earlyReminderEnabled: earlyReminderEnabledSchema,
  earlyReminderDays: earlyReminderDaysSchema,
  supplierInitialPaymentAmount: z.number().min(0, "Boshlang'ich to'lov manfiy bo'lmasligi kerak").optional(),
  supplierPaymentMethod: paymentMethodSchema.optional(),
  supplierPaymentBreakdown: supplierPaymentBreakdownSchema,
}).refine((data) => !data.secondaryImei || data.secondaryImei.replace(/[\s-]/g, '') !== data.imei.replace(/[\s-]/g, ''), {
  message: 'Asosiy va qo‘shimcha IMEI bir xil bo‘lishi mumkin emas',
  path: ['secondaryImei'],
}).refine((data) => data.purchaseSettlement !== 'PAY_LATER' || Boolean(data.supplierName && data.supplierPhone), {
  message: "Keyin to'lash uchun yetkazib beruvchi ismi va telefoni kiritilishi shart",
  path: ['supplierName'],
}).refine((data) => data.purchaseSettlement !== 'PAY_LATER' || data.supplierDueDate !== undefined, {
  message: "Yetkazib beruvchiga to'lov muddati kiritilishi shart",
  path: ['supplierDueDate'],
}).refine((data) => !data.earlyReminderEnabled || data.earlyReminderDays !== undefined, {
  message: "Necha kun oldin ekanligi kiritilishi shart",
  path: ['earlyReminderDays'],
}).refine((data) => (data.supplierInitialPaymentAmount ?? 0) <= data.purchasePrice, {
  message: "Boshlang'ich to'lov xarid narxidan oshmasligi kerak",
  path: ['supplierInitialPaymentAmount'],
}).refine((data) => data.purchaseSettlement !== 'PAY_LATER' || (data.supplierInitialPaymentAmount ?? 0) < data.purchasePrice, {
  message: "Keyin to'lashda boshlang'ich to'lov xarid narxidan kam bo'lishi kerak",
  path: ['supplierInitialPaymentAmount'],
}).refine((data) => (data.supplierInitialPaymentAmount ?? 0) === 0 || data.supplierPaymentMethod !== undefined || data.supplierPaymentBreakdown !== undefined, {
  message: "Pul to'langanda to'lov usuli kiritilishi shart",
  path: ['supplierPaymentMethod'],
})

export type AddDeviceInput = z.infer<typeof addDeviceSchema>

// ---------------------------------------------------------------------------
// createSaleSchema
// ---------------------------------------------------------------------------

export const createSaleSchema = z
  .object({
    deviceId: z.string({ error: "Qurilma ID kiritilishi shart" }).min(1),
    customerMode: z.enum(['EXISTING', 'NEW']).optional().default('NEW'),
    customerId: z.string().min(1).optional(),
    customerName: z
      .string()
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak")
      .optional(),
    customerPhone: phoneSchema.optional(),
    salePrice: z
      .number({ error: "Sotish narxi kiritilishi shart" })
      .positive("Narx musbat son bo'lishi kerak"),
    paymentMethod: paymentMethodSchema.optional(),
    paidFully: z.boolean({ error: "To'liq to'langan yoki yo'qligi ko'rsatilishi shart" }),
    amountPaid: z.number().min(0, "To'langan summa manfiy bo'lishi mumkin emas").optional(),
    dueDate: z.coerce.date().optional(),
    reminderEnabled: z.boolean().optional().default(false),
    earlyReminderEnabled: earlyReminderEnabledSchema,
    earlyReminderDays: earlyReminderDaysSchema,
    note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    inputCurrency: currencyCodeSchema.optional(),
  })
  .refine((data) => data.customerMode !== 'EXISTING' || Boolean(data.customerId), {
    message: 'Mavjud mijoz tanlanishi shart',
    path: ['customerId'],
  })
  .refine((data) => data.customerMode !== 'NEW' || Boolean(data.customerName && data.customerPhone), {
    message: "Yangi mijozning ismi va telefoni kiritilishi shart",
    path: ['customerName'],
  })
  .refine((data) => !(data.paidFully || (data.amountPaid ?? 0) > 0) || data.paymentMethod !== undefined, {
    message: "Pul qabul qilinganda to'lov usuli kiritilishi shart",
    path: ['paymentMethod'],
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
  // Payment notes are ordinary optional context. Normalize blank input at the
  // validation boundary so UI/API/audit rows never disagree about whether an
  // empty comment exists.
  note: z.string().trim().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
  reason: z.string().trim().max(1000, "Sabab 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
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
    customerMode: z.enum(['EXISTING', 'NEW']).optional().default('NEW'),
    customerId: z.string().min(1).optional(),
    customerName: z
      .string()
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak")
      .optional(),
    customerPhone: phoneSchema.optional(),
    customerAdditionalPhones: z.array(z.string()).max(5).optional(),
    customerNote: z.string().trim().max(1000, "Mijoz izohi 1000 ta belgidan oshmasligi kerak").optional(),
    customerPassportIdentifier: z
      .string()
      .trim()
      .refine(isValidPassportIdentifier, "Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")
      .optional(),
    customerTrustOverride: z.enum(['NEW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).nullable().optional(),
    passportPhotoUrl: privateFileKeySchema.optional(),
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
  .refine((data) => data.customerMode !== 'EXISTING' || Boolean(data.customerId), {
    message: 'Mavjud mijoz tanlanishi shart',
    path: ['customerId'],
  })
  .refine((data) => data.customerMode !== 'NEW' || Boolean(data.customerName && data.customerPhone), {
    message: "Yangi mijozning ismi va telefoni kiritilishi shart",
    path: ['customerName'],
  })
  .refine((data) => data.customerMode !== 'NEW' || Boolean(data.passportPhotoUrl), {
    message: 'Yangi nasiya mijozining pasport rasmi kiritilishi shart',
    path: ['passportPhotoUrl'],
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
    passportPhotoUrl: privateFileKeySchema.optional(),
    deviceModel: z.string({ error: "Qurilma nomi kiritilishi shart" }).min(1, "Qurilma nomi kiritilishi shart").max(120),
    imei: z.string().trim().refine((value) => !value || isValidImei(value), "IMEI 15 ta raqamdan iborat bo'lishi kerak").optional(),
    secondaryImei: z.string().trim().refine((value) => !value || isValidImei(value), 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak').optional(),
    storage: z.string().trim().max(50, "Xotira 50 ta belgidan oshmasligi kerak").optional(),
    storageAmount: z.number().positive("Xotira hajmi 0 dan katta bo'lishi kerak").optional(),
    storageUnit: z.enum(['GB', 'TB']).optional(),
    conditionCode: z.enum(['NEW', 'USED'], { error: "Qurilma holati tanlanishi shart" }),
    color: z.string().trim().max(50, "Rang 50 ta belgidan oshmasligi kerak").optional(),
    batteryHealth: z.number().int().min(0).max(100).optional(),
    originalTotalAmount: z
      .number({ error: 'Avvalgi nasiya umumiy summasi kiritilishi shart' })
      .positive('Avvalgi nasiya summasi musbat son bo‘lishi kerak'),
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
    message: 'Qolgan qarz avvalgi nasiya umumiy summasidan oshmasligi kerak',
    path: ['remainingDebt'],
  })
  .refine((data) => {
    const units = data.inputCurrency === 'USD' ? 100 : 1
    return Math.round(data.originalTotalAmount * units) ===
      Math.round((data.alreadyPaidBeforeImport + data.remainingDebt) * units)
  }, {
    message: 'Avvalgi nasiya jami to‘langan summa va qolgan qarz yig‘indisiga teng bo‘lishi kerak',
    path: ['remainingDebt'],
  })
  .refine((data) => !data.secondaryImei || Boolean(data.imei), { message: 'Qo‘shimcha IMEI uchun asosiy IMEI ham kiritilishi kerak', path: ['secondaryImei'] })
  .refine((data) => !data.secondaryImei || data.secondaryImei.replace(/[\s-]/g, '') !== data.imei?.replace(/[\s-]/g, ''), { message: 'Asosiy va qo‘shimcha IMEI bir xil bo‘lishi mumkin emas', path: ['secondaryImei'] })
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
      .positive("To'lov summasi musbat son bo'lishi kerak"),
    paymentMethod: paymentMethodSchema,
    paymentBreakdown: paymentBreakdownSchema,
    date: z.coerce.date({ error: "To'lov sanasi kiritilishi shart" }),
    // A regular payment can be recorded without an explanatory comment.
    note: z.string().trim().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
    inputCurrency: currencyCodeSchema.optional(),
  })

export type AddNasiyaPaymentInput = z.infer<typeof addNasiyaPaymentSchema>

// Early settlement is a fixed, server-calculated command. The three minor-unit
// snapshots are optimistic-concurrency guards from the quote the user reviewed;
// they are never trusted as accounting inputs.
export const settleNasiyaSchema = z
  .object({
    mode: z.enum(['FULL_WITH_PROFIT', 'WAIVE_REMAINING_PROFIT']),
    paymentMethod: paymentMethodSchema.optional(),
    paymentBreakdown: paymentBreakdownSchema,
    date: z.coerce.date({ error: "Yopish sanasi kiritilishi shart" }),
    reason: z.string().trim().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
    inputCurrency: currencyCodeSchema.optional(),
    expectedContractCurrency: currencyCodeSchema,
    expectedRemainingMinorUnits: z.number().int().positive(),
    expectedCashMinorUnits: z.number().int().min(0),
    expectedWaivedMinorUnits: z.number().int().min(0),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'WAIVE_REMAINING_PROFIT' && (!data.reason || data.reason.length < 3)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: "Foydadan kechish sababi kamida 3 ta belgidan iborat bo'lishi kerak",
      })
    }
    if (data.expectedCashMinorUnits > 0 && !data.paymentMethod && !data.paymentBreakdown) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMethod'],
        message: "To'lov usuli tanlanishi shart",
      })
    }
    if (data.expectedCashMinorUnits === 0 && (data.paymentMethod || data.paymentBreakdown)) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMethod'],
        message: "Pul olinmaydigan yopishda to'lov usuli kiritilmaydi",
      })
    }
  })

export type SettleNasiyaInput = z.infer<typeof settleNasiyaSchema>

// Deferral is deliberately a separate command from payment. It has no amount,
// payment method, or payment breakdown and therefore cannot accidentally write
// money through the payment endpoint.
export const deferNasiyaScheduleSchema = z.object({
  nasiyaScheduleId: z.string({ error: "Jadval ID kiritilishi shart" }).min(1),
  newDueDate: z.coerce.date({ error: "Yangi to'lov sanasi kiritilishi shart" }),
  // This is an operational note, not a destructive write-off reason. Keep
  // the immutable deferral event, but do not block a valid due-date change
  // because its optional comment was left blank.
  reason: z
    .string()
    .trim()
    .max(1000, "Izoh 1000 ta belgidan oshmasligi kerak")
    .optional()
    .transform((value) => value || undefined),
})

export type DeferNasiyaScheduleInput = z.infer<typeof deferNasiyaScheduleSchema>

export const resolveNasiyaSchema = z.object({
  action: z.enum(['ARCHIVE', 'REOPEN']),
  reason: z
    .string({ error: "Sabab kiritilishi shart" })
    .trim()
    .min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak")
    .max(1000, "Sabab 1000 ta belgidan oshmasligi kerak"),
})

export type ResolveNasiyaInput = z.infer<typeof resolveNasiyaSchema>

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
    .min(1, "Kamida 1 oy bo'lishi kerak")
    .max(120, "Ko'pi bilan 120 oy bo'lishi mumkin"),
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
    secondaryImei: z.string().trim().refine((value) => !value || isValidImei(value), 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak').optional(),
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
    supplierPaymentBreakdown: supplierPaymentBreakdownSchema,
    supplierInitialPaymentAmount: z.number().min(0, "Boshlang'ich to'lov manfiy bo'lmasligi kerak").optional(),
    supplierPaidDate: z.coerce.date().optional(),
    supplierDueDate: z.coerce.date().optional(),
    supplierReminderEnabled: z.boolean().optional().default(true),
    earlyReminderEnabled: earlyReminderEnabledSchema,
    earlyReminderDays: earlyReminderDaysSchema,

    // Section 3 — customer ("kimga sotildi")
    customerMode: z.enum(['EXISTING', 'NEW']).optional().default('NEW'),
    customerId: z.string().min(1).optional(),
    customerName: z
      .string()
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      .max(100, "Ism 100 ta belgidan oshmasligi kerak")
      .optional(),
    customerPhone: phoneSchema.optional(),
    customerAdditionalPhones: z.array(z.string()).max(5).optional(),
    customerNote: z.string().trim().max(1000, "Mijoz izohi 1000 ta belgidan oshmasligi kerak").optional(),
    customerPassportIdentifier: z
      .string()
      .trim()
      .refine(isValidPassportIdentifier, "Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")
      .optional(),
    customerTrustOverride: z.enum(['NEW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).nullable().optional(),
    passportPhotoUrl: privateFileKeySchema.optional(),

    // Section 4 — customer outcome. SALE keeps the deployed behavior; NASIYA
    // uses the same calculator/schedule inputs as standalone Nasiya.
    customerDealType: z.enum(['SALE', 'NASIYA']).optional().default('SALE'),
    salePrice: z
      .number()
      .positive("Narx musbat son bo'lishi kerak")
      .optional(),
    paymentMethod: paymentMethodSchema.optional(),
    paymentBreakdown: supplierPaymentBreakdownSchema,
    paidFully: z.boolean().optional(),
    amountPaid: z.number().min(0, "To'langan summa manfiy bo'lishi mumkin emas").optional(),
    dueDate: z.coerce.date().optional(),
    customerReminderEnabled: z.boolean().optional().default(false),
    customerEarlyReminderEnabled: z.boolean().optional().default(false),
    customerEarlyReminderDays: earlyReminderDaysSchema,
    totalAmount: z.number().positive("Nasiya summasi musbat bo'lishi kerak").optional(),
    downPayment: z.number().min(0, "Boshlang'ich to'lov manfiy bo'lmasligi kerak").optional(),
    months: z.number().int().min(1).max(24).optional(),
    interestPercent: z.number().int().min(0).max(MAX_NASIYA_INTEREST_PERCENT).optional().default(0),
    monthlyPayment: z.number().positive("Oylik to'lov musbat son bo'lishi kerak").optional(),
    useMonthlyPaymentOverride: z.boolean().optional(),
    startDate: z.coerce.date().optional(),
    nasiyaPaymentMethod: paymentMethodSchema.optional(),
    note: z.string().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
    inputCurrency: currencyCodeSchema.optional(),
    purchaseInputCurrency: currencyCodeSchema.optional(),
    customerInputCurrency: currencyCodeSchema.optional(),
  })
  .refine((data) => data.customerMode !== 'EXISTING' || Boolean(data.customerId), {
    message: 'Mavjud mijoz tanlanishi shart',
    path: ['customerId'],
  })
  .refine((data) => data.customerMode !== 'NEW' || Boolean(data.customerName && data.customerPhone), {
    message: "Yangi mijozning ismi va telefoni kiritilishi shart",
    path: ['customerName'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.customerMode !== 'NEW' || Boolean(data.passportPhotoUrl), {
    message: 'Yangi nasiya mijozining pasport rasmi kiritilishi shart',
    path: ['passportPhotoUrl'],
  })
  .refine((data) => data.customerDealType !== 'SALE' || data.salePrice !== undefined, {
    message: "Sotish narxi kiritilishi shart",
    path: ['salePrice'],
  })
  .refine((data) => data.customerDealType !== 'SALE' || data.paidFully !== undefined, {
    message: "To'liq to'langan yoki yo'qligi ko'rsatilishi shart",
    path: ['paidFully'],
  })
  .refine((data) => data.customerDealType !== 'SALE' || !(data.paidFully || (data.amountPaid ?? 0) > 0) || data.paymentMethod !== undefined || data.paymentBreakdown !== undefined, {
    message: "Pul qabul qilinganda to'lov usuli kiritilishi shart",
    path: ['paymentMethod'],
  })
  .refine((data) => !data.secondaryImei || data.secondaryImei.replace(/[\s-]/g, '') !== data.imei.replace(/[\s-]/g, ''), {
    message: 'Asosiy va qo‘shimcha IMEI bir xil bo‘lishi mumkin emas',
    path: ['secondaryImei'],
  })
  .refine((data) => !data.supplierPaidNow || data.supplierPaymentMethod !== undefined || data.supplierPaymentBreakdown !== undefined, {
    message: "Yetkazib beruvchiga to'lov usuli kiritilishi shart",
    path: ['supplierPaymentMethod'],
  })
  .refine((data) => (data.supplierInitialPaymentAmount ?? 0) === 0 || data.supplierPaymentMethod !== undefined || data.supplierPaymentBreakdown !== undefined, {
    message: "Yetkazib beruvchiga pul to'langanda to'lov usuli kiritilishi shart",
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
      if (data.customerDealType === 'SALE' && !data.paidFully && data.amountPaid === undefined) return false
      return true
    },
    { message: "To'lanmagan savdoda to'langan summa ko'rsatilishi shart", path: ['amountPaid'] },
  )
  .refine((data) => data.customerDealType !== 'SALE' || data.amountPaid === undefined || (data.salePrice !== undefined && data.amountPaid <= data.salePrice), {
    message: "To'langan summa sotuv narxidan oshmasligi kerak",
    path: ['amountPaid'],
  })
  .refine((data) => data.customerDealType !== 'SALE' || data.paidFully || (data.salePrice !== undefined && (data.amountPaid ?? 0) < data.salePrice), {
    message: "Qisman savdoda to'langan summa sotuv narxidan kam bo'lishi kerak",
    path: ['amountPaid'],
  })
  .refine((data) => data.customerDealType !== 'SALE' || data.paidFully || data.dueDate !== undefined, {
    message: "Qolgan to'lov sanasi kiritilishi shart",
    path: ['dueDate'],
  })
  .refine((data) => !data.customerEarlyReminderEnabled || data.customerEarlyReminderDays !== undefined, {
    message: "Mijoz eslatmasi uchun necha kun oldin ekanligi kiritilishi shart",
    path: ['customerEarlyReminderDays'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.totalAmount !== undefined, {
    message: 'Nasiya umumiy summasi kiritilishi shart',
    path: ['totalAmount'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.downPayment !== undefined, {
    message: "Boshlang'ich to'lov kiritilishi shart",
    path: ['downPayment'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.months !== undefined, {
    message: 'Nasiya oylar soni kiritilishi shart',
    path: ['months'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.startDate !== undefined, {
    message: 'Nasiya boshlanish sanasi kiritilishi shart',
    path: ['startDate'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.nasiyaPaymentMethod !== undefined, {
    message: "Nasiya to'lov usuli kiritilishi shart",
    path: ['nasiyaPaymentMethod'],
  })
  .refine((data) => data.customerDealType !== 'NASIYA' || data.downPayment === undefined || data.totalAmount === undefined || data.downPayment <= data.totalAmount, {
    message: "Boshlang'ich to'lov umumiy summadan oshmasligi kerak",
    path: ['downPayment'],
  })
  .refine((data) => !data.useMonthlyPaymentOverride || data.monthlyPayment !== undefined, {
    message: "Oylik to'lov kiritilishi shart",
    path: ['monthlyPayment'],
  })
  .refine((data) => (data.supplierInitialPaymentAmount ?? (data.supplierPaidNow ? data.purchasePrice : 0)) <= data.purchasePrice, {
    message: "Boshlang'ich to'lov xarid narxidan oshmasligi kerak",
    path: ['supplierInitialPaymentAmount'],
  })
  .refine((data) => data.supplierPaidNow || (data.supplierInitialPaymentAmount ?? 0) < data.purchasePrice, {
    message: "Keyin to'lashda boshlang'ich to'lov xarid narxidan kam bo'lishi kerak",
    path: ['supplierInitialPaymentAmount'],
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

export const recordSupplierPayablePaymentSchema = z.object({
  amount: z.number({ error: "To'lov summasi kiritilishi shart" }).positive("To'lov summasi musbat bo'lishi kerak"),
  paymentMethod: paymentMethodSchema,
  paymentBreakdown: supplierPaymentBreakdownSchema,
  paidAt: z.coerce.date().optional(),
  note: z.string().trim().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
  idempotencyKey: z.string().min(8).max(120).optional(),
  inputCurrency: currencyCodeSchema.optional(),
})

export type RecordSupplierPayablePaymentInput = z.infer<typeof recordSupplierPayablePaymentSchema>
