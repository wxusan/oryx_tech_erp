import 'server-only'

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { createMoneyDto } from '@/lib/currency'
import { tashkentDayRange, tashkentDaysUntil, tashkentMonthRangeFromKey, isBeforeTashkentToday } from '@/lib/timezone'
import { normalizePhone } from '@/lib/phone'
import { createPrivateUploadReference, isPrivateUploadStoredKey, privateUploadPreviewUrl } from '@/lib/server/private-upload-reference'

export type DebtTab = 'outgoing' | 'incoming'
export type DebtStatusFilter = 'ALL' | 'PENDING' | 'PARTIAL' | 'OVERDUE'

export type DebtQueryInput = {
  tab: DebtTab
  month?: string
  status?: DebtStatusFilter
  cursor?: string
  search?: string
  take?: number
}

function debtMonthScope(month?: string) {
  if (month === 'ALL') return { monthKey: 'ALL', start: null, end: null }
  const range = tashkentMonthRangeFromKey(month)
  return { monthKey: range.monthKey, start: range.start, end: range.end }
}

function dueDateWhere(input: { start: Date | null; end: Date | null; overdue: boolean; todayStart: Date }) {
  if (input.overdue) return {
    ...(input.start ? { gte: input.start } : {}),
    lt: input.end && input.end < input.todayStart ? input.end : input.todayStart,
  }
  return input.start && input.end ? { gte: input.start, lt: input.end } : undefined
}

function safeDeviceImages(shopId: string, imageUrls: string[]) {
  return imageUrls
    .filter((key) => isPrivateUploadStoredKey({ key, shopId, kind: 'device' }))
    .slice(0, 10)
    .map((key) => privateUploadPreviewUrl(
      'device',
      createPrivateUploadReference({ key, shopId, kind: 'device' }),
    ))
}

function maskedImei(value: string) {
  const normalized = value.trim()
  return normalized.length > 4 ? `••••${normalized.slice(-4)}` : normalized
}

function encodeCursor(input: { dueDate: Date; id: string }) {
  return Buffer.from(JSON.stringify({ dueDate: input.dueDate.toISOString(), id: input.id }), 'utf8').toString('base64url')
}

function decodeCursor(value?: string) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { dueDate?: unknown; id?: unknown }
    const dueDate = typeof parsed.dueDate === 'string' ? new Date(parsed.dueDate) : null
    return dueDate && Number.isFinite(dueDate.getTime()) && typeof parsed.id === 'string' && parsed.id
      ? { dueDate, id: parsed.id }
      : null
  } catch {
    return null
  }
}

function timeline(dueDate: Date, now = new Date()) {
  const days = tashkentDaysUntil(dueDate, now)
  return {
    days,
    timing: days < 0 ? 'OVERDUE' as const : days === 0 ? 'DUE_TODAY' as const : 'UPCOMING' as const,
  }
}

function cursorWhere(cursor: ReturnType<typeof decodeCursor>) {
  return cursor ? {
    OR: [
      { dueDate: { gt: cursor.dueDate } },
      { dueDate: cursor.dueDate, id: { gt: cursor.id } },
    ],
  } : {}
}

export async function queryOutgoingDebts(shopId: string, input: Omit<DebtQueryInput, 'tab'>) {
  const { start, end, monthKey } = debtMonthScope(input.month)
  const cursor = decodeCursor(input.cursor)
  const take = Math.min(Math.max(Math.trunc(input.take ?? 18), 1), 30)
  const search = input.search?.trim()
  const digits = search ? normalizePhone(search) : null
  const status = input.status ?? 'ALL'
  const now = new Date()
  const { start: todayStart } = tashkentDayRange(now)
  const dueDate = dueDateWhere({ start, end, overdue: status === 'OVERDUE', todayStart })
  const where: Prisma.SupplierPayableWhereInput = {
    shopId,
    deletedAt: null,
    status: { notIn: ['PAID', 'CANCELLED'] },
    contractRemainingAmount: { gt: 0 },
    ...(dueDate ? { dueDate } : {}),
    ...cursorWhere(cursor),
    ...(status === 'PENDING' ? { status: 'PENDING' } : {}),
    ...(status === 'PARTIAL' ? { status: 'PARTIAL' } : {}),
    ...(search ? {
      AND: [{
        OR: [
          { supplierName: { contains: search, mode: 'insensitive' } },
          { supplierPhone: { contains: search, mode: 'insensitive' } },
          ...(digits ? [{ supplierPhone: { contains: digits } }] : []),
          { device: { model: { contains: search, mode: 'insensitive' } } },
          { device: { imei: { contains: search, mode: 'insensitive' } } },
        ],
      }],
    } : {}),
  }
  const rows = await prisma.supplierPayable.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: take + 1,
    select: {
      id: true, origin: true, supplierName: true, supplierPhone: true, contractCurrency: true,
      contractAmount: true, contractPaidAmount: true, contractRemainingAmount: true,
      dueDate: true, status: true, reminderEnabled: true, createdAt: true, lastPaymentAt: true,
      device: { select: {
        id: true, model: true, color: true, storage: true, batteryHealth: true,
        conditionCode: true, imei: true, imageUrls: true,
      } },
      payments: {
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { id: true, paymentInputAmount: true, paymentInputCurrency: true, paymentMethod: true, paidAt: true },
      },
    },
  })
  const hasMore = rows.length > take
  const visible = hasMore ? rows.slice(0, take) : rows
  return {
    tab: 'outgoing' as const,
    month: monthKey,
    items: visible.map((row) => ({
      id: row.id,
      origin: row.origin,
      supplier: { name: row.supplierName, phone: row.supplierPhone },
      originalAmount: createMoneyDto(row.contractCurrency, row.contractAmount.toString()),
      paidAmount: createMoneyDto(row.contractCurrency, row.contractPaidAmount.toString()),
      remainingAmount: createMoneyDto(row.contractCurrency, row.contractRemainingAmount.toString()),
      dueDate: row.dueDate.toISOString(),
      status: isBeforeTashkentToday(row.dueDate, now) ? 'OVERDUE' as const : row.status,
      timeline: timeline(row.dueDate, now),
      reminderEnabled: row.reminderEnabled,
      createdAt: row.createdAt.toISOString(),
      lastPaymentAt: row.lastPaymentAt?.toISOString() ?? null,
      device: {
        id: row.device.id,
        model: row.device.model,
        color: row.device.color,
        storage: row.device.storage,
        batteryHealth: row.device.batteryHealth,
        conditionCode: row.device.conditionCode,
        imei: maskedImei(row.device.imei),
        imageUrls: safeDeviceImages(shopId, row.device.imageUrls),
      },
      payments: row.payments.map((payment) => ({
        id: payment.id,
        amount: createMoneyDto(payment.paymentInputCurrency, payment.paymentInputAmount.toString()),
        method: payment.paymentMethod,
        paidAt: payment.paidAt.toISOString(),
      })),
    })),
    nextCursor: hasMore ? encodeCursor(visible.at(-1)!) : null,
  }
}

export async function queryIncomingPayLaterDebts(shopId: string, input: Omit<DebtQueryInput, 'tab'>) {
  const { start, end, monthKey } = debtMonthScope(input.month)
  const cursor = decodeCursor(input.cursor)
  const take = Math.min(Math.max(Math.trunc(input.take ?? 18), 1), 30)
  const search = input.search?.trim()
  const digits = search ? normalizePhone(search) : null
  const status = input.status ?? 'ALL'
  const now = new Date()
  const { start: todayStart } = tashkentDayRange(now)
  const dueDate = dueDateWhere({ start, end, overdue: status === 'OVERDUE', todayStart })
  const where: Prisma.SaleWhereInput = {
    shopId,
    deletedAt: null,
    returnedAt: null,
    paidFully: false,
    contractRemainingAmount: { gt: 0 },
    ...(dueDate ? { dueDate } : {}),
    ...cursorWhere(cursor),
    ...(status === 'PENDING' ? { contractAmountPaid: 0 } : {}),
    ...(status === 'PARTIAL' ? { contractAmountPaid: { gt: 0 } } : {}),
    ...(search ? {
      AND: [{
        OR: [
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { phone: { contains: search, mode: 'insensitive' } } },
          ...(digits ? [{ customer: { normalizedPhone: { contains: digits } } }] : []),
          { device: { model: { contains: search, mode: 'insensitive' } } },
          { device: { imei: { contains: search, mode: 'insensitive' } } },
        ],
      }],
    } : {}),
  }
  const rows = await prisma.sale.findMany({
    where,
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: take + 1,
    select: {
      id: true, contractCurrency: true, contractSalePrice: true, contractAmountPaid: true,
      contractRemainingAmount: true, dueDate: true, createdAt: true, reminderEnabled: true,
      olibSotdimOperation: { select: { id: true } },
      customer: { select: { id: true, name: true, phone: true } },
      device: { select: {
        id: true, model: true, color: true, storage: true, batteryHealth: true,
        conditionCode: true, imei: true, imageUrls: true,
      } },
      payments: {
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { id: true, paymentInputAmount: true, paymentInputCurrency: true, amount: true, paymentMethod: true, paidAt: true },
      },
    },
  })
  const hasMore = rows.length > take
  const visible = hasMore ? rows.slice(0, take) : rows
  return {
    tab: 'incoming' as const,
    month: monthKey,
    items: visible.map((row) => ({
      id: row.id,
      origin: row.olibSotdimOperation ? 'OLIB_SOTDIM_SALE' as const : 'ORDINARY_SALE' as const,
      customer: row.customer,
      originalAmount: createMoneyDto(row.contractCurrency, row.contractSalePrice.toString()),
      paidAmount: createMoneyDto(row.contractCurrency, row.contractAmountPaid.toString()),
      remainingAmount: createMoneyDto(row.contractCurrency, row.contractRemainingAmount.toString()),
      dueDate: row.dueDate!.toISOString(),
      status: isBeforeTashkentToday(row.dueDate!, now) ? 'OVERDUE' as const : Number(row.contractAmountPaid) > 0 ? 'PARTIAL' as const : 'PENDING' as const,
      timeline: timeline(row.dueDate!, now),
      reminderEnabled: row.reminderEnabled,
      createdAt: row.createdAt.toISOString(),
      lastPaymentAt: row.payments[0]?.paidAt.toISOString() ?? null,
      device: {
        id: row.device.id,
        model: row.device.model,
        color: row.device.color,
        storage: row.device.storage,
        batteryHealth: row.device.batteryHealth,
        conditionCode: row.device.conditionCode,
        imei: maskedImei(row.device.imei),
        imageUrls: safeDeviceImages(shopId, row.device.imageUrls),
      },
      payments: row.payments.map((payment) => ({
        id: payment.id,
        amount: createMoneyDto(payment.paymentInputCurrency ?? 'UZS', (payment.paymentInputAmount ?? payment.amount).toString()),
        method: payment.paymentMethod,
        paidAt: payment.paidAt.toISOString(),
      })),
    })),
    nextCursor: hasMore ? encodeCursor({ dueDate: visible.at(-1)!.dueDate!, id: visible.at(-1)!.id }) : null,
  }
}

export async function queryDebts(shopId: string, input: DebtQueryInput) {
  return input.tab === 'outgoing'
    ? queryOutgoingDebts(shopId, input)
    : queryIncomingPayLaterDebts(shopId, input)
}

export type DebtQueryResult = Awaited<ReturnType<typeof queryDebts>>
