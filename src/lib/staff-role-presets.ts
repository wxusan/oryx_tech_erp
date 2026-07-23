import type { ShopPermissionCode } from '@/lib/access-control'

export const SHOP_STAFF_ROLE_KIND = {
  BUILT_IN: 'BUILT_IN',
  CUSTOM: 'CUSTOM',
} as const

export type ShopStaffRoleKind = typeof SHOP_STAFF_ROLE_KIND[keyof typeof SHOP_STAFF_ROLE_KIND]

export const SHOP_STAFF_ROLE_PRESETS = [
  {
    key: 'CASHIER',
    name: 'Kassir',
    description: "Savdo qilish, to'lov qabul qilish va mijoz yaratish",
    permissionCodes: ['SALE_CREATE', 'SALE_PAYMENT_RECEIVE', 'RECEIVABLES_VIEW', 'CUSTOMER_CREATE'],
  },
  {
    key: 'WAREHOUSE',
    name: 'Omborchi',
    description: "Omborni ko'rish, qurilma qo'shish va tahrirlash",
    permissionCodes: ['INVENTORY_VIEW', 'DEVICE_CREATE', 'DEVICE_EDIT'],
  },
  {
    key: 'COLLECTOR',
    name: 'Nasiya undiruvchi',
    description: "Qarzdorlikni ko'rish, to'lov olish va eslatmalarni boshqarish",
    permissionCodes: ['RECEIVABLES_VIEW', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER', 'NASIYA_REMINDER_MANAGE'],
  },
  {
    key: 'CONTROLLER',
    name: 'Nazoratchi',
    description: "Operatsion ma'lumotlarni ko'rish va nazorat qilish",
    permissionCodes: [
      'INVENTORY_VIEW',
      'SALE_VIEW',
      'SALE_EDIT',
      'SALE_REMINDER_MANAGE',
      'NASIYA_VIEW',
      'NASIYA_EDIT',
      'NASIYA_REMINDER_MANAGE',
      'OLIB_VIEW',
      'CUSTOMER_VIEW',
      'DASHBOARD_OPERATIONAL_VIEW',
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Hisobchi',
    description: "Moliyaviy ko'rsatkichlar, hisobotlar va eksportlar",
    permissionCodes: [
      'DASHBOARD_FINANCIAL_VIEW',
      'REPORT_VIEW',
      'EXPORT_SALES',
      'EXPORT_NASIYA',
      'EXPORT_OLIB',
      'EXPORT_RETURNS',
      'EXPORT_REPORTS',
    ],
  },
] as const satisfies readonly {
  key: string
  name: string
  description: string
  permissionCodes: readonly ShopPermissionCode[]
}[]

export type ShopStaffRolePresetKey = typeof SHOP_STAFF_ROLE_PRESETS[number]['key']

/** Stable comparison form used by both validation and the database uniqueness index. */
export function normalizeShopStaffRoleName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uz-UZ')
}

export function shopStaffRolePreset(key: string) {
  return SHOP_STAFF_ROLE_PRESETS.find((preset) => preset.key === key) ?? null
}
