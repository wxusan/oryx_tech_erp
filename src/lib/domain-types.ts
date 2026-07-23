/**
 * Browser-safe domain unions shared by API contracts and UI components.
 * Keep these values aligned with the Prisma enums; centralizing them prevents
 * individual pages from silently drifting when a lifecycle state is added.
 */
export const SHOP_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const
export type ShopStatus = (typeof SHOP_STATUSES)[number]

export const DEVICE_STATUSES = [
  'IN_STOCK',
  'SOLD_CASH',
  'SOLD_DEBT',
  'SOLD_NASIYA',
  'RETURNED',
  'DELETED',
] as const
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

export const NASIYA_STATUSES = ['ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED'] as const
export type NasiyaStatus = (typeof NASIYA_STATUSES)[number]

export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const SUPPLIER_PAYABLE_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE', 'PAID', 'CANCELLED'] as const
export type SupplierPayableStatus = (typeof SUPPLIER_PAYABLE_STATUSES)[number]
