import 'server-only'

import { prisma } from '@/lib/prisma'

export interface ShopLogLinkTarget {
  targetType: string
  targetId: string
}

export function shopLogTargetKey(target: ShopLogLinkTarget) {
  return `${target.targetType}:${target.targetId}`
}

/**
 * Resolve all visible log destinations in five set-based queries at most.
 * This keeps each row a real link (keyboard/new-tab friendly) without the
 * previous per-click REST fetch or an N+1 lookup on the client.
 */
export async function resolveShopLogTargetHrefs(
  shopId: string,
  targets: readonly ShopLogLinkTarget[],
): Promise<Map<string, string>> {
  const uniqueTargets = [...new Map(targets.map((target) => [shopLogTargetKey(target), target])).values()]
  const idsFor = (targetType: string) => uniqueTargets
    .filter((target) => target.targetType === targetType)
    .map((target) => target.targetId)
  const deviceIds = idsFor('Device')
  const nasiyaIds = idsFor('Nasiya')
  const scheduleIds = idsFor('NasiyaSchedule')
  const saleIds = idsFor('Sale')
  const payableIds = idsFor('SupplierPayable')

  const [devices, nasiyas, schedules, sales, payables] = await Promise.all([
    deviceIds.length
      ? prisma.device.findMany({ where: { shopId, id: { in: deviceIds } }, select: { id: true } })
      : Promise.resolve([]),
    nasiyaIds.length
      ? prisma.nasiya.findMany({ where: { shopId, id: { in: nasiyaIds } }, select: { id: true } })
      : Promise.resolve([]),
    scheduleIds.length
      ? prisma.nasiyaSchedule.findMany({ where: { shopId, id: { in: scheduleIds } }, select: { id: true, nasiyaId: true } })
      : Promise.resolve([]),
    saleIds.length
      ? prisma.sale.findMany({ where: { shopId, id: { in: saleIds } }, select: { id: true, deviceId: true } })
      : Promise.resolve([]),
    payableIds.length
      ? prisma.supplierPayable.findMany({ where: { shopId, id: { in: payableIds } }, select: { id: true } })
      : Promise.resolve([]),
  ])

  const hrefs = new Map<string, string>()
  for (const device of devices) hrefs.set(shopLogTargetKey({ targetType: 'Device', targetId: device.id }), `/shop/qurilmalar/${device.id}`)
  for (const nasiya of nasiyas) hrefs.set(shopLogTargetKey({ targetType: 'Nasiya', targetId: nasiya.id }), `/shop/nasiyalar/${nasiya.id}`)
  for (const schedule of schedules) hrefs.set(shopLogTargetKey({ targetType: 'NasiyaSchedule', targetId: schedule.id }), `/shop/nasiyalar/${schedule.nasiyaId}`)
  for (const sale of sales) hrefs.set(shopLogTargetKey({ targetType: 'Sale', targetId: sale.id }), `/shop/qurilmalar/${sale.deviceId}`)
  for (const payable of payables) hrefs.set(shopLogTargetKey({ targetType: 'SupplierPayable', targetId: payable.id }), '/shop/olib-sotdim')

  return hrefs
}
