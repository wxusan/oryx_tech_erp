import 'server-only'

import { prisma } from '@/lib/prisma'

/** Shared by the reminders cron and database integration tests. */
export function transitionNasiyaToOverdue(input: {
  scheduleId: string
  nasiyaId: string
  shopId: string
  notifications?: Array<{
    dedupeKey: string
    message: string
    telegramId: string
    scheduledAt: Date
  }>
}) {
  return prisma.$transaction(async (tx) => {
    for (const notification of input.notifications ?? []) {
      await tx.notification.upsert({
        where: { dedupeKey: notification.dedupeKey },
        update: {},
        create: {
          ...notification,
          shopId: input.shopId,
          type: 'OVERDUE',
          relatedId: input.scheduleId,
          relatedType: 'NasiyaSchedule',
        },
      })
    }
    const scheduleUpdate = await tx.nasiyaSchedule.updateMany({
      where: { id: input.scheduleId, status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } },
      data: { status: 'OVERDUE' },
    })
    const nasiyaUpdate = await tx.nasiya.updateMany({
      where: { id: input.nasiyaId, status: { not: 'OVERDUE' } },
      data: { status: 'OVERDUE' },
    })
    const changed = scheduleUpdate.count > 0 || nasiyaUpdate.count > 0
    if (changed) {
      await tx.changeEvent.create({
        data: {
          scopeType: 'SHOP',
          scopeId: input.shopId,
          domain: 'nasiyas',
          entityType: 'Nasiya',
          entityId: input.nasiyaId,
          operation: 'updated',
          mutationKind: 'nasiya.overdue',
        },
      })
    }
    return changed
  })
}
