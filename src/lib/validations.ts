/**
 * Zod v4 validation schemas for Oryx Tech ERP.
 * All error messages are in Uzbek.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const phoneSchema = z
  .string({ error: "Telefon raqam kiritilishi shart" })
  .min(9, "Telefon raqam kamida 9 ta raqam bo'lishi kerak")
  .max(20, "Telefon raqam 20 ta belgidan oshmasligi kerak")

const passwordSchema = z
  .string({ error: "Parol kiritilishi shart" })
  .min(6, "Parol kamida 6 ta belgidan iborat bo'lishi kerak")

const paymentMethodSchema = z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER'], {
  error: "To'lov usuli noto'g'ri",
})

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
  name: z.string({ error: "Admin ismi kiritilishi shart" }).min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak"),
  phone: phoneSchema,
  telegramId: z.string().optional(),
  login: z
    .string({ error: "Login kiritilishi shart" })
    .min(3, "Login kamida 3 ta belgidan iborat bo'lishi kerak")
    .regex(/^[a-zA-Z0-9_]+$/, "Login faqat lotin harflari, raqamlar va _ belgisidan iborat bo'lishi kerak"),
  password: passwordSchema,
})

export const createShopSchema = z.object({
  name: z
    .string({ error: "Do'kon nomi kiritilishi shart" })
    .min(2, "Do'kon nomi kamida 2 ta harfdan iborat bo'lishi kerak"),
  ownerName: z
    .string({ error: "Egasi ismi kiritilishi shart" })
    .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak"),
  ownerPhone: phoneSchema,
  shopNumber: z
    .string({ error: "Do'kon raqami kiritilishi shart" })
    .min(1, "Do'kon raqami bo'sh bo'lmasligi kerak"),
  address: z.string().optional(),
  note: z.string().optional(),
  admins: z
    .array(shopAdminInputSchema)
    .min(1, "Kamida bitta admin qo'shilishi shart"),
})

export type CreateShopInput = z.infer<typeof createShopSchema>

// ---------------------------------------------------------------------------
// addDeviceSchema
// ---------------------------------------------------------------------------

export const addDeviceSchema = z.object({
  model: z
    .string({ error: "Model kiritilishi shart" })
    .min(1, "Model bo'sh bo'lmasligi kerak"),
  color: z.string().optional(),
  storage: z.string().optional(),
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
    .min(5, "IMEI juda qisqa")
    .max(32, "IMEI juda uzun"),
  supplierName: z.string().optional(),
  supplierPhone: phoneSchema.optional(),
  note: z.string().optional(),
  imageUrls: z.array(z.string().url("Rasm URL noto'g'ri formatda")).optional(),
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
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak"),
    customerPhone: phoneSchema,
    salePrice: z
      .number({ error: "Sotish narxi kiritilishi shart" })
      .positive("Narx musbat son bo'lishi kerak"),
    paymentMethod: paymentMethodSchema,
    paidFully: z.boolean({ error: "To'liq to'langan yoki yo'qligi ko'rsatilishi shart" }),
    amountPaid: z.number().positive("To'langan summa musbat son bo'lishi kerak").optional(),
    dueDate: z.coerce.date().optional(),
    reminderEnabled: z.boolean().optional().default(false),
    note: z.string().optional(),
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
  paidAt: z.coerce.date().optional(),
  nextDueDate: z.coerce.date().optional(),
  note: z.string().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
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
      .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak"),
    customerPhone: phoneSchema,
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
    monthlyPayment: z
      .number({ error: "Oylik to'lov kiritilishi shart" })
      .positive("Oylik to'lov musbat son bo'lishi kerak"),
    startDate: z.coerce.date({ error: "Boshlanish sanasi kiritilishi shart" }),
    paymentMethod: paymentMethodSchema,
    appleIdNote: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((data) => data.downPayment <= data.totalAmount, {
    message: "Boshlang'ich to'lov umumiy summadan oshmasligi kerak",
    path: ['downPayment'],
  })
  .refine(
    (data) => Math.abs(data.monthlyPayment * data.months - (data.totalAmount - data.downPayment)) <= 1,
    {
      message: "Oylik to'lovlar qolgan summa bilan mos emas",
      path: ['monthlyPayment'],
    },
  )

export type CreateNasiyaInput = z.infer<typeof createNasiyaSchema>

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
    date: z.coerce.date({ error: "To'lov sanasi kiritilishi shart" }),
    delayedUntil: z.coerce.date().optional(),
    note: z.string().optional(),
    deferredToNext: z.boolean().optional().default(false),
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
  note: z.string().optional(),
})

export type AddShopPaymentInput = z.infer<typeof addShopPaymentSchema>
