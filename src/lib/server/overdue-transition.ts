import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { addMoneyDto, createMoneyDto, moneyDtoEquals, type CurrencyCode } from '@/lib/currency'

/**
 * The financial-invariants migration protects new writes, but historic rows
 * may still have been created before their native remaining amount was stored.
 * Cron must never attempt to update such a row: PostgreSQL quite rightly
 * validates the entire row on status change and would otherwise abort the
 * whole reminder run. This is deliberately a quarantine check, not a repair.
 */
export function hasValidNasiyaScheduleNativeLedger(input: {
  contractExpectedAmount: number | string | { toString(): string }
  contractPaidAmount: number | string | { toString(): string }
  contractRemainingAmount: number | string | { toString(): string }
  contractCurrency: CurrencyCode
  status: string
}): boolean {
  try {
    const expected = createMoneyDto(input.contractCurrency, input.contractExpectedAmount.toString())
    const paid = createMoneyDto(input.contractCurrency, input.contractPaidAmount.toString())
    const remaining = createMoneyDto(input.contractCurrency, input.contractRemainingAmount.toString())
    if (expected.minorUnits <= 0 || paid.minorUnits > expected.minorUnits) return false
    if (!moneyDtoEquals(expected, addMoneyDto(paid, remaining))) return false
    return input.status === 'CANCELLED' || (input.status === 'PAID') === (remaining.minorUnits === 0)
  } catch {
    return false
  }
}

/** Shared by the reminders cron and database integration tests. */
export interface NasiyaOverdueTransitionResult {
  /** The schedule was still overdue/payable, so its daily notification policy applies. */
  notificationEligible: boolean
  /** At least one persisted overdue status changed and requires cache invalidation. */
  stateChanged: boolean
}

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
    recipientShopAdminId: string
    scheduledAt: Date
  }>
  gapMarkers?: Prisma.NotificationCreateManyInput[]
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
        status: { not: 'CANCELLED' },
        contractRemainingAmount: { gt: 0 },
        OR: [
          { delayedUntil: null, dueDate: { lt: input.overdueBefore } },
          { delayedUntil: { lt: input.overdueBefore } },
        ],
        nasiya: {
          id: input.nasiyaId,
          shopId: input.shopId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          resolutionState: 'ACTIVE',
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
          contractRemainingAmount: { gt: 0 },
          OR: [
            { delayedUntil: null, dueDate: { lt: input.overdueBefore } },
            { delayedUntil: { lt: input.overdueBefore } },
          ],
          nasiya: {
            id: input.nasiyaId,
            shopId: input.shopId,
            deletedAt: null,
            status: { not: 'CANCELLED' },
            resolutionState: 'ACTIVE',
          },
        },
        select: { id: true },
      })
      if (!alreadyOverdue) {
        return { notificationEligible: false, stateChanged: false } satisfies NasiyaOverdueTransitionResult
      }
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
    const gapMarkers = input.gapMarkers ?? []
    if (gapMarkers.some((marker) => !marker.dedupeKey)) {
      throw new Error('TELEGRAM_GAP_MARKER_DEDUPE_REQUIRED')
    }
    if (gapMarkers.length > 0) {
      await tx.notification.createMany({ data: gapMarkers, skipDuplicates: true })
    }
    const nasiyaUpdate = await tx.nasiya.updateMany({
      where: { id: input.nasiyaId, shopId: input.shopId, status: { not: 'CANCELLED' }, resolutionState: 'ACTIVE', deletedAt: null },
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
    return {
      notificationEligible: true,
      stateChanged: changed,
    } satisfies NasiyaOverdueTransitionResult
  })
}
