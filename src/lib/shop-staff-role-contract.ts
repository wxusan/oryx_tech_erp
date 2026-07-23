import { z } from 'zod'
import {
  SHOP_PERMISSION_CATALOG,
  SHOP_PERMISSION_CODES,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { STAFF_LOGS_PERMISSION } from '@/lib/shop-staff-contract'
import {
  normalizeShopStaffRoleName,
  type ShopStaffRoleKind,
} from '@/lib/staff-role-presets'

export const MAX_CUSTOM_STAFF_ROLES = 30
export const MAX_SHOP_STAFF_ROLES = 35

const UNSAFE_ROLE_NAME = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u

export const shopStaffRoleNameSchema = z.string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(2, "Lavozim nomi kamida 2 ta belgidan iborat bo'lishi kerak").max(40))
  .refine((value) => !UNSAFE_ROLE_NAME.test(value), 'Lavozim nomida xavfli boshqaruv belgilari bor')

const rolePermissionCodes = SHOP_PERMISSION_CATALOG
  .filter((permission) => !permission.ownerOnly && !permission.retired)
  .map((permission) => permission.code)

const rolePermissionCodesSchema = z.array(z.enum(SHOP_PERMISSION_CODES))
  .max(SHOP_PERMISSION_CODES.length)
  .refine((codes) => new Set(codes).size === codes.length, 'Bir xil ruxsat takrorlangan')
  .refine(
    (codes) => codes.every((code) => code !== STAFF_LOGS_PERMISSION && rolePermissionCodes.includes(code)),
    "Lavozimga faqat xodim ruxsatlari berilishi mumkin",
  )

const descriptionSchema = z.string().trim().max(200).optional().or(z.literal(''))

export const createShopStaffRoleSchema = z.object({
  name: shopStaffRoleNameSchema,
  description: descriptionSchema,
  permissionCodes: rolePermissionCodesSchema.default([]),
  logsViewEnabled: z.boolean().default(false),
})

export const updateShopStaffRoleSchema = z.object({
  version: z.number().int().min(1),
  name: shopStaffRoleNameSchema.optional(),
  description: descriptionSchema,
  permissionCodes: rolePermissionCodesSchema.optional(),
  logsViewEnabled: z.boolean().optional(),
  note: z.string().trim().min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
}).refine(
  (value) => value.name !== undefined || value.description !== undefined ||
    value.permissionCodes !== undefined || value.logsViewEnabled !== undefined,
  "Kamida bitta o'zgarish kiritilishi kerak",
)

export const archiveShopStaffRoleSchema = z.object({
  version: z.number().int().min(1),
  note: z.string().trim().min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
})

export interface ShopStaffRoleDto {
  id: string
  name: string
  normalizedName: string
  description: string | null
  kind: ShopStaffRoleKind
  presetKey: string | null
  isArchived: boolean
  version: number
  permissionCodes: ShopPermissionCode[]
  logsViewEnabled: boolean
  assignable: boolean
  createdAt: string
  updatedAt: string
}

export function rolePermissionCodesWithLogs(
  permissionCodes: readonly ShopPermissionCode[],
  logsViewEnabled: boolean,
): ShopPermissionCode[] {
  return [
    ...permissionCodes.filter((code) => code !== STAFF_LOGS_PERMISSION),
    ...(logsViewEnabled ? [STAFF_LOGS_PERMISSION] : []),
  ]
}

export function normalizedRoleName(value: string): string {
  return normalizeShopStaffRoleName(value)
}
