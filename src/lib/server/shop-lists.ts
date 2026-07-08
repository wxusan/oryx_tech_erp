import 'server-only'

import { unstable_cache } from 'next/cache'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { shopCacheTag } from '@/lib/server/cache-tags'
import { enrichLogsWithActors } from '@/lib/server/log-actors'
import { deriveNasiyaOverdue, type NasiyaDisplayStatus } from '@/lib/nasiya-utils'
import { computeNasiyaPaymentScore, type NasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { computeSaleContractMargin, type PurchaseCostLike } from '@/lib/nasiya-contract'
import type { CurrencyCode } from '@/lib/currency'

/**
 * Hard per-shop cap on the server-rendered devices/nasiyalar list pages.
 * These pages have no pagination UI (client-side search only searches
 * whatever is loaded) — see docs/audits/full-production-audit.md's
 * pagination follow-up. Rather than silently truncating with no signal,
 * `getShopDevicesList`/`getShopNasiyalarList` fetch one extra row to detect
 * an over-the-cap shop and surface `truncated: true` so the page can show a
 * banner instead of quietly hiding data.
 */
export const SHOP_LIST_HARD_CAP = 500

export interface ShopListResult<T> {
  items: T[]
  /** True when the shop has more rows than SHOP_LIST_HARD_CAP — only the newest are shown. */
  truncated: boolean
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
export interface ShopDeviceSaleInfo {
  saleType: 'CASH' | 'NASIYA'
  soldPrice: number
  interestAmount: number
  profit: number | null
  contractCurrency: CurrencyCode
  contractSoldPrice: number
  contractProfit: number | null
  customerName: string | null
  soldAt: string
  returned: boolean
  refundAmount: number | null
}

export interface ShopDeviceListItem {
  id: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  imei: string
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_NASIYA' | 'RESERVED' | 'RETURNED' | 'DELETED'
  createdAt: string
  note: string | null
  supplierName: string | null
  supplierPhone: string | null
  saleInfo: ShopDeviceSaleInfo | null
}

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

export async function getShopDevicesList(shopId: string): Promise<ShopListResult<ShopDeviceListItem>> {
  return unstable_cache(
    () => getShopDevicesListFresh(shopId),
    ['shop-devices:list:v2', shopId],
    {
      revalidate: 30,
      tags: [shopCacheTag.devices(shopId)],
    },
  )()
}

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
  const contractExchangeRateAtCreation =
    latestSale!.contractExchangeRateAtCreation != null ? Number(latestSale!.contractExchangeRateAtCreation) : null
  return {
    saleType: 'CASH',
    soldPrice,
    interestAmount: 0,
    profit: returned ? null : soldPrice - purchasePrice,
    contractCurrency,
    contractSoldPrice,
    contractProfit: returned ? null : computeSaleContractMargin(contractSoldPrice, contractCurrency, contractExchangeRateAtCreation, purchase),
    customerName: latestSale!.customer.name,
    soldAt: latestSale!.createdAt.toISOString(),
    returned,
    refundAmount,
  }
}

async function getShopDevicesListFresh(shopId: string): Promise<ShopListResult<ShopDeviceListItem>> {
  const rows = await prisma.device.findMany({
    where: { shopId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: SHOP_LIST_HARD_CAP + 1,
    select: {
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
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          salePrice: true,
          createdAt: true,
          customer: { select: { name: true } },
          contractCurrency: true,
          contractSalePrice: true,
          contractExchangeRateAtCreation: true,
        },
      },
      nasiya: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { refundAmount: true, createdAt: true },
      },
    },
  })

  const truncated = rows.length > SHOP_LIST_HARD_CAP
  const devices = truncated ? rows.slice(0, SHOP_LIST_HARD_CAP) : rows

  return {
    items: devices.map((device) => ({
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
    })),
    truncated,
  }
}

export async function getShopNasiyalarList(shopId: string): Promise<ShopListResult<ShopNasiyaListItem>> {
  return unstable_cache(
    () => getShopNasiyalarListFresh(shopId),
    ['shop-nasiyalar:list:v2', shopId],
    {
      revalidate: 15,
      tags: [
        shopCacheTag.nasiyalar(shopId),
        shopCacheTag.nasiyaSchedules(shopId),
        shopCacheTag.customers(shopId),
      ],
    },
  )()
}

async function getShopNasiyalarListFresh(shopId: string): Promise<ShopListResult<ShopNasiyaListItem>> {
  // Payment-score reason text must reflect the shop's selected display
  // currency (never hardcode UZS) — see docs/nasiya-payment-scoring.md.
  const currency = await getShopCurrencyContext(shopId)
  const rows = await prisma.nasiya.findMany({
    where: { shopId, deletedAt: null },
    take: SHOP_LIST_HARD_CAP + 1,
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
  })

  // Single `now` for the whole batch so all rows are judged against the same
  // instant (and it stays stable for the cached snapshot's lifetime).
  const now = new Date()

  const truncated = rows.length > SHOP_LIST_HARD_CAP
  const nasiyalar = truncated ? rows.slice(0, SHOP_LIST_HARD_CAP) : rows

  const items = nasiyalar
    .map((nasiya) => {
      const scheduleInputs = nasiya.schedules.map((s) => ({
        status: s.status,
        dueDate: s.dueDate,
        delayedUntil: s.delayedUntil,
        expectedAmount: Number(s.expectedAmount),
        paidAmount: Number(s.paidAmount),
      }))
      const derived = deriveNasiyaOverdue({ status: nasiya.status, schedules: scheduleInputs }, now)
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

  return { items, truncated }
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
