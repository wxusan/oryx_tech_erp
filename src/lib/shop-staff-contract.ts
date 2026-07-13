import { z } from 'zod'
import {
  SHOP_PERMISSION_CATALOG,
  SHOP_PERMISSION_CODES,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { passwordSchema, phoneSchema } from '@/lib/validations'

export const staffAssignablePermissionCodes = SHOP_PERMISSION_CATALOG
  .filter((permission) => !permission.ownerOnly)
  .map((permission) => permission.code)

export type StaffAssignablePermissionCode = (typeof staffAssignablePermissionCodes)[number]

const permissionCodesSchema = z.array(z.enum(SHOP_PERMISSION_CODES))
  .max(SHOP_PERMISSION_CODES.length)
  .refine((codes) => new Set(codes).size === codes.length, 'Bir xil ruxsat takrorlangan')
  .refine(
    (codes) => codes.every((code) => staffAssignablePermissionCodes.includes(code)),
    "Xodimga faqat operatsion ruxsatlar berilishi mumkin",
  )

const memberFields = {
  name: z.string().trim().min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak").max(100),
  phone: phoneSchema,
  telegramId: z.string().trim().regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak").optional().or(z.literal('')),
  telegramNotificationsEnabled: z.boolean().default(true),
  permissionCodes: permissionCodesSchema.default([]),
}

export const createShopStaffSchema = z.object({
  ...memberFields,
  login: z.string().trim().min(3).max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "Login faqat lotin harflari, raqamlar va _ belgisidan iborat bo'lishi kerak"),
  password: passwordSchema,
})

export const updateShopStaffSchema = z.object({
  staffId: z.string().min(1).max(100),
  name: memberFields.name.optional(),
  phone: phoneSchema.optional(),
  password: passwordSchema.optional(),
  telegramNotificationsEnabled: z.boolean().optional(),
  permissionCodes: permissionCodesSchema.optional(),
  isActive: z.boolean().optional(),
  note: z.string().trim().min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
}).refine(
  (value) => value.name !== undefined || value.phone !== undefined ||
    value.password !== undefined ||
    value.telegramNotificationsEnabled !== undefined || value.permissionCodes !== undefined ||
    value.isActive !== undefined,
  "Kamida bitta o'zgarish kiritilishi kerak",
)

export const deleteShopStaffSchema = z.object({
  note: z.string().trim().min(5, "O'chirish sababi kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
})

export interface ShopStaffDto {
  id: string
  name: string
  phone: string
  login: string
  isActive: boolean
  telegramId: string | null
  telegramVerifiedAt: string | null
  telegramNotificationsEnabled: boolean
  permissionVersion: number
  permissionCodes: ShopPermissionCode[]
  createdAt: string
}
