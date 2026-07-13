import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { sendTelegramMediaGroup, sendTelegramMessage, sendTelegramPhoto, type TelegramSendResult } from '@/lib/telegram'
import { planTelegramDelivery } from '@/lib/telegram-delivery'
import { resolveNotificationImageKeys, resolveNotificationImageUrls } from '@/lib/server/notification-image'
import { logger } from '@/lib/logger'
import { recordOpsEvent } from '@/lib/server/ops-events'

const MAX_NOTIFICATION_ATTEMPTS = 5
const NOTIFICATION_BATCH_SIZE = 100
const NOTIFICATION_SEND_CONCURRENCY = 5
const NOTIFICATION_MAX_BATCHES_PER_RUN = 5
const NOTIFICATION_RUN_BUDGET_MS = 8_000
const STALE_PROCESSING_MS = 5 * 60 * 1000

const NASIYA_REMINDER_TYPES = new Set(['REMINDER', 'OVERDUE', 'EARLY_REMINDER'])
const SALE_REMINDER_TYPES = new Set(['SALE_REMINDER', 'SALE_OVERDUE', 'SALE_EARLY_REMINDER'])
const SUPPLIER_REMINDER_TYPES = new Set([
  'SUPPLIER_PAYABLE_REMINDER',
  'SUPPLIER_PAYABLE_OVERDUE',
  'SUPPLIER_PAYABLE_EARLY_REMINDER',
])

function nextAttemptDelayMs(attemptCount: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds * 1000
  return Math.min(60 * 60 * 1000, 2 ** Math.max(0, attemptCount - 1) * 60 * 1000)
}

interface QueueNotificationParams {
  shopId: string
  type: string
  message: string
  telegramId: string
  scheduledAt?: Date
  relatedId?: string
  relatedType?: string
}

interface QueueNotificationOptions { processImmediately?: boolean }

export async function queueNotification(params: QueueNotificationParams, options: QueueNotificationOptions = {}): Promise<boolean> {
  try {
    const scheduledAt = params.scheduledAt ?? new Date()
    const notification = await prisma.notification.create({
      data: {
        shopId: params.shopId,
        type: params.type,
        message: params.message,
        telegramId: params.telegramId,
        status: 'PENDING',
        scheduledAt,
        relatedId: params.relatedId ?? null,
        relatedType: params.relatedType ?? null,
      },
    })
    logger.info('notification queued', { event: 'notification.queued', shopId: params.shopId, entityType: 'Notification', entityId: notification.id, status: params.type })
    if (options.processImmediately !== false && scheduledAt <= new Date()) {
      const delivery = await processPendingNotifications()
      return delivery.ok
    }
    return true
  } catch (error) {
    await recordOpsEvent({ level: 'ERROR', event: 'notification.queue_failed', message: 'Failed to queue notification', shopId: params.shopId, status: params.type, metadata: { error: error instanceof Error ? error.message : String(error) } })
    return false
  }
}

export interface NotificationRunSummary {
  ok: boolean
  crashed: boolean
  attempted: number
  sent: number
  sentWithImage: number
  imagesRequested: number
  imagesSent: number
  imagesFailed: number
  groupsSent: number
  failed: number
  cancelled: number
  remainingDue: number
  retryScheduled: number
  processing: number
  durationMs: number
}

type PendingNotification = Awaited<ReturnType<typeof prisma.notification.findMany>>[number]

function pendingDueWhere(now: Date): Prisma.NotificationWhereInput {
  return {
    status: { in: ['PENDING', 'FAILED'] },
    scheduledAt: { lte: now },
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  }
}

function dueNotificationsWhere(now: Date, staleBefore: Date): Prisma.NotificationWhereInput {
  return {
    OR: [
      pendingDueWhere(now),
      {
        status: 'PROCESSING',
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: staleBefore } }],
      },
    ],
  }
}

function hasPositiveDebt(...amounts: Array<unknown>): boolean {
  return amounts.some((amount) => Number(amount) > 0)
}

/**
 * Re-authorize the stored target and re-check debt reminder state immediately
 * before an external send. Event notifications (sale created, payment
 * received, return, etc.) are immutable facts and must still be delivered;
 * only the reminder types whose related entity describes current debt are
 * cancelled when that debt is no longer active.
 */
async function preDeliveryCancellationReason(notification: PendingNotification): Promise<string | null> {
  const recipient = await prisma.shopAdmin.findFirst({
    where: {
      shopId: notification.shopId,
      telegramId: notification.telegramId,
      telegramVerifiedAt: { not: null },
      isActive: true,
      deletedAt: null,
      shop: { status: 'ACTIVE', deletedAt: null },
    },
    select: { id: true },
  })
  if (!recipient) return 'recipient_revoked_or_unverified'

  if (NASIYA_REMINDER_TYPES.has(notification.type)) {
    if (notification.relatedType !== 'NasiyaSchedule' || !notification.relatedId) {
      return 'invalid_reminder_reference'
    }
    const [schedule, newerDeferral] = await Promise.all([
      prisma.nasiyaSchedule.findFirst({
        where: { id: notification.relatedId, shopId: notification.shopId },
        select: {
          status: true,
          expectedAmount: true,
          paidAmount: true,
          contractRemainingAmount: true,
          payments: {
            where: { createdAt: { gt: notification.createdAt }, deletedAt: null },
            select: { id: true },
            take: 1,
          },
          nasiya: {
            select: {
              status: true,
              reminderEnabled: true,
              remainingAmount: true,
              contractRemainingAmount: true,
              returnedAt: true,
              deletedAt: true,
            },
          },
        },
      }),
      prisma.nasiyaDeferral.findFirst({
        where: {
          shopId: notification.shopId,
          nasiyaScheduleId: notification.relatedId,
          createdAt: { gt: notification.createdAt },
        },
        select: { id: true },
      }),
    ])
    const scheduleDebt = schedule && hasPositiveDebt(
      schedule.contractRemainingAmount,
      Number(schedule.expectedAmount) - Number(schedule.paidAmount),
    )
    const nasiyaDebt = schedule && hasPositiveDebt(
      schedule.nasiya.contractRemainingAmount,
      schedule.nasiya.remainingAmount,
    )
    const active = schedule
      && ['PENDING', 'PARTIAL', 'DEFERRED', 'OVERDUE'].includes(schedule.status)
      && ['ACTIVE', 'OVERDUE'].includes(schedule.nasiya.status)
      && schedule.nasiya.reminderEnabled
      && !schedule.nasiya.returnedAt
      && !schedule.nasiya.deletedAt
      && scheduleDebt
      && nasiyaDebt
      && schedule.payments.length === 0
      && !newerDeferral
    return active ? null : 'debt_resolved_or_changed'
  }

  if (SALE_REMINDER_TYPES.has(notification.type)) {
    if (notification.relatedType !== 'Sale' || !notification.relatedId) {
      return 'invalid_reminder_reference'
    }
    const sale = await prisma.sale.findFirst({
      where: { id: notification.relatedId, shopId: notification.shopId },
      select: {
        paidFully: true,
        remainingAmount: true,
        contractRemainingAmount: true,
        reminderEnabled: true,
        returnedAt: true,
        deletedAt: true,
        payments: {
          where: { createdAt: { gt: notification.createdAt }, deletedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    })
    const active = sale
      && !sale.paidFully
      && sale.reminderEnabled
      && !sale.returnedAt
      && !sale.deletedAt
      && hasPositiveDebt(sale.contractRemainingAmount, sale.remainingAmount)
      && sale.payments.length === 0
    return active ? null : 'debt_resolved_or_changed'
  }

  if (SUPPLIER_REMINDER_TYPES.has(notification.type)) {
    if (notification.relatedType !== 'SupplierPayable' || !notification.relatedId) {
      return 'invalid_reminder_reference'
    }
    const payable = await prisma.supplierPayable.findFirst({
      where: { id: notification.relatedId, shopId: notification.shopId },
      select: { status: true, reminderEnabled: true, paidAt: true, deletedAt: true },
    })
    const active = payable
      && ['PENDING', 'OVERDUE'].includes(payable.status)
      && payable.reminderEnabled
      && !payable.paidAt
      && !payable.deletedAt
    return active ? null : 'debt_resolved_or_changed'
  }

  return null
}

function isPermanentTelegramFailure(error?: TelegramSendResult): boolean {
  return error?.errorCode === 400 || error?.errorCode === 401 || error?.errorCode === 403
}

async function saveTextDelivered(id: string) {
  await prisma.notification.update({ where: { id }, data: { textSentAt: new Date() } })
}

async function saveMediaDelivered(id: string, positions: number[], textDelivered = false) {
  if (!positions.length) return
  await prisma.notification.update({
    where: { id },
    data: {
      mediaSentPositions: { push: positions },
      ...(textDelivered ? { textSentAt: new Date() } : {}),
    },
  })
}

async function deliverNotification(notification: PendingNotification): Promise<{
  ok: boolean
  withImage: boolean
  imagesRequested: number
  imagesSent: number
  imagesFailed: number
  groupsSent: number
  error?: TelegramSendResult
}> {
  let mediaKeys = notification.mediaKeys
  if (!notification.mediaSnapshotAt) {
    mediaKeys = await resolveNotificationImageKeys(notification)
    await prisma.notification.update({
      where: { id: notification.id },
      data: { mediaKeys, mediaSnapshotAt: new Date() },
    })
  }

  const alreadySent = new Set(notification.mediaSentPositions)
  const pendingPositions = mediaKeys.map((_, position) => position).filter((position) => !alreadySent.has(position))
  const resolved = await resolveNotificationImageUrls(notification.shopId, mediaKeys, pendingPositions)
  const images = resolved.flatMap((item) => item.imageUrl ? [{ position: item.position, imageUrl: item.imageUrl }] : [])
  const unresolvedCount = resolved.length - images.length
  const steps = planTelegramDelivery({ images, caption: notification.message, textAlreadySent: Boolean(notification.textSentAt) })

  let imagesSent = 0
  let groupsSent = 0
  let firstError: TelegramSendResult | undefined
  let failedMethod: 'message' | 'photo' | 'mediaGroup' | undefined
  // Keep delivery progress in memory as well as in the database. The
  // notification object is the snapshot loaded before this attempt, so reading
  // notification.textSentAt again after a successful step would be stale and
  // could resend a caption/message as a fallback in the same attempt.
  let textDelivered = Boolean(notification.textSentAt)
  for (const step of steps) {
    let result: TelegramSendResult
    if (step.method === 'message') {
      result = await sendTelegramMessage(notification.telegramId, step.text)
      if (result.ok) {
        await saveTextDelivered(notification.id)
        textDelivered = true
      }
    } else if (step.method === 'photo') {
      result = await sendTelegramPhoto(notification.telegramId, step.item.imageUrl, step.caption)
      if (result.ok) {
        imagesSent++
        await saveMediaDelivered(notification.id, [step.item.position], Boolean(step.caption))
        if (step.caption) textDelivered = true
      }
    } else {
      result = await sendTelegramMediaGroup(notification.telegramId, step.items.map((item) => item.imageUrl), step.caption)
      if (result.ok) {
        imagesSent += step.items.length
        groupsSent++
        await saveMediaDelivered(notification.id, step.items.map((item) => item.position), Boolean(step.caption))
        if (step.caption) textDelivered = true
      }
    }
    if (!result.ok) {
      firstError = result
      failedMethod = step.method
      break
    }
  }

  // If media/signing failed, try to preserve the business text. Never turn a
  // text-only failure into a duplicate send, and do not immediately retry a
  // Telegram rate limit or an authorization failure through the fallback.
  const fallbackAllowed = unresolvedCount > 0 || (
    firstError
    && failedMethod !== 'message'
    && firstError.errorCode !== 429
    && firstError.errorCode !== 401
    && firstError.errorCode !== 403
  )
  if (fallbackAllowed && !textDelivered) {
    const fallback = await sendTelegramMessage(notification.telegramId, notification.message)
    if (fallback.ok) {
      await saveTextDelivered(notification.id)
      textDelivered = true
    }
    else firstError ??= fallback
  }

  return {
    ok: !firstError && unresolvedCount === 0,
    withImage: imagesSent > 0,
    imagesRequested: pendingPositions.length,
    imagesSent,
    imagesFailed: unresolvedCount + (firstError ? Math.max(1, pendingPositions.length - imagesSent - unresolvedCount) : 0),
    groupsSent,
    error: firstError ?? (unresolvedCount ? { ok: false, description: 'One or more device images could not be signed' } : undefined),
  }
}

export async function processPendingNotifications(): Promise<NotificationRunSummary> {
  const startedAt = Date.now()
  const counters = { attempted: 0, sent: 0, sentWithImage: 0, imagesRequested: 0, imagesSent: 0, imagesFailed: 0, groupsSent: 0, failed: 0, cancelled: 0 }
  let crashed = false
  let remainingDue = 0
  let retryScheduled = 0
  let processing = 0
  const finalize = (): NotificationRunSummary => ({
    ok: !crashed
      && counters.failed === 0
      && counters.cancelled === 0
      && remainingDue === 0
      && retryScheduled === 0
      && processing === 0,
    crashed,
    ...counters,
    remainingDue,
    retryScheduled,
    processing,
    durationMs: Date.now() - startedAt,
  })
  try {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS)
    for (let batch = 0; batch < NOTIFICATION_MAX_BATCHES_PER_RUN; batch++) {
      if (Date.now() - startedAt >= NOTIFICATION_RUN_BUDGET_MS) break
      const pending = await prisma.notification.findMany({
        where: dueNotificationsWhere(now, staleBefore),
        orderBy: { scheduledAt: 'asc' },
        take: NOTIFICATION_BATCH_SIZE,
      })

      for (let offset = 0; offset < pending.length; offset += NOTIFICATION_SEND_CONCURRENCY) {
      await Promise.all(pending.slice(offset, offset + NOTIFICATION_SEND_CONCURRENCY).map(async (notification) => {
        const claim = await prisma.notification.updateMany({
          where: { id: notification.id, ...dueNotificationsWhere(now, staleBefore) },
          data: { status: 'PROCESSING', attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
        })
        if (claim.count !== 1) return
        counters.attempted++
        try {
          const cancellationReason = await preDeliveryCancellationReason(notification)
          if (cancellationReason) {
            counters.cancelled++
            await prisma.notification.update({
              where: { id: notification.id },
              data: {
                status: 'CANCELLED',
                nextAttemptAt: null,
                lastError: `Cancelled before delivery: ${cancellationReason}`,
              },
            })
            await recordOpsEvent({
              level: 'WARN',
              event: 'notification.cancelled',
              message: 'Notification cancelled before delivery',
              shopId: notification.shopId,
              entityType: 'Notification',
              entityId: notification.id,
              status: notification.type,
              metadata: { attempts: notification.attemptCount + 1, reason: cancellationReason },
            })
            return
          }

          const result = await deliverNotification(notification)
          counters.imagesRequested += result.imagesRequested
          counters.imagesSent += result.imagesSent
          counters.imagesFailed += result.imagesFailed
          counters.groupsSent += result.groupsSent
          if (result.ok) {
            counters.sent++
            if (result.withImage || notification.mediaSentPositions.length > 0) counters.sentWithImage++
            await prisma.notification.update({ where: { id: notification.id }, data: { status: 'SENT', sentAt: new Date(), nextAttemptAt: null, lastError: null } })
            return
          }
          const attemptCount = notification.attemptCount + 1
          const permanentFailure = isPermanentTelegramFailure(result.error)
          const cancelled = permanentFailure || attemptCount >= MAX_NOTIFICATION_ATTEMPTS
          if (cancelled) counters.cancelled++
          else counters.failed++
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: cancelled ? 'CANCELLED' : 'FAILED',
              nextAttemptAt: cancelled ? null : new Date(Date.now() + nextAttemptDelayMs(attemptCount, result.error?.retryAfterSeconds)),
              lastError: result.error?.description ?? 'Telegram media delivery failed',
            },
          })
          if (cancelled) await recordOpsEvent({ level: 'ERROR', event: 'notification.cancelled', message: permanentFailure ? 'Notification cancelled after permanent Telegram failure' : 'Notification cancelled after max attempts', shopId: notification.shopId, entityType: 'Notification', entityId: notification.id, status: notification.type, errorCode: result.error?.errorCode, metadata: { attempts: attemptCount, permanentFailure, imagesRequested: result.imagesRequested, imagesSent: result.imagesSent, imagesFailed: result.imagesFailed } })
        } catch (error) {
          const attemptCount = notification.attemptCount + 1
          const exhausted = attemptCount >= MAX_NOTIFICATION_ATTEMPTS
          if (exhausted) counters.cancelled++
          else counters.failed++
          await prisma.notification.update({ where: { id: notification.id }, data: { status: exhausted ? 'CANCELLED' : 'FAILED', nextAttemptAt: exhausted ? null : new Date(Date.now() + nextAttemptDelayMs(attemptCount)), lastError: error instanceof Error ? error.message : 'Unknown notification error' } })
          await recordOpsEvent({ level: 'ERROR', event: exhausted ? 'notification.cancelled' : 'notification.process_error', message: 'Error while processing a notification', shopId: notification.shopId, entityType: 'Notification', entityId: notification.id, status: notification.type, metadata: { attempts: attemptCount, error: error instanceof Error ? error.message : String(error) } })
        }
      }))
      }
      // A short batch proves the due backlog is drained. A full batch loops
      // again (within a strict time/batch budget) instead of leaving rows until
      // the next daily cron or user mutation.
      if (pending.length < NOTIFICATION_BATCH_SIZE) break
    }
    const completionNow = new Date()
    ;[remainingDue, retryScheduled, processing] = await Promise.all([
      prisma.notification.count({ where: pendingDueWhere(completionNow) }),
      prisma.notification.count({
        where: {
          status: 'FAILED',
          scheduledAt: { lte: completionNow },
          nextAttemptAt: { gt: completionNow },
        },
      }),
      // A fresh PROCESSING row may belong to another drain, or to a worker
      // that terminated after claiming. Either way delivery is not yet proven.
      prisma.notification.count({ where: { status: 'PROCESSING' } }),
    ])
  } catch (error) {
    crashed = true
    try {
      await recordOpsEvent({ level: 'ERROR', event: 'notification.run_failed', message: 'processPendingNotifications crashed', status: 'error', metadata: { error: error instanceof Error ? error.message : String(error), ...finalize() } })
    } catch (opsError) {
      logger.error('failed to persist notification run failure', { event: 'notification.run_failure_log_failed', error: opsError })
    }
  }
  const summary = finalize()
  if (summary.attempted || summary.crashed || summary.remainingDue || summary.retryScheduled || summary.processing) {
    logger.info('notification run complete', { event: 'notification.run', status: summary.ok ? 'ok' : 'partial', ...summary })
  }
  return summary
}

export async function notifyShopAdmins(shopId: string, message: string, type: string, relatedId?: string, relatedType?: string): Promise<void> {
  try {
    const admins = await prisma.shopAdmin.findMany({ where: { shopId, isActive: true, telegramId: { not: null }, telegramVerifiedAt: { not: null }, deletedAt: null }, select: { telegramId: true } })
    const targets = admins.filter((admin): admin is { telegramId: string } => admin.telegramId !== null)
    if (!targets.length) {
      logger.info('no verified telegram admins for shop', { event: 'notification.no_recipients', shopId, status: type })
      return
    }
    const queued = await Promise.all(targets.map((admin) => queueNotification({ shopId, type, message, telegramId: admin.telegramId, relatedId, relatedType }, { processImmediately: false })))
    const delivery = await processPendingNotifications()
    const broadcastOk = queued.every(Boolean) && delivery.ok
    logger.info('queued notification for shop admins', { event: 'notification.broadcast', shopId, status: broadcastOk ? 'ok' : 'partial', notificationType: type, attempt: targets.length, queued: queued.filter(Boolean).length, delivery })
    if (!broadcastOk) {
      await recordOpsEvent({ level: 'WARN', event: 'notification.broadcast_partial', message: 'Notification broadcast was not fully delivered', shopId, status: type, metadata: { targets: targets.length, queued: queued.filter(Boolean).length, delivery } })
    }
  } catch (error) {
    await recordOpsEvent({ level: 'ERROR', event: 'notification.broadcast_failed', message: 'notifyShopAdmins failed', shopId, status: type, metadata: { error: error instanceof Error ? error.message : String(error) } })
  }
}
