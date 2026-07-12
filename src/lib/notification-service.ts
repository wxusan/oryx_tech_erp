import { prisma } from '@/lib/prisma'
import { sendTelegramMediaGroup, sendTelegramMessage, sendTelegramPhoto, type TelegramSendResult } from '@/lib/telegram'
import { planTelegramDelivery } from '@/lib/telegram-delivery'
import { resolveNotificationImageKeys, resolveNotificationImageUrls } from '@/lib/server/notification-image'
import { logger } from '@/lib/logger'
import { recordOpsEvent } from '@/lib/server/ops-events'

const MAX_NOTIFICATION_ATTEMPTS = 5
const NOTIFICATION_BATCH_SIZE = 100
const NOTIFICATION_SEND_CONCURRENCY = 5
const STALE_PROCESSING_MS = 5 * 60 * 1000

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

export async function queueNotification(params: QueueNotificationParams, options: QueueNotificationOptions = {}): Promise<void> {
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
    if (options.processImmediately !== false && scheduledAt <= new Date()) await processPendingNotifications()
  } catch (error) {
    await recordOpsEvent({ level: 'ERROR', event: 'notification.queue_failed', message: 'Failed to queue notification', shopId: params.shopId, status: params.type, metadata: { error: error instanceof Error ? error.message : String(error) } })
  }
}

export interface NotificationRunSummary {
  attempted: number
  sent: number
  sentWithImage: number
  imagesRequested: number
  imagesSent: number
  imagesFailed: number
  groupsSent: number
  failed: number
  cancelled: number
  durationMs: number
}

type PendingNotification = Awaited<ReturnType<typeof prisma.notification.findMany>>[number]

async function saveTextDelivered(id: string) {
  await prisma.notification.update({ where: { id }, data: { textSentAt: new Date() } })
}

async function saveMediaDelivered(id: string, positions: number[]) {
  if (!positions.length) return
  await prisma.notification.update({ where: { id }, data: { mediaSentPositions: { push: positions } } })
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
  for (const step of steps) {
    let result: TelegramSendResult
    if (step.method === 'message') {
      result = await sendTelegramMessage(notification.telegramId, step.text)
      if (result.ok) await saveTextDelivered(notification.id)
    } else if (step.method === 'photo') {
      result = await sendTelegramPhoto(notification.telegramId, step.item.imageUrl, step.caption)
      if (result.ok) {
        imagesSent++
        await saveMediaDelivered(notification.id, [step.item.position])
      }
    } else {
      result = await sendTelegramMediaGroup(notification.telegramId, step.items.map((item) => item.imageUrl), step.caption)
      if (result.ok) {
        imagesSent += step.items.length
        groupsSent++
        await saveMediaDelivered(notification.id, step.items.map((item) => item.position))
      }
    }
    if (!result.ok) {
      firstError = result
      break
    }
  }

  // If media/signing failed, guarantee the business message still arrives.
  if ((firstError || unresolvedCount > 0) && !notification.textSentAt) {
    const fallback = await sendTelegramMessage(notification.telegramId, notification.message)
    if (fallback.ok) await saveTextDelivered(notification.id)
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
  const finalize = (): NotificationRunSummary => ({ ...counters, durationMs: Date.now() - startedAt })
  try {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS)
    const pending = await prisma.notification.findMany({
      where: { OR: [
        { status: { in: ['PENDING', 'FAILED'] }, scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: 'PROCESSING', lastAttemptAt: { lte: staleBefore } },
      ] },
      orderBy: { scheduledAt: 'asc' },
      take: NOTIFICATION_BATCH_SIZE,
    })

    for (let offset = 0; offset < pending.length; offset += NOTIFICATION_SEND_CONCURRENCY) {
      await Promise.all(pending.slice(offset, offset + NOTIFICATION_SEND_CONCURRENCY).map(async (notification) => {
        const claim = await prisma.notification.updateMany({
          where: { id: notification.id, OR: [{ status: { in: ['PENDING', 'FAILED'] } }, { status: 'PROCESSING', lastAttemptAt: { lte: staleBefore } }] },
          data: { status: 'PROCESSING', attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
        })
        if (claim.count !== 1) return
        counters.attempted++
        try {
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
          const exhausted = attemptCount >= MAX_NOTIFICATION_ATTEMPTS
          if (exhausted) counters.cancelled++
          else counters.failed++
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: exhausted ? 'CANCELLED' : 'FAILED',
              nextAttemptAt: exhausted ? null : new Date(Date.now() + nextAttemptDelayMs(attemptCount, result.error?.retryAfterSeconds)),
              lastError: result.error?.description ?? 'Telegram media delivery failed',
            },
          })
          if (exhausted) await recordOpsEvent({ level: 'ERROR', event: 'notification.cancelled', message: 'Notification cancelled after max attempts', shopId: notification.shopId, entityType: 'Notification', entityId: notification.id, status: notification.type, errorCode: result.error?.errorCode, metadata: { attempts: attemptCount, imagesRequested: result.imagesRequested, imagesSent: result.imagesSent, imagesFailed: result.imagesFailed } })
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
    if (counters.attempted) logger.info('notification run complete', { event: 'notification.run', status: counters.failed + counters.cancelled ? 'partial' : 'ok', ...finalize() })
  } catch (error) {
    await recordOpsEvent({ level: 'ERROR', event: 'notification.run_failed', message: 'processPendingNotifications crashed', status: 'error', metadata: { error: error instanceof Error ? error.message : String(error), ...finalize() } })
  }
  return finalize()
}

export async function notifyShopAdmins(shopId: string, message: string, type: string, relatedId?: string, relatedType?: string): Promise<void> {
  try {
    const admins = await prisma.shopAdmin.findMany({ where: { shopId, isActive: true, telegramId: { not: null }, telegramVerifiedAt: { not: null }, deletedAt: null }, select: { telegramId: true } })
    const targets = admins.filter((admin): admin is { telegramId: string } => admin.telegramId !== null)
    if (!targets.length) {
      logger.info('no verified telegram admins for shop', { event: 'notification.no_recipients', shopId, status: type })
      return
    }
    await Promise.all(targets.map((admin) => queueNotification({ shopId, type, message, telegramId: admin.telegramId, relatedId, relatedType }, { processImmediately: false })))
    await processPendingNotifications()
    logger.info('queued notification for shop admins', { event: 'notification.broadcast', shopId, status: type, attempt: targets.length })
  } catch (error) {
    await recordOpsEvent({ level: 'ERROR', event: 'notification.broadcast_failed', message: 'notifyShopAdmins failed', shopId, status: type, metadata: { error: error instanceof Error ? error.message : String(error) } })
  }
}
