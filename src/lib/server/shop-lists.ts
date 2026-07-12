import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { enrichLogsWithActors } from '@/lib/server/log-actors'
import type { NasiyaDisplayStatus } from '@/lib/nasiya-utils'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { computeNasiyaPaymentScore, type NasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { computeSaleContractMargin, type PurchaseCostLike } from '@/lib/nasiya-contract'
import type { CurrencyCode } from '@/lib/currency'
import { normalizePhone } from '@/lib/phone'
import type { DeviceListItem, DeviceListSaleInfo } from '@/lib/device-list-contract'

/**
 * Real page/skip/take pagination envelope for the devices/nasiyalar list
 * pages — replaces the old "fetch up to a hard cap, show a truncation
 * banner" pattern. A shop with any number of devices/nasiyalar can now be
 * browsed page by page instead of having rows past a fixed cap silently
 * invisible (see docs/audits/full-production-audit.md's pagination
 * follow-up, now resolved).
 */
export interface ShopListPage<T> {
  items: T[]
  total: number
  skip: number
  take: number
}

const LIST_DEFAULT_TAKE = 25
const LIST_MAX_TAKE = 100

function clampTake(take?: number): number {
  if (take == null || !Number.isFinite(take)) return LIST_DEFAULT_TAKE
  return Math.trunc(Math.min(Math.max(take, 1), LIST_MAX_TAKE))
}

function clampSkip(skip?: number): number {
  if (skip == null || !Number.isFinite(skip)) return 0
  return Math.trunc(Math.max(skip, 0))
}

/**
 * Sale/nasiya summary for a sold/returned device — purchase price vs. sold
 * price, kept separate from any nasiya interest (accounting already splits
 * `totalAmount` = original device price from `interestAmount`, so device
 * profit never silently absorbs interest income). `profit` is `null` for a
 * returned device rather than a misleading number.
 *
 * `soldPrice`/`profit`/`interestAmount` stay exactly as before (the legacy
 * UZS snapshot, frozen at creation rate) for backward compatibility.
 * `contractCurrency`/`contractSoldPrice`/`contractProfit` are additive —
 * the deal's own native-currency source of truth, used by the UI to avoid
 * reconverting the legacy snapshot through today's rate (see
 * docs/currency-accounting-model.md).
 */
export type ShopDeviceSaleInfo = DeviceListSaleInfo
export type ShopDeviceListItem = DeviceListItem

export interface ShopNasiyaListItem {
  id: string
  totalAmount: number
  remainingAmount: number
  baseRemainingAmount: number
  interestPercent: number
  interestAmount: number
  finalNasiyaAmount: number
  // Native contract-currency ledger — see docs/currency-accounting-model.md.
  contractCurrency: 'UZS' | 'USD'
  contractInterestAmount: number
  contractFinalAmount: number
  contractRemainingAmount: number
  /** Stored parent status (kept for reference / debugging). */
  status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
  /** True for imported (pre-Oryx) nasiyas — shown with an "Eski nasiya" badge. */
  isImported: boolean
  /** Live display status derived from schedules (matches the dashboard). */
  displayStatus: NasiyaDisplayStatus
  isOverdue: boolean
  overdueAmount: number
  overdueCount: number
  nextPaymentDate: string | null
  createdAt: string
  note: string | null
  device: { id: string; model: string; imei: string }
  customer: { id: string; name: string; phone: string }
  schedules: {
    id: string
    dueDate: string
    delayedUntil: string | null
    status: string
  }[]
  /** Professional payment-behavior score (docs/nasiya-payment-scoring.md). */
  paymentScore: NasiyaPaymentScore
}

export interface ShopLogListItem {
  id: string
  createdAt: string
  actorId: string
  actorType: 'SUPER_ADMIN' | 'SHOP_ADMIN'
  actorName?: string | null
  actorLogin?: string | null
  action: string
  targetType: string
  targetId: string
  note: string | null
  newValue: Prisma.JsonValue | null
}

export interface ShopLogsPayload {
  logs: ShopLogListItem[]
  total: number
}

export function initialLogsRequestKey() {
  return new URLSearchParams({ skip: '0', take: '10' }).toString()
}

export type DeviceStatusFilter = 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA' | 'RETURNED' | 'DELETED'

export interface ShopDevicesQuery {
  search?: string
  status?: DeviceStatusFilter
  skip?: number
  take?: number
}

const shopDeviceListSelect = {
  id: true,
  model: true,
  color: true,
  storage: true,
  batteryHealth: true,
  purchasePrice: true,
  purchaseCurrency: true,
  purchaseInputAmount: true,
  purchaseAmountUzsSnapshot: true,
  imei: true,
  status: true,
  createdAt: true,
  note: true,
  supplierPhone: true,
  supplier: { select: { name: true } },
  sales: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      salePrice: true,
      createdAt: true,
      customer: { select: { name: true } },
      contractCurrency: true,
      contractSalePrice: true,
      contractRemainingAmount: true,
      contractExchangeRateAtCreation: true,
    },
  },
  nasiya: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      totalAmount: true,
      interestAmount: true,
      createdAt: true,
      customer: { select: { name: true } },
      contractCurrency: true,
      contractTotalAmount: true,
      contractExchangeRateAtCreation: true,
    },
  },
  returns: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { refundAmount: true, createdAt: true },
  },
} satisfies Prisma.DeviceSelect

type ShopDeviceListRow = Prisma.DeviceGetPayload<{ select: typeof shopDeviceListSelect }>

/** Pick whichever of the device's latest sale/nasiya is more recent and build its profit summary. */
function buildDeviceSaleInfo(device: {
  status: string
  purchasePrice: unknown
  purchaseCurrency: CurrencyCode
  purchaseInputAmount: unknown
  purchaseAmountUzsSnapshot: unknown
  sales: {
    salePrice: unknown
    createdAt: Date
    customer: { name: string }
    contractCurrency: CurrencyCode
    contractSalePrice: unknown
    contractRemainingAmount: unknown
    contractExchangeRateAtCreation: unknown
  }[]
  nasiya: {
    totalAmount: unknown
    interestAmount: unknown
    createdAt: Date
    customer: { name: string }
    contractCurrency: CurrencyCode
    contractTotalAmount: unknown
    contractExchangeRateAtCreation: unknown
  }[]
  returns: { refundAmount: unknown; createdAt: Date }[]
}): ShopDeviceSaleInfo | null {
  const latestSale = device.sales[0]
  const latestNasiya = device.nasiya[0]
  if (!latestSale && !latestNasiya) return null

  const useNasiya = !!latestNasiya && (!latestSale || latestNasiya.createdAt > latestSale.createdAt)
  const purchasePrice = Number(device.purchasePrice)
  const returned = device.status === 'RETURNED'
  const latestReturn = device.returns[0]
  const refundAmount = latestReturn ? Number(latestReturn.refundAmount) : null
  // Device's own purchase-currency context — lets a same-currency sale/purchase
  // pair (e.g. bought $400, sold $500) skip FX conversion entirely instead of
  // round-tripping through UZS at a possibly different rate. See
  // docs/currency-accounting-model.md.
  const purchase: PurchaseCostLike = {
    purchaseCurrency: device.purchaseCurrency,
    purchaseInputAmount: Number(device.purchaseInputAmount),
    purchaseAmountUzsSnapshot: Number(device.purchaseAmountUzsSnapshot),
  }

  if (useNasiya && latestNasiya) {
    // totalAmount = original device price BEFORE interest (see Nasiya model comment) —
    // never fold interest into device profit.
    const soldPrice = Number(latestNasiya.totalAmount)
    const contractCurrency = latestNasiya.contractCurrency
    const contractSoldPrice = Number(latestNasiya.contractTotalAmount)
    const contractExchangeRateAtCreation =
      latestNasiya.contractExchangeRateAtCreation != null ? Number(latestNasiya.contractExchangeRateAtCreation) : null
    return {
      saleType: 'NASIYA',
      soldPrice,
      interestAmount: Number(latestNasiya.interestAmount),
      profit: returned ? null : soldPrice - purchasePrice,
      contractCurrency,
      contractSoldPrice,
      contractRemainingAmount: null,
      contractProfit: returned ? null : computeSaleContractMargin(contractSoldPrice, contractCurrency, contractExchangeRateAtCreation, purchase),
      customerName: latestNasiya.customer.name,
      soldAt: latestNasiya.createdAt.toISOString(),
      returned,
      refundAmount,
    }
  }
  const soldPrice = Number(latestSale!.salePrice)
  const contractCurrency = latestSale!.contractCurrency
  const contractSoldPrice = Number(latestSale!.contractSalePrice)
  const contractRemainingAmount = Number(latestSale!.contractRemainingAmount)
  const contractExchangeRateAtCreation =
    latestSale!.contractExchangeRateAtCreation != null ? Number(latestSale!.contractExchangeRateAtCreation) : null
  return {
    saleType: 'CASH',
    soldPrice,
    interestAmount: 0,
    profit: returned ? null : soldPrice - purchasePrice,
    contractCurrency,
    contractSoldPrice,
    contractRemainingAmount,
    contractProfit: returned ? null : computeSaleContractMargin(contractSoldPrice, contractCurrency, contractExchangeRateAtCreation, purchase),
    customerName: latestSale!.customer.name,
    soldAt: latestSale!.createdAt.toISOString(),
    returned,
    refundAmount,
  }
}

function mapShopDeviceListRow(device: ShopDeviceListRow): ShopDeviceListItem {
  return {
    id: device.id,
    model: device.model,
    color: device.color,
    storage: device.storage,
    batteryHealth: device.batteryHealth,
    purchasePrice: Number(device.purchasePrice),
    imei: device.imei,
    status: device.status,
    createdAt: device.createdAt.toISOString(),
    note: device.note,
    supplierName: device.supplier?.name ?? null,
    supplierPhone: device.supplierPhone,
    saleInfo: buildDeviceSaleInfo(device),
  }
}

/**
 * Real page/skip/take pagination for the devices list — search/status are
 * applied server-side (via a Prisma `where`, run through `count()` with the
 * exact same clause as `findMany` so `total` always matches what could be
 * paged through). `search` mirrors the OR clause already used by
 * GET /api/devices (IMEI / model / color / storage / note / supplier phone /
 * customer name+phone).
 */
export async function getShopDevicesList(shopId: string, query: ShopDevicesQuery = {}): Promise<ShopListPage<ShopDeviceListItem>> {
  const search = query.search?.trim() || undefined
  const searchDigits = search ? normalizePhone(search) : null
  const take = clampTake(query.take)
  const skip = clampSkip(query.skip)

  const where: Prisma.DeviceWhereInput = {
    shopId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { imei: { contains: search, mode: 'insensitive' as const } },
            { model: { contains: search, mode: 'insensitive' as const } },
            { color: { contains: search, mode: 'insensitive' as const } },
            { storage: { contains: search, mode: 'insensitive' as const } },
            { note: { contains: search, mode: 'insensitive' as const } },
            { supplierPhone: { contains: search, mode: 'insensitive' as const } },
            { supplier: { phone: { contains: search, mode: 'insensitive' as const } } },
            { sales: { some: { customer: { phone: { contains: search, mode: 'insensitive' as const } } } } },
            { sales: { some: { customer: { name: { contains: search, mode: 'insensitive' as const } } } } },
            { nasiya: { some: { customer: { phone: { contains: search, mode: 'insensitive' as const } } } } },
            { nasiya: { some: { customer: { name: { contains: search, mode: 'insensitive' as const } } } } },
            ...(searchDigits
              ? [
                  { sales: { some: { customer: { additionalPhones: { has: searchDigits } } } } },
                  { nasiya: { some: { customer: { additionalPhones: { has: searchDigits } } } } },
                ]
              : []),
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: shopDeviceListSelect,
    }),
    prisma.device.count({ where }),
  ])

  return {
    items: rows.map(mapShopDeviceListRow),
    total,
    skip,
    take,
  }
}

/** Canonical list DTO resolver used by mutation responses and incremental sync. */
export async function getShopDeviceListItemsByIds(shopId: string, ids: readonly string[]): Promise<ShopDeviceListItem[]> {
  if (ids.length === 0) return []
  const rows = await prisma.device.findMany({
    where: { shopId, id: { in: [...new Set(ids)] }, deletedAt: null },
    select: shopDeviceListSelect,
  })
  const byId = new Map(rows.map((row) => [row.id, mapShopDeviceListRow(row)]))
  return ids.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
}

export type NasiyaStatusFilter = 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'

export interface ShopNasiyalarQuery {
  search?: string
  /**
   * Filters on the contract-derived display status. A status predicate cannot
   * be pushed to the raw parent column: an FX-drifted parent may be stored
   * COMPLETED while its native schedule still owes money.
   */
  status?: NasiyaStatusFilter
  skip?: number
  take?: number
}

/**
 * Real page/skip/take pagination for the nasiyalar list. `search` mirrors
 * the OR clause already used by GET /api/nasiya (customer name/phone,
 * device model/IMEI, note). Rows are ordered `createdAt desc` at the
 * database level (required for `total`/`skip`/`take` to mean anything
 * across pages); the overdue-first / earliest-next-payment secondary sort
 * that used to run across the whole shop's data is preserved but now only
 * reorders the current page — see docs/currency-accounting-model.md for the
 * money fields and nasiya-payment-scoring.md for `paymentScore`.
 */
export async function getShopNasiyalarList(shopId: string, query: ShopNasiyalarQuery = {}): Promise<ShopListPage<ShopNasiyaListItem>> {
  // Payment-score reason text must reflect the shop's selected display
  // currency (never hardcode UZS) — see docs/nasiya-payment-scoring.md.
  const currency = await getShopCurrencyContext(shopId)

  const search = query.search?.trim() || undefined
  const searchDigits = search ? normalizePhone(search) : null
  const take = clampTake(query.take)
  const skip = clampSkip(query.skip)

  const where: Prisma.NasiyaWhereInput = {
    shopId,
    deletedAt: null,
    ...(search
      ? {
          OR: [
            { customer: { name: { contains: search, mode: 'insensitive' as const } } },
            { customer: { phone: { contains: search, mode: 'insensitive' as const } } },
            { device: { model: { contains: search, mode: 'insensitive' as const } } },
            { device: { imei: { contains: search, mode: 'insensitive' as const } } },
            { note: { contains: search, mode: 'insensitive' as const } },
            ...(searchDigits ? [{ customer: { additionalPhones: { has: searchDigits } } }] : []),
          ],
        }
      : {}),
  }

  const [rows, rawTotal] = await Promise.all([
    prisma.nasiya.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    // A requested status is itself derived from contract schedules. Fetch
    // matching search candidates first, then filter/paginate the derived
    // status below; raw status filtering here would hide P0-01 debt.
    ...(query.status ? {} : { skip, take }),
    select: {
      id: true,
      totalAmount: true,
      remainingAmount: true,
      baseRemainingAmount: true,
      interestPercent: true,
      interestAmount: true,
      finalNasiyaAmount: true,
      // Native contract-currency ledger — see docs/currency-accounting-model.md.
      contractCurrency: true,
      contractInterestAmount: true,
      contractFinalAmount: true,
      contractRemainingAmount: true,
      status: true,
      isImported: true,
      createdAt: true,
      note: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      device: {
        select: {
          id: true,
          model: true,
          imei: true,
        },
      },
      schedules: {
        orderBy: { monthNumber: 'asc' },
        select: {
          id: true,
          dueDate: true,
          delayedUntil: true,
          status: true,
          expectedAmount: true,
          paidAmount: true,
          paidAt: true,
          contractExpectedAmount: true,
          contractPaidAmount: true,
        },
      },
    },
    }),
    prisma.nasiya.count({ where }),
  ])

  // Single `now` for the whole batch so all rows are judged against the same instant.
  const now = new Date()

  const derivedItems = rows
    .map((nasiya) => {
      const scheduleInputs = nasiya.schedules.map((s) => ({
        status: s.status,
        dueDate: s.dueDate,
        delayedUntil: s.delayedUntil,
        expectedAmount: Number(s.expectedAmount),
        paidAmount: Number(s.paidAmount),
        contractExpectedAmount: Number(s.contractExpectedAmount),
        contractPaidAmount: Number(s.contractPaidAmount),
      }))
      const derived = deriveContractNasiyaStatus(
        {
          status: nasiya.status,
          contractCurrency: nasiya.contractCurrency,
          contractFinalAmount: Number(nasiya.contractFinalAmount),
          contractRemainingAmount: Number(nasiya.contractRemainingAmount),
          schedules: scheduleInputs,
        },
        now,
      )
      // Payment score must read the deal's own contract-currency amounts —
      // see docs/currency-accounting-model.md — never the legacy UZS
      // snapshot, which would misjudge overdue tolerance for a USD contract.
      const paymentScore = computeNasiyaPaymentScore(
        {
          schedules: nasiya.schedules.map((s) => ({
            status: s.status,
            dueDate: s.dueDate,
            delayedUntil: s.delayedUntil,
            expectedAmount: Number(s.contractExpectedAmount),
            paidAmount: Number(s.contractPaidAmount),
            paidAt: s.paidAt,
          })),
        },
        now,
        currency,
        nasiya.contractCurrency,
      )

      return {
        id: nasiya.id,
        totalAmount: Number(nasiya.totalAmount),
        remainingAmount: Number(nasiya.remainingAmount),
        baseRemainingAmount: Number(nasiya.baseRemainingAmount),
        interestPercent: Number(nasiya.interestPercent),
        interestAmount: Number(nasiya.interestAmount),
        finalNasiyaAmount: Number(nasiya.finalNasiyaAmount),
        contractCurrency: nasiya.contractCurrency,
        contractInterestAmount: Number(nasiya.contractInterestAmount),
        contractFinalAmount: Number(nasiya.contractFinalAmount),
        contractRemainingAmount: Number(nasiya.contractRemainingAmount),
        status: nasiya.status,
        isImported: nasiya.isImported,
        displayStatus: derived.displayStatus,
        isOverdue: derived.isOverdue,
        overdueAmount: derived.overdueAmount,
        overdueCount: derived.overdueCount,
        nextPaymentDate: derived.nextPaymentDate?.toISOString() ?? null,
        createdAt: nasiya.createdAt.toISOString(),
        note: nasiya.note,
        customer: nasiya.customer,
        device: nasiya.device,
        schedules: nasiya.schedules.map((schedule) => ({
          id: schedule.id,
          dueDate: schedule.dueDate.toISOString(),
          delayedUntil: schedule.delayedUntil?.toISOString() ?? null,
          status: schedule.status,
        })),
        paymentScore,
      }
    })
    .sort((left, right) => {
      // Overdue contracts first, then by earliest upcoming payment, then newest.
      if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1

      const nextLeft = left.nextPaymentDate ? new Date(left.nextPaymentDate).getTime() : null
      const nextRight = right.nextPaymentDate ? new Date(right.nextPaymentDate).getTime() : null
      if (nextLeft == null && nextRight == null) {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      }
      if (nextLeft == null) return 1
      if (nextRight == null) return -1
      return nextLeft - nextRight
    })

  const matchingItems = query.status ? derivedItems.filter((item) => item.displayStatus === query.status) : derivedItems
  const items = query.status ? matchingItems.slice(skip, skip + take) : matchingItems
  const total = query.status ? matchingItems.length : rawTotal

  return { items, total, skip, take }
}

export async function getShopLogsInitial(shopId: string): Promise<ShopLogsPayload> {
  const where = {
    shopId,
    actorType: 'SHOP_ADMIN' as const,
  }

  const [logs, total] = await Promise.all([
    prisma.log.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        actorId: true,
        actorType: true,
        action: true,
        targetType: true,
        targetId: true,
        note: true,
        newValue: true,
      },
    }),
    prisma.log.count({ where }),
  ])

  const logsWithActors = await enrichLogsWithActors(logs)

  return {
    total,
    logs: logsWithActors.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  }
}
