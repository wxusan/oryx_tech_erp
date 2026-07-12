import 'server-only'

import { prisma } from '@/lib/prisma'

/** Shared by the reminders cron and database integration tests. */
export function transitionNasiyaToOverdue(input: {
  scheduleId: string
  nasiyaId: string
  shopId: string
  /** Start of the current Tashkent day. The effective due date must be earlier. */
  overdueBefore: Date
  notifications?: Array<{
    dedupeKey: string
    message: string
    telegramId: string
    scheduledAt: Date
  }>
}) {
  return prisma.$transaction(async (tx) => {
    // Put the due-date and unpaid-status predicates on the write itself. If a
    // concurrent payment closes the schedule after cron selected it, this
    // update becomes a no-op and neither the parent nor notifications change.
    const scheduleUpdate = await tx.nasiyaSchedule.updateMany({
      where: {
        id: input.scheduleId,
        nasiyaId: input.nasiyaId,
        shopId: input.shopId,
        status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] },
        OR: [
          { delayedUntil: null, dueDate: { lt: input.overdueBefore } },
          { delayedUntil: { lt: input.overdueBefore } },
        ],
        nasiya: {
          id: input.nasiyaId,
          shopId: input.shopId,
          deletedAt: null,
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
      },
      data: { status: 'OVERDUE' },
    })

    // An already-overdue row still needs its once-per-day deduped alert. This
    // second read is only needed when no transition happened; it also prevents
    // a concurrently-paid schedule from falling through to parent updates.
    if (scheduleUpdate.count === 0) {
      const alreadyOverdue = await tx.nasiyaSchedule.findFirst({
        where: {
          id: input.scheduleId,
          nasiyaId: input.nasiyaId,
          shopId: input.shopId,
          status: 'OVERDUE',
          OR: [
            { delayedUntil: null, dueDate: { lt: input.overdueBefore } },
            { delayedUntil: { lt: input.overdueBefore } },
          ],
          nasiya: {
            id: input.nasiyaId,
            shopId: input.shopId,
            deletedAt: null,
            status: { in: ['ACTIVE', 'OVERDUE'] },
          },
        },
        select: { id: true },
      })
      if (!alreadyOverdue) return false
    }

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
    const nasiyaUpdate = await tx.nasiya.updateMany({
      where: { id: input.nasiyaId, shopId: input.shopId, status: 'ACTIVE', deletedAt: null },
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
