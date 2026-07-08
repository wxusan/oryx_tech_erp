import 'server-only'

import { unstable_cache } from 'next/cache'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { shopCacheTag } from '@/lib/server/cache-tags'
import { enrichLogsWithActors } from '@/lib/server/log-actors'
import { deriveNasiyaOverdue, type NasiyaDisplayStatus } from '@/lib/nasiya-utils'
import { computeNasiyaPaymentScore, type NasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { getShopCurrencyContext } from '@/lib/server/currency'

/**
 * Sale/nasiya summary for a sold/returned device — purchase price vs. sold
 * price, kept separate from any nasiya interest (accounting already splits
 * `totalAmount` = original device price from `interestAmount`, so device
 * profit never silently absorbs interest income). `profit` is `null` for a
 * returned device rather than a misleading number.
 */
export interface ShopDeviceSaleInfo {
  saleType: 'CASH' | 'NASIYA'
  soldPrice: number
  interestAmount: number
  profit: number | null
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

export async function getShopDevicesList(shopId: string): Promise<ShopDeviceListItem[]> {
  return unstable_cache(
    () => getShopDevicesListFresh(shopId),
    ['shop-devices:list:v1', shopId],
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
  sales: { salePrice: unknown; createdAt: Date; customer: { name: string } }[]
  nasiya: { totalAmount: unknown; interestAmount: unknown; createdAt: Date; customer: { name: string } }[]
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

  if (useNasiya && latestNasiya) {
    // totalAmount = original device price BEFORE interest (see Nasiya model comment) —
    // never fold interest into device profit.
    const soldPrice = Number(latestNasiya.totalAmount)
    return {
      saleType: 'NASIYA',
      soldPrice,
      interestAmount: Number(latestNasiya.interestAmount),
      profit: returned ? null : soldPrice - purchasePrice,
      customerName: latestNasiya.customer.name,
      soldAt: latestNasiya.createdAt.toISOString(),
      returned,
      refundAmount,
    }
  }
  const soldPrice = Number(latestSale!.salePrice)
  return {
    saleType: 'CASH',
    soldPrice,
    interestAmount: 0,
    profit: returned ? null : soldPrice - purchasePrice,
    customerName: latestSale!.customer.name,
    soldAt: latestSale!.createdAt.toISOString(),
    returned,
    refundAmount,
  }
}

async function getShopDevicesListFresh(shopId: string): Promise<ShopDeviceListItem[]> {
  const devices = await prisma.device.findMany({
    where: { shopId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      model: true,
      color: true,
      storage: true,
      batteryHealth: true,
      purchasePrice: true,
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
        select: { salePrice: true, createdAt: true, customer: { select: { name: true } } },
      },
      nasiya: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { totalAmount: true, interestAmount: true, createdAt: true, customer: { select: { name: true } } },
      },
      returns: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { refundAmount: true, createdAt: true },
      },
    },
  })

  return devices.map((device) => ({
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
  }))
}

export async function getShopNasiyalarList(shopId: string): Promise<ShopNasiyaListItem[]> {
  return unstable_cache(
    () => getShopNasiyalarListFresh(shopId),
    ['shop-nasiyalar:list:v1', shopId],
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

async function getShopNasiyalarListFresh(shopId: string): Promise<ShopNasiyaListItem[]> {
  // Payment-score reason text must reflect the shop's selected display
  // currency (never hardcode UZS) — see docs/nasiya-payment-scoring.md.
  const currency = await getShopCurrencyContext(shopId)
  const nasiyalar = await prisma.nasiya.findMany({
    where: { shopId, deletedAt: null },
    take: 500,
    select: {
      id: true,
      totalAmount: true,
      remainingAmount: true,
      baseRemainingAmount: true,
      interestPercent: true,
      interestAmount: true,
      finalNasiyaAmount: true,
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
        },
      },
    },
  })

  // Single `now` for the whole batch so all rows are judged against the same
  // instant (and it stays stable for the cached snapshot's lifetime).
  const now = new Date()

  return nasiyalar
    .map((nasiya) => {
      const scheduleInputs = nasiya.schedules.map((s) => ({
        status: s.status,
        dueDate: s.dueDate,
        delayedUntil: s.delayedUntil,
        expectedAmount: Number(s.expectedAmount),
        paidAmount: Number(s.paidAmount),
      }))
      const derived = deriveNasiyaOverdue({ status: nasiya.status, schedules: scheduleInputs }, now)
      const paymentScore = computeNasiyaPaymentScore(
        {
          schedules: nasiya.schedules.map((s, i) => ({ ...scheduleInputs[i], paidAt: s.paidAt })),
        },
        now,
        currency,
      )

      return {
        id: nasiya.id,
        totalAmount: Number(nasiya.totalAmount),
        remainingAmount: Number(nasiya.remainingAmount),
        baseRemainingAmount: Number(nasiya.baseRemainingAmount),
        interestPercent: Number(nasiya.interestPercent),
        interestAmount: Number(nasiya.interestAmount),
        finalNasiyaAmount: Number(nasiya.finalNasiyaAmount),
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
