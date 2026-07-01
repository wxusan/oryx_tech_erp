/**
 * Typed fetch helpers for every Oryx Tech ERP API endpoint.
 *
 * Each function fetches the relevant route, throws on HTTP error,
 * and returns `json.data` from the ApiResponse<T> wrapper.
 *
 * All functions are safe to call from React components (client-side)
 * as well as from Server Components / Route Handlers (server-side)
 * provided `window.location.origin` is replaced with an absolute base URL
 * when running on the server.
 */

import type { ApiResponse } from '@/types'

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildUrl(
  path: string,
  params: Record<string, string | undefined> = {},
): string {
  const base =
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXTAUTH_URL ?? 'http://localhost:3000')
  const url = new URL(path, base)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.set(k, v)
  })
  return url.toString()
}

// ---------------------------------------------------------------------------
// Export URLs
// ---------------------------------------------------------------------------

/** Entities supported by GET /api/export/[entity] (see route.ts). */
export type ExportEntity = 'devices' | 'customers' | 'sales' | 'nasiya' | 'returns' | 'logs'
export type ExportFormat = 'csv' | 'xlsx'

/**
 * Build the download URL for the shop-scoped Excel/CSV export endpoint.
 * The route authenticates via session cookie and scopes to the active shop
 * server-side, so a plain `window.location.href = exportUrl('devices')`
 * triggers the download with no extra params needed.
 */
export function exportUrl(entity: ExportEntity, format: ExportFormat = 'xlsx'): string {
  return buildUrl(`/api/export/${entity}`, { format })
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const res = await fetch(buildUrl(path, params))
  if (!res.ok) throw new Error(await res.text())
  const json: ApiResponse<T> = await res.json()
  return json.data as T
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  const json: ApiResponse<T> = await res.json()
  return json.data as T
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  const json: ApiResponse<T> = await res.json()
  return json.data as T
}

async function del<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  const json: ApiResponse<T> = await res.json()
  return json.data as T
}

// ---------------------------------------------------------------------------
// Domain types (lightweight mirrors — avoids pulling in full Prisma types)
// ---------------------------------------------------------------------------

export interface Shop {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  address: string
  note: string | null
  status: string
  subscriptionDue: string
  telegramGroupId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  admins?: ShopAdmin[]
  payments?: ShopPayment[]
  _count?: { devices: number; nasiya: number; sales?: number }
}

export interface ShopAdmin {
  id: string
  shopId: string
  name: string
  phone: string
  login: string
  telegramId: string | null
  telegramVerifiedAt?: string | null
  telegramLinkCode?: string | null
  isActive: boolean
  createdAt: string
  deletedAt: string | null
}

export interface ShopPayment {
  id: string
  shopId: string
  amount: number
  months: number
  paymentMethod: string
  note: string | null
  paidAt: string
  recordedById: string
}

export interface Supplier {
  id: string
  shopId: string
  name: string
  phone: string
}

export interface Device {
  id: string
  shopId: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  imei: string
  status: string
  imageUrls: string[]
  note: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  supplier?: Supplier | null
  sales?: Sale[]
  nasiya?: Nasiya[]
}

export interface Customer {
  id: string
  shopId: string
  name: string
  phone: string
  createdAt: string
}

export interface Sale {
  id: string
  shopId: string
  deviceId: string
  customerId: string
  salePrice: number
  paymentMethod: string
  paidFully: boolean
  amountPaid: number
  remainingAmount: number
  dueDate: string | null
  reminderEnabled: boolean
  note: string | null
  createdAt: string
  customer?: Customer
}

export interface NasiyaSchedule {
  id: string
  nasiyaId: string
  shopId: string
  monthNumber: number
  dueDate: string
  expectedAmount: number
  paidAmount: number
  status: string
  paidAt: string | null
  paymentMethod: string | null
  delayedUntil: string | null
  deferredToNext: boolean
  note: string | null
  createdAt: string
  nasiya?: Nasiya
}

export interface Nasiya {
  id: string
  shopId: string
  deviceId: string
  customerId: string
  totalAmount: number
  downPayment: number
  remainingAmount: number
  months: number
  monthlyPayment: number
  startDate: string
  status: string
  reminderEnabled: boolean
  appleIdNote: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  customer?: Customer
  device?: Device
  shop?: Shop
  schedules?: NasiyaSchedule[]
  _count?: { schedules: number }
}

export interface Log {
  id: string
  shopId: string | null
  actorId: string
  actorType: string
  action: string
  targetType: string
  targetId: string
  oldValue: unknown
  newValue: unknown
  note: string | null
  ipAddress: string | null
  createdAt: string
}

export interface AdminDashboardStats {
  thisMonthRevenue: number
  expectedRevenue: number
  activeShops: number
  dueSoon: number
  shops: Shop[]
}

export interface ShopDashboardStats {
  totalDevices: number
  soldThisMonth: number
  activeNasiyalar: number
  expectedThisMonth: number
  overdueCount: number
  recentActivity: Log[]
  upcomingPayments: NasiyaSchedule[]
}

// ---------------------------------------------------------------------------
// Shops (super admin)
// ---------------------------------------------------------------------------

export async function getShops(): Promise<Shop[]> {
  return get<Shop[]>('/api/shops')
}

export async function getShop(id: string): Promise<Shop> {
  return get<Shop>(`/api/shops/${id}`)
}

export async function createShop(data: Record<string, unknown>): Promise<Shop> {
  return post<Shop>('/api/shops', data)
}

export async function updateShop(id: string, data: Record<string, unknown>): Promise<Shop> {
  return patch<Shop>(`/api/shops/${id}`, data)
}

export async function deleteShop(id: string, deleteNote: string): Promise<Shop> {
  return del<Shop>(`/api/shops/${id}`, { deleteNote })
}

export async function addShopPayment(
  id: string,
  data: { amount: number; months: number; paymentMethod: string; note?: string },
): Promise<ShopPayment> {
  return post<ShopPayment>(`/api/shops/${id}/payment`, data)
}

export async function addShopAdmin(
  shopId: string,
  data: {
    name: string
    phone: string
    login: string
    telegramId?: string
    password: string
  },
): Promise<ShopAdmin> {
  return post<ShopAdmin>(`/api/shops/${shopId}/admins`, data)
}

export async function deleteShopAdmin(
  shopId: string,
  adminId: string,
  note: string,
): Promise<ShopAdmin> {
  return del<ShopAdmin>(`/api/shops/${shopId}/admins`, { adminId, note })
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export async function getDevices(params: {
  shopId?: string
  status?: string
  search?: string
}): Promise<Device[]> {
  return get<Device[]>('/api/devices', {
    shopId: params.shopId,
    status: params.status,
    search: params.search,
  })
}

export async function getDevice(id: string): Promise<Device> {
  return get<Device>(`/api/devices/${id}`)
}

export async function createDevice(data: Record<string, unknown>): Promise<Device> {
  return post<Device>('/api/devices', data)
}

export async function updateDevice(id: string, data: Record<string, unknown>): Promise<Device> {
  return patch<Device>(`/api/devices/${id}`, data)
}

export async function deleteDevice(id: string, deleteNote: string): Promise<Device> {
  return del<Device>(`/api/devices/${id}`, { deleteNote })
}

export async function sellDevice(deviceId: string, data: Record<string, unknown>): Promise<Sale> {
  return post<Sale>(`/api/devices/${deviceId}/sell`, data)
}

export async function createNasiya(
  deviceId: string,
  data: Record<string, unknown>,
): Promise<Nasiya> {
  return post<Nasiya>(`/api/devices/${deviceId}/nasiya`, data)
}

// ---------------------------------------------------------------------------
// Nasiya
// ---------------------------------------------------------------------------

export async function getNasiyalar(params: {
  shopId?: string
  status?: string
}): Promise<Nasiya[]> {
  return get<Nasiya[]>('/api/nasiya', {
    shopId: params.shopId,
    status: params.status,
  })
}

export async function getNasiya(id: string): Promise<Nasiya> {
  return get<Nasiya>(`/api/nasiya/${id}`)
}

export async function addNasiyaPayment(
  nasiyaId: string,
  data: Record<string, unknown>,
): Promise<object> {
  return post<object>(`/api/nasiya/${nasiyaId}/payment`, data)
}

// ---------------------------------------------------------------------------
// Logs (super admin)
// ---------------------------------------------------------------------------

export async function getLogs(params: {
  shopId?: string
  actorType?: string
  from?: string
  to?: string
}): Promise<Log[]> {
  return get<Log[]>('/api/logs', {
    shopId: params.shopId,
    actorType: params.actorType,
    from: params.from,
    to: params.to,
  })
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getAdminStats(): Promise<AdminDashboardStats> {
  return get<AdminDashboardStats>('/api/stats/admin')
}

export async function getShopStats(shopId: string): Promise<ShopDashboardStats> {
  return get<ShopDashboardStats>('/api/stats/shop', { shopId })
}
