import 'server-only'

import { unstable_cache } from 'next/cache'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { shopCacheTag } from '@/lib/server/cache-tags'
import { enrichLogsWithActors } from '@/lib/server/log-actors'
import { deriveNasiyaOverdue, type NasiyaDisplayStatus } from '@/lib/nasiya-utils'

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
}

export interface ShopNasiyaListItem {
  id: string
  totalAmount: number
  remainingAmount: number
  /** Stored parent status (kept for reference / debugging). */
  status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
  /** Live display status derived from schedules (matches the dashboard). */
  displayStatus: NasiyaDisplayStatus
  isOverdue: boolean
  overdueAmount: number
  overdueCount: number
  nextPaymentDate: string | null
  createdAt: string
  device: { id: string; model: string; imei: string }
  customer: { id: string; name: string; phone: string }
  schedules: {
    id: string
    dueDate: string
    delayedUntil: string | null
    status: string
  }[]
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
    },
  })

  return devices.map((device) => ({
    ...device,
    purchasePrice: Number(device.purchasePrice),
    createdAt: device.createdAt.toISOString(),
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
  const nasiyalar = await prisma.nasiya.findMany({
    where: { shopId, deletedAt: null },
    take: 500,
    select: {
      id: true,
      totalAmount: true,
      remainingAmount: true,
      status: true,
      createdAt: true,
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
        },
      },
    },
  })

  // Single `now` for the whole batch so all rows are judged against the same
  // instant (and it stays stable for the cached snapshot's lifetime).
  const now = new Date()

  return nasiyalar
    .map((nasiya) => {
      const derived = deriveNasiyaOverdue(
        {
          status: nasiya.status,
          schedules: nasiya.schedules.map((s) => ({
            status: s.status,
            dueDate: s.dueDate,
            delayedUntil: s.delayedUntil,
            expectedAmount: Number(s.expectedAmount),
            paidAmount: Number(s.paidAmount),
          })),
        },
        now,
      )

      return {
        id: nasiya.id,
        totalAmount: Number(nasiya.totalAmount),
        remainingAmount: Number(nasiya.remainingAmount),
        status: nasiya.status,
        displayStatus: derived.displayStatus,
        isOverdue: derived.isOverdue,
        overdueAmount: derived.overdueAmount,
        overdueCount: derived.overdueCount,
        nextPaymentDate: derived.nextPaymentDate?.toISOString() ?? null,
        createdAt: nasiya.createdAt.toISOString(),
        customer: nasiya.customer,
        device: nasiya.device,
        schedules: nasiya.schedules.map((schedule) => ({
          id: schedule.id,
          dueDate: schedule.dueDate.toISOString(),
          delayedUntil: schedule.delayedUntil?.toISOString() ?? null,
          status: schedule.status,
        })),
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
