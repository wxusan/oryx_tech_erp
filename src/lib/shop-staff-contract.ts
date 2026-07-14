import { z } from 'zod'
import {
  SHOP_PERMISSION_CATALOG,
  SHOP_PERMISSION_CODES,
  permissionRequiredFeatures,
  type ShopFeatureCode,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { passwordSchema, phoneSchema } from '@/lib/validations'

/**
 * Log access is a deliberately separate owner decision. Keeping it out of
 * the generic permission checklist prevents it from being enabled by accident
 * while still storing the authoritative LOG_VIEW grant in the same typed
 * permission table.
 */
export const STAFF_LOGS_PERMISSION: ShopPermissionCode = 'LOG_VIEW'

export const staffAssignablePermissionCodes: readonly ShopPermissionCode[] = SHOP_PERMISSION_CATALOG
  .filter((permission) => !permission.ownerOnly && !permission.retired)
  .map((permission) => permission.code)

export type StaffAssignablePermissionCode = (typeof staffAssignablePermissionCodes)[number]

const permissionCodesSchema = z.array(z.enum(SHOP_PERMISSION_CODES))
  .max(SHOP_PERMISSION_CODES.length)
  .refine((codes) => new Set(codes).size === codes.length, 'Bir xil ruxsat takrorlangan')
  .refine(
    (codes) => codes.every((code) => (
      code !== STAFF_LOGS_PERMISSION && staffAssignablePermissionCodes.includes(code)
    )),
    "Xodimga faqat operatsion ruxsatlar berilishi mumkin",
  )

export function withStaffLogsPermission(
  permissionCodes: readonly ShopPermissionCode[],
  logsViewEnabled: boolean,
): ShopPermissionCode[] {
  const withoutLogs = permissionCodes.filter((code) => code !== STAFF_LOGS_PERMISSION)
  return logsViewEnabled ? [...withoutLogs, STAFF_LOGS_PERMISSION] : withoutLogs
}

/**
 * Existing staff may still be on the one-time legacy compatibility model.
 * When an owner first saves that member, materialize only the permissions the
 * member could actually use under the current package, never owner-only ones.
 */
export function legacyStaffPermissionCodes(
  enabledFeatures: ReadonlySet<ShopFeatureCode>,
): ShopPermissionCode[] {
  return SHOP_PERMISSION_CATALOG
    .filter((permission) => (
      !permission.retired && permission.legacyOperational &&
      permissionRequiredFeatures(permission.code).every((feature) => enabledFeatures.has(feature))
    ))
    .map((permission) => permission.code)
}

const memberFields = {
  name: z.string().trim().min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak").max(100),
  phone: phoneSchema,
  telegramId: z.string().trim().regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak").optional().or(z.literal('')),
  telegramNotificationsEnabled: z.boolean().default(false),
  logsViewEnabled: z.boolean().default(false),
  permissionCodes: permissionCodesSchema.default([]),
}

export const createShopStaffSchema = z.object({
  ...memberFields,
  isActive: z.boolean().default(true),
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
  logsViewEnabled: z.boolean().optional(),
  permissionCodes: permissionCodesSchema.optional(),
  isActive: z.boolean().optional(),
  note: z.string().trim().min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
}).refine(
  (value) => value.name !== undefined || value.phone !== undefined ||
    value.password !== undefined ||
    value.telegramNotificationsEnabled !== undefined || value.permissionCodes !== undefined ||
    value.logsViewEnabled !== undefined ||
    value.isActive !== undefined,
  "Kamida bitta o'zgarish kiritilishi kerak",
)

export const deleteShopStaffSchema = z.object({
  note: z.string().trim().min(5, "O'chirish sababi kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
})

export interface ShopStaffDto {
  id: string
  name: string
  phone: string | null
  login: string
  isActive: boolean | null
  telegramId: string | null
  telegramVerifiedAt: string | null
  telegramNotificationsEnabled: boolean | null
  logsViewEnabled: boolean | null
  permissionVersion: number | null
  permissionCodes: ShopPermissionCode[] | null
  createdAt: string
}
