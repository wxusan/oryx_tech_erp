/**
 * Central type definitions for Oryx Tech ERP
 * NOTE: Re-exports from generated Prisma client.
 * Run `npx prisma generate` before building to populate src/generated/prisma/
 */

// ---------------------------------------------------------------------------
// Enums (mirror the Prisma schema enums for use in non-Prisma contexts)
// ---------------------------------------------------------------------------

export enum DeviceStatus {
  IN_STOCK = 'IN_STOCK',
  SOLD_CASH = 'SOLD_CASH',
  SOLD_DEBT = 'SOLD_DEBT',
  SOLD_NASIYA = 'SOLD_NASIYA',
  RETURNED = 'RETURNED',
  DELETED = 'DELETED',
}

export enum NasiyaStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum ShopStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum NasiyaScheduleStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  SETTLED = 'SETTLED',
  PARTIAL = 'PARTIAL',
  OVERDUE = 'OVERDUE',
  DEFERRED = 'DEFERRED',
  CANCELLED = 'CANCELLED',
}

export enum NasiyaSettlementMode {
  FULL_WITH_PROFIT = 'FULL_WITH_PROFIT',
  WAIVE_REMAINING_PROFIT = 'WAIVE_REMAINING_PROFIT',
}

export enum ActorType {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SHOP_ADMIN = 'SHOP_ADMIN',
}

export enum PaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  CARD = 'CARD',
  OTHER = 'OTHER',
}

// ---------------------------------------------------------------------------
// Role type used in session / JWT
// ---------------------------------------------------------------------------

export type UserRole = 'SUPER_ADMIN' | 'SHOP_ADMIN'

// ---------------------------------------------------------------------------
// Nasiya / payment schedule types
// ---------------------------------------------------------------------------

export interface PaymentScheduleItem {
  monthNumber: number
  dueDate: Date
  expectedAmount: number
}

// Minimal NasiyaSchedule shape for utility functions (mirrors Prisma model)
export interface NasiyaSchedule {
  id: string
  nasiyaId: string
  shopId: string
  monthNumber: number
  dueDate: Date
  expectedAmount: number // stored as Decimal in DB, converted here
  paidAmount: number
  status: NasiyaScheduleStatus
  paidAt: Date | null
  paymentMethod: PaymentMethod | null
  delayedUntil: Date | null
  deferredToNext: boolean
  note: string | null
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Dashboard stats types
// ---------------------------------------------------------------------------

export interface SuperAdminDashboardStats {
  totalShops: number
  activeShops: number
  suspendedShops: number
  shopsExpiringSoon: number  // within 7 days
  totalRevenue: number
  monthlyRevenue: number
  totalDevicesSold: number
  activeNasiyaCount: number
  overdueNasiyaCount: number
}

export interface ShopDashboardStats {
  shopId: string
  shopName: string
  totalDevices: number
  inStockDevices: number
  soldDevices: number
  nasiyaDevices: number
  totalNasiya: number
  activeNasiya: number
  overdueNasiya: number
  completedNasiya: number
  totalSalesRevenue: number
  totalNasiyaRevenue: number
  pendingNasiyaAmount: number
  subscriptionDue: Date
}

// ---------------------------------------------------------------------------
// Generic API response wrapper
// ---------------------------------------------------------------------------

export interface ApiResponse<T = undefined> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// Session augmentation types (used with next-auth module augmentation)
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  name: string
  role: UserRole
  shopId: string | null
  sessionVersion: number
}
