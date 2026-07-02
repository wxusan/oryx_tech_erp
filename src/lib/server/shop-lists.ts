import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

const UNPAID_SCHEDULE_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED']

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
  status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
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

function nextScheduleTime(row: ShopNasiyaListItem) {
  const next = row.schedules
    .filter((schedule) => UNPAID_SCHEDULE_STATUSES.includes(schedule.status))
    .sort((left, right) => {
      const leftDue = left.delayedUntil ?? left.dueDate
      const rightDue = right.delayedUntil ?? right.dueDate
      return new Date(leftDue).getTime() - new Date(rightDue).getTime()
    })[0]

  return next ? new Date(next.delayedUntil ?? next.dueDate).getTime() : null
}

export async function getShopNasiyalarList(shopId: string): Promise<ShopNasiyaListItem[]> {
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
        },
      },
    },
  })

  return nasiyalar
    .map((nasiya) => ({
      ...nasiya,
      totalAmount: Number(nasiya.totalAmount),
      remainingAmount: Number(nasiya.remainingAmount),
      createdAt: nasiya.createdAt.toISOString(),
      schedules: nasiya.schedules.map((schedule) => ({
        ...schedule,
        dueDate: schedule.dueDate.toISOString(),
        delayedUntil: schedule.delayedUntil?.toISOString() ?? null,
      })),
    }))
    .sort((left, right) => {
      const nextLeft = nextScheduleTime(left)
      const nextRight = nextScheduleTime(right)

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

  return {
    total,
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  }
}
