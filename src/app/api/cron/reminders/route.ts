/**
 * GET /api/cron/reminders
 *
 * Generates planned Telegram reminders and drains the delivery queue. Reminder
 * generation is keyset-paged and checkpointed in ReminderGenerationState so a
 * timeout or missed daily cron resumes without skipping records. Notification
 * dedupe keys include the original Tashkent trigger day, which makes retries
 * and same-day rescans idempotent.
 */

import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasValidInternalSecret, internalSecret } from '@/lib/api-auth'
import { processPendingNotifications } from '@/lib/notification-service'
import { scheduledReminderSendAt } from '@/lib/notification-schedule'
import { processReminderPages } from '@/lib/reminder-pagination'
import { invalidateShopOverdueCron } from '@/lib/server/cache-tags'
import { tashkentDayRange } from '@/lib/timezone'
import { recordOpsEvent } from '@/lib/server/ops-events'
import { getUsdUzsRate } from '@/lib/server/currency'
import { contractScheduleOutstanding } from '@/lib/nasiya-contract'
import type { CurrencyCode, CurrencyContext } from '@/lib/currency'
import { cleanupExpiredChangeEvents } from '@/lib/server/change-events'
import { cleanupRetainedOperationalData } from '@/lib/server/data-retention'
import { hasValidNasiyaScheduleNativeLedger, transitionNasiyaToOverdue } from '@/lib/server/overdue-transition'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { initializeRequestAuditContext } from '@/lib/server/request-context'
import { activeShopIdsForFeature } from '@/lib/server/shop-access'
import {
  acquireReminderGenerationLease,
  checkpointReminderGeneration,
  completeReminderGeneration,
  releaseReminderGenerationLease,
  REMINDER_GENERATION_PHASES,
  type ReminderGenerationPhase,
} from '@/lib/server/reminder-generation-state'
import {
  nasiyaDueTodayMessage,
  nasiyaOverdueMessage,
  nasiyaEarlyReminderMessage,
  saleDueTodayMessage,
  saleOverdueMessage,
  saleEarlyReminderMessage,
  supplierPayableDueTodayMessage,
  supplierPayableOverdueMessage,
  supplierPayableEarlyReminderMessage,
} from '@/lib/telegram-templates'

export const maxDuration = 60

// Reserve enough of the function's 60-second budget for bounded queue delivery,
// telemetry, and cleanup after generation yields at a page boundary.
const REMINDER_GENERATION_BUDGET_MS = 40_000
const DAY_MS = 86_400_000

let usdUzsRateForRun: Promise<number | null> | null = null

function getUsdUzsRateForRun() {
  usdUzsRateForRun ??= getUsdUzsRate().catch(() => null)
  return usdUzsRateForRun
}

async function reminderCurrency(shop: { preferredCurrency: CurrencyCode }): Promise<CurrencyContext> {
  return { currency: shop.preferredCurrency, usdUzsRate: await getUsdUzsRateForRun() }
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS)
}

function earlyTriggerDay(dueDate: Date, earlyReminderDays: number | null): Date | null {
  if (!earlyReminderDays || earlyReminderDays <= 0) return null
  return addDays(tashkentDayRange(dueDate).start, -earlyReminderDays)
}

function isWithin(value: Date, start: Date, end: Date): boolean {
  return value >= start && value < end
}

function pageAfter(cursor: string | null): { cursor?: { id: string }; skip?: number } {
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {}
}

type GenerationStatus = 'busy' | 'running' | 'partial' | 'complete'

export async function GET(request: NextRequest): Promise<Response> {
  await initializeRequestAuditContext(request.headers)
  if (!internalSecret()) {
    return new Response('Internal secret is not configured', { status: 503 })
  }

  if (!hasValidInternalSecret(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const startedAt = Date.now()
  usdUzsRateForRun = null
  let activeLeaseToken: string | null = null
  await recordOpsEvent({ level: 'INFO', event: 'cron.reminders.started', message: 'Reminders cron started' })

  try {
    const { start: today, end: tomorrow, dayKey } = tashkentDayRange(new Date(Date.now()))
    const reminderEnabledShopIds = await activeShopIdsForFeature('REMINDERS')
    const acquired = await acquireReminderGenerationLease(today, tomorrow)
    let generationStatus: GenerationStatus = acquired.acquired ? 'running' : 'busy'
    let activePhase: ReminderGenerationPhase | null = acquired.acquired ? acquired.state.phase : null
    let activeCursor = acquired.acquired ? acquired.state.cursor : null
    let generationRowsProcessed = 0
    const generationWindow = acquired.acquired
      ? { start: acquired.state.windowStart, end: acquired.state.windowEnd }
      : null
    if (acquired.acquired) activeLeaseToken = acquired.state.leaseToken

    const summary = {
      reminders: 0,
      overdue: 0,
      saleReminders: 0,
      saleOverdue: 0,
      earlyReminders: 0,
      saleEarlyReminders: 0,
      supplierPayableReminders: 0,
      supplierPayableOverdue: 0,
      supplierPayableEarlyReminders: 0,
      invalidNasiyaSchedulesSkipped: 0,
    }
    const transitionedShopIds = new Set<string>()

    async function runPhase<T extends { id: string }>(
      phase: ReminderGenerationPhase,
      fetchPage: (cursor: string | null, take: number) => Promise<T[]>,
      processRow: (row: T) => Promise<void>,
    ): Promise<void> {
      if (!acquired.acquired || generationStatus !== 'running' || !activePhase) return

      const targetIndex = REMINDER_GENERATION_PHASES.indexOf(phase)
      const activeIndex = REMINDER_GENERATION_PHASES.indexOf(activePhase)
      if (targetIndex < activeIndex) return
      if (targetIndex > activeIndex) throw new Error(`REMINDER_GENERATION_PHASE_GAP:${activePhase}:${phase}`)

      const result = await processReminderPages({
        initialCursor: activeCursor,
        fetchPage,
        processRow,
        checkpoint: (cursor) => checkpointReminderGeneration(acquired.state.leaseToken, phase, cursor),
        hasTime: () => Date.now() - startedAt < REMINDER_GENERATION_BUDGET_MS,
      })
      generationRowsProcessed += result.processed
      activeCursor = result.cursor

      if (!result.complete) {
        generationStatus = 'partial'
        return
      }

      const nextPhase = REMINDER_GENERATION_PHASES[targetIndex + 1]
      if (nextPhase) {
        await checkpointReminderGeneration(acquired.state.leaseToken, nextPhase, null)
        activePhase = nextPhase
        activeCursor = null
        return
      }

      await completeReminderGeneration(acquired.state)
      activeLeaseToken = null
      // A resumed stale window can finish successfully without having covered
      // the current day yet. Keep the run non-green so an operator/external
      // scheduler invokes us again; the next lease opens the following window.
      generationStatus = acquired.state.windowEnd >= tomorrow ? 'complete' : 'partial'
      activePhase = null
      activeCursor = null
    }

    if (acquired.acquired) {
      const { windowStart, windowEnd } = acquired.state
      const earlyWindowEnd = addDays(windowEnd, 61)

      await runPhase(
        'NASIYA_DUE',
        (cursor, take) => prisma.nasiyaSchedule.findMany({
          where: {
            OR: [
              { delayedUntil: null, dueDate: { gte: windowStart, lt: windowEnd } },
              { delayedUntil: { gte: windowStart, lt: windowEnd } },
            ],
            status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] },
            nasiya: {
              resolutionState: 'ACTIVE',
              deletedAt: null,
              returnedAt: null,
              status: { in: ['ACTIVE', 'OVERDUE'] },
              reminderEnabled: true,
              shop: { status: 'ACTIVE', deletedAt: null },
            },
          },
          include: {
            nasiya: {
              include: {
                customer: true,
                device: { include: { imeis: { where: { deletedAt: null } } } },
                shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
              },
            },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (schedule) => {
          if (!reminderEnabledShopIds.has(schedule.nasiya.shopId)) return
          summary.reminders++
          const { nasiya } = schedule
          const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
          const triggerDay = tashkentDayRange(effectiveDue)
          const msg = nasiyaDueTodayMessage({
            customerName: nasiya.customer.name,
            customerPhone: nasiya.customer.phone,
            device: presentDeviceSpecs(nasiya.device),
            month: schedule.monthNumber,
            amountDue: contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), nasiya.contractCurrency),
            contractCurrency: nasiya.contractCurrency,
            dueDate: effectiveDue,
            currency: await reminderCurrency(nasiya.shop),
          })
          for (const admin of nasiya.shop.admins) {
            const dedupeKey = `REMINDER:${triggerDay.dayKey}:${admin.telegramId}:${schedule.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: nasiya.shopId,
                type: 'REMINDER',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, effectiveDue),
                relatedId: schedule.id,
                relatedType: 'NasiyaSchedule',
              },
            })
          }
        },
      )

      await runPhase(
        'NASIYA_OVERDUE',
        (cursor, take) => prisma.nasiyaSchedule.findMany({
          where: {
            OR: [
              { delayedUntil: null, dueDate: { lt: today } },
              { delayedUntil: { lt: today } },
            ],
            status: { in: ['PENDING', 'PARTIAL', 'DEFERRED', 'OVERDUE'] },
            nasiya: {
              resolutionState: 'ACTIVE',
              deletedAt: null,
              returnedAt: null,
              status: { in: ['ACTIVE', 'OVERDUE'] },
              shop: { status: 'ACTIVE', deletedAt: null },
            },
          },
          include: {
            nasiya: {
              include: {
                customer: true,
                device: { include: { imeis: { where: { deletedAt: null } } } },
                shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
              },
            },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (schedule) => {
          // This is a quarantine, not a financial repair. Updating an
          // invalid legacy row would make PostgreSQL reject the whole cron
          // transaction, preventing valid shops from receiving reminders.
          if (!hasValidNasiyaScheduleNativeLedger(schedule)) {
            summary.invalidNasiyaSchedulesSkipped++
            return
          }
          summary.overdue++
          const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
          const daysLate = Math.floor((today.getTime() - effectiveDue.getTime()) / DAY_MS)
          const notifications: Array<{
            dedupeKey: string
            message: string
            telegramId: string
            recipientShopAdminId: string
            scheduledAt: Date
          }> = []
          if (schedule.nasiya.reminderEnabled && reminderEnabledShopIds.has(schedule.nasiya.shopId)) {
            const msg = nasiyaOverdueMessage({
              customerName: schedule.nasiya.customer.name,
              customerPhone: schedule.nasiya.customer.phone,
              device: presentDeviceSpecs(schedule.nasiya.device),
              month: schedule.monthNumber,
              amountDue: contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), schedule.nasiya.contractCurrency),
              contractCurrency: schedule.nasiya.contractCurrency,
              dueDate: effectiveDue,
              daysLate,
              currency: await reminderCurrency(schedule.nasiya.shop),
            })
            notifications.push(...schedule.nasiya.shop.admins.map((admin) => {
              const dedupeKey = `OVERDUE:${dayKey}:${admin.telegramId}:${schedule.id}`
              return {
                dedupeKey,
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, today),
              }
            }))
          }
          const transitioned = await transitionNasiyaToOverdue({
            scheduleId: schedule.id,
            nasiyaId: schedule.nasiya.id,
            shopId: schedule.nasiya.shopId,
            overdueBefore: today,
            notifications,
          })
          if (transitioned) transitionedShopIds.add(schedule.nasiya.shopId)
        },
      )

      await runPhase(
        'NASIYA_EARLY',
        (cursor, take) => prisma.nasiyaSchedule.findMany({
          where: {
            OR: [
              { delayedUntil: null, dueDate: { gte: tomorrow, lt: earlyWindowEnd } },
              { delayedUntil: { gte: tomorrow, lt: earlyWindowEnd } },
            ],
            status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] },
            nasiya: {
              resolutionState: 'ACTIVE',
              deletedAt: null,
              returnedAt: null,
              status: { in: ['ACTIVE', 'OVERDUE'] },
              reminderEnabled: true,
              earlyReminderEnabled: true,
              shop: { status: 'ACTIVE', deletedAt: null },
            },
          },
          include: {
            nasiya: {
              include: {
                customer: true,
                device: { include: { imeis: { where: { deletedAt: null } } } },
                shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
              },
            },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (schedule) => {
          const { nasiya } = schedule
          if (!reminderEnabledShopIds.has(nasiya.shopId)) return
          const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
          const triggerDay = earlyTriggerDay(effectiveDue, nasiya.earlyReminderDays)
          if (!triggerDay || !isWithin(triggerDay, windowStart, windowEnd)) return
          summary.earlyReminders++
          const triggerKey = tashkentDayRange(triggerDay).dayKey
          const msg = nasiyaEarlyReminderMessage({
            customerName: nasiya.customer.name,
            customerPhone: nasiya.customer.phone,
            device: presentDeviceSpecs(nasiya.device),
            month: schedule.monthNumber,
            amountDue: contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), nasiya.contractCurrency),
            contractCurrency: nasiya.contractCurrency,
            dueDate: effectiveDue,
            daysLeft: nasiya.earlyReminderDays!,
            currency: await reminderCurrency(nasiya.shop),
          })
          for (const admin of nasiya.shop.admins) {
            const dedupeKey = `EARLY_REMINDER:${triggerKey}:${admin.telegramId}:${schedule.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: nasiya.shopId,
                type: 'EARLY_REMINDER',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, triggerDay),
                relatedId: schedule.id,
                relatedType: 'NasiyaSchedule',
              },
            })
          }
        },
      )

      await runPhase(
        'SALE_DUE',
        (cursor, take) => prisma.sale.findMany({
          where: {
            deletedAt: null,
            returnedAt: null,
            paidFully: false,
            remainingAmount: { gt: 0 },
            reminderEnabled: true,
            dueDate: { gte: windowStart, lt: windowEnd },
            shop: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            customer: true,
            device: { include: { imeis: { where: { deletedAt: null } } } },
            shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (sale) => {
          if (!sale.dueDate) return
          if (!reminderEnabledShopIds.has(sale.shopId)) return
          summary.saleReminders++
          const triggerDay = tashkentDayRange(sale.dueDate)
          const msg = saleDueTodayMessage({
            customerName: sale.customer.name,
            customerPhone: sale.customer.phone,
            device: presentDeviceSpecs(sale.device),
            remainingAmount: Number(sale.contractRemainingAmount),
            contractCurrency: sale.contractCurrency,
            dueDate: sale.dueDate,
            currency: await reminderCurrency(sale.shop),
          })
          for (const admin of sale.shop.admins) {
            const dedupeKey = `SALE_REMINDER:${triggerDay.dayKey}:${admin.telegramId}:${sale.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: sale.shopId,
                type: 'SALE_REMINDER',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, sale.dueDate),
                relatedId: sale.id,
                relatedType: 'Sale',
              },
            })
          }
        },
      )

      await runPhase(
        'SALE_OVERDUE',
        (cursor, take) => prisma.sale.findMany({
          where: {
            deletedAt: null,
            returnedAt: null,
            paidFully: false,
            remainingAmount: { gt: 0 },
            reminderEnabled: true,
            dueDate: { lt: today },
            shop: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            customer: true,
            device: { include: { imeis: { where: { deletedAt: null } } } },
            shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (sale) => {
          if (!sale.dueDate) return
          if (!reminderEnabledShopIds.has(sale.shopId)) return
          summary.saleOverdue++
          const daysLate = Math.floor((today.getTime() - sale.dueDate.getTime()) / DAY_MS)
          const msg = saleOverdueMessage({
            customerName: sale.customer.name,
            customerPhone: sale.customer.phone,
            device: presentDeviceSpecs(sale.device),
            remainingAmount: Number(sale.contractRemainingAmount),
            contractCurrency: sale.contractCurrency,
            dueDate: sale.dueDate,
            daysLate,
            currency: await reminderCurrency(sale.shop),
          })
          for (const admin of sale.shop.admins) {
            const dedupeKey = `SALE_OVERDUE:${dayKey}:${admin.telegramId}:${sale.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: sale.shopId,
                type: 'SALE_OVERDUE',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, today),
                relatedId: sale.id,
                relatedType: 'Sale',
              },
            })
          }
        },
      )

      await runPhase(
        'SALE_EARLY',
        (cursor, take) => prisma.sale.findMany({
          where: {
            deletedAt: null,
            returnedAt: null,
            paidFully: false,
            remainingAmount: { gt: 0 },
            reminderEnabled: true,
            earlyReminderEnabled: true,
            dueDate: { gte: tomorrow, lt: earlyWindowEnd },
            shop: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            customer: true,
            device: { include: { imeis: { where: { deletedAt: null } } } },
            shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (sale) => {
          if (!sale.dueDate) return
          if (!reminderEnabledShopIds.has(sale.shopId)) return
          const triggerDay = earlyTriggerDay(sale.dueDate, sale.earlyReminderDays)
          if (!triggerDay || !isWithin(triggerDay, windowStart, windowEnd)) return
          summary.saleEarlyReminders++
          const triggerKey = tashkentDayRange(triggerDay).dayKey
          const msg = saleEarlyReminderMessage({
            customerName: sale.customer.name,
            customerPhone: sale.customer.phone,
            device: presentDeviceSpecs(sale.device),
            remainingAmount: Number(sale.contractRemainingAmount),
            contractCurrency: sale.contractCurrency,
            dueDate: sale.dueDate,
            daysLeft: sale.earlyReminderDays!,
            currency: await reminderCurrency(sale.shop),
          })
          for (const admin of sale.shop.admins) {
            const dedupeKey = `SALE_EARLY_REMINDER:${triggerKey}:${admin.telegramId}:${sale.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: sale.shopId,
                type: 'SALE_EARLY_REMINDER',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, triggerDay),
                relatedId: sale.id,
                relatedType: 'Sale',
              },
            })
          }
        },
      )

      await runPhase(
        'SUPPLIER_DUE',
        (cursor, take) => prisma.supplierPayable.findMany({
          where: {
            deletedAt: null,
            status: 'PENDING',
            reminderEnabled: true,
            dueDate: { gte: windowStart, lt: windowEnd },
            shop: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            device: { include: { imeis: { where: { deletedAt: null } } } },
            shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (payable) => {
          if (!reminderEnabledShopIds.has(payable.shopId)) return
          summary.supplierPayableReminders++
          const triggerDay = tashkentDayRange(payable.dueDate)
          const msg = supplierPayableDueTodayMessage({
            device: presentDeviceSpecs(payable.device),
            supplierName: payable.supplierName,
            supplierPhone: payable.supplierPhone,
            amount: Number(payable.contractAmount),
            contractCurrency: payable.contractCurrency,
            dueDate: payable.dueDate,
            currency: await reminderCurrency(payable.shop),
          })
          for (const admin of payable.shop.admins) {
            const dedupeKey = `SUPPLIER_PAYABLE_REMINDER:${triggerDay.dayKey}:${admin.telegramId}:${payable.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: payable.shopId,
                type: 'SUPPLIER_PAYABLE_REMINDER',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, payable.dueDate),
                relatedId: payable.id,
                relatedType: 'SupplierPayable',
              },
            })
          }
        },
      )

      await runPhase(
        'SUPPLIER_OVERDUE',
        (cursor, take) => prisma.supplierPayable.findMany({
          where: {
            deletedAt: null,
            status: { in: ['PENDING', 'OVERDUE'] },
            reminderEnabled: true,
            dueDate: { lt: today },
            shop: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            device: { include: { imeis: { where: { deletedAt: null } } } },
            shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (payable) => {
          if (reminderEnabledShopIds.has(payable.shopId)) {
            summary.supplierPayableOverdue++
            const daysLate = Math.floor((today.getTime() - payable.dueDate.getTime()) / DAY_MS)
            const msg = supplierPayableOverdueMessage({
              device: presentDeviceSpecs(payable.device),
              supplierName: payable.supplierName,
              supplierPhone: payable.supplierPhone,
              amount: Number(payable.contractAmount),
              contractCurrency: payable.contractCurrency,
              dueDate: payable.dueDate,
              daysLate,
              currency: await reminderCurrency(payable.shop),
            })
            for (const admin of payable.shop.admins) {
              const dedupeKey = `SUPPLIER_PAYABLE_OVERDUE:${dayKey}:${admin.telegramId}:${payable.id}`
              await prisma.notification.upsert({
                where: { dedupeKey },
                update: {},
                create: {
                  dedupeKey,
                  shopId: payable.shopId,
                  type: 'SUPPLIER_PAYABLE_OVERDUE',
                  message: msg,
                  telegramId: admin.telegramId!,
                  recipientShopAdminId: admin.id,
                  scheduledAt: scheduledReminderSendAt(dedupeKey, today),
                  relatedId: payable.id,
                  relatedType: 'SupplierPayable',
                },
              })
            }
          }
          if (payable.status !== 'OVERDUE') {
            await prisma.$transaction(async (tx) => {
              const changed = await tx.supplierPayable.updateMany({
                where: { id: payable.id, status: 'PENDING' },
                data: { status: 'OVERDUE' },
              })
              if (changed.count > 0) {
                await tx.changeEvent.create({
                  data: {
                    scopeType: 'SHOP',
                    scopeId: payable.shopId,
                    domain: 'olibSotdim',
                    entityType: 'SupplierPayable',
                    entityId: payable.id,
                    operation: 'updated',
                    mutationKind: 'supplierPayable.overdue',
                  },
                })
              }
            })
          }
        },
      )

      await runPhase(
        'SUPPLIER_EARLY',
        (cursor, take) => prisma.supplierPayable.findMany({
          where: {
            deletedAt: null,
            status: 'PENDING',
            reminderEnabled: true,
            earlyReminderEnabled: true,
            dueDate: { gte: tomorrow, lt: earlyWindowEnd },
            shop: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            device: { include: { imeis: { where: { deletedAt: null } } } },
            shop: { include: { admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null }, telegramNotificationsEnabled: true } } } },
          },
          orderBy: { id: 'asc' },
          take,
          ...pageAfter(cursor),
        }),
        async (payable) => {
          const triggerDay = earlyTriggerDay(payable.dueDate, payable.earlyReminderDays)
          if (!triggerDay || !isWithin(triggerDay, windowStart, windowEnd)) return
          if (!reminderEnabledShopIds.has(payable.shopId)) return
          summary.supplierPayableEarlyReminders++
          const triggerKey = tashkentDayRange(triggerDay).dayKey
          const msg = supplierPayableEarlyReminderMessage({
            device: presentDeviceSpecs(payable.device),
            supplierName: payable.supplierName,
            supplierPhone: payable.supplierPhone,
            amount: Number(payable.contractAmount),
            contractCurrency: payable.contractCurrency,
            dueDate: payable.dueDate,
            daysLeft: payable.earlyReminderDays!,
            currency: await reminderCurrency(payable.shop),
          })
          for (const admin of payable.shop.admins) {
            const dedupeKey = `SUPPLIER_PAYABLE_EARLY_REMINDER:${triggerKey}:${admin.telegramId}:${payable.id}`
            await prisma.notification.upsert({
              where: { dedupeKey },
              update: {},
              create: {
                dedupeKey,
                shopId: payable.shopId,
                type: 'SUPPLIER_PAYABLE_EARLY_REMINDER',
                message: msg,
                telegramId: admin.telegramId!,
                recipientShopAdminId: admin.id,
                scheduledAt: scheduledReminderSendAt(dedupeKey, triggerDay),
                relatedId: payable.id,
                relatedType: 'SupplierPayable',
              },
            })
          }
        },
      )
    }

    if (activeLeaseToken) {
      await releaseReminderGenerationLease(activeLeaseToken)
      activeLeaseToken = null
    }

    for (const overdueShopId of transitionedShopIds) {
      invalidateShopOverdueCron(overdueShopId)
    }

    const delivery = await processPendingNotifications()
    const [expiredChanges, retainedData] = await Promise.all([
      cleanupExpiredChangeEvents(),
      cleanupRetainedOperationalData(),
    ])
    // `runPhase` mutates this captured state; TypeScript's control-flow
    // analysis intentionally does not infer closure side effects.
    const generationOk = (generationStatus as GenerationStatus) === 'complete'
    const runOk = generationOk && delivery.ok
    const responseStatus = delivery.crashed ? 500 : runOk ? 200 : 503

    await recordOpsEvent({
      level: runOk ? 'INFO' : 'WARN',
      event: 'cron.reminders.completed',
      message: 'Reminders cron completed',
      status: runOk ? 'ok' : delivery.crashed ? 'error' : 'partial',
      metadata: {
        ...summary,
        generationStatus,
        generationPhase: activePhase,
        generationCursor: activeCursor,
        generationWindowStart: generationWindow?.start.toISOString() ?? null,
        generationWindowEnd: generationWindow?.end.toISOString() ?? null,
        generationRowsProcessed,
        notificationsAttempted: delivery.attempted,
        notificationsSent: delivery.sent,
        notificationsSentWithImage: delivery.sentWithImage,
        notificationsFailed: delivery.failed,
        notificationsCancelled: delivery.cancelled,
        notificationsRemainingDue: delivery.remainingDue,
        notificationsRetryScheduled: delivery.retryScheduled,
        notificationsProcessing: delivery.processing,
        notificationRunCrashed: delivery.crashed,
        overdueTransitions: transitionedShopIds.size,
        expiredChangeEventsDeleted: expiredChanges.count,
        retainedNotificationsDeleted: retainedData.notifications,
        retainedOpsEventsDeleted: retainedData.opsEvents,
        retainedAuthSessionsDeleted: retainedData.authSessions,
        retainedBusinessAuditLogsDeleted: retainedData.businessAuditLogs,
        durationMs: Date.now() - startedAt,
      },
    })

    return Response.json(
      {
        ...summary,
        reminderGeneration: {
          status: generationStatus,
          phase: activePhase,
          cursor: activeCursor,
          windowStart: generationWindow?.start.toISOString() ?? null,
          windowEnd: generationWindow?.end.toISOString() ?? null,
          rowsProcessed: generationRowsProcessed,
        },
        notificationDelivery: delivery,
        maintenance: {
          expiredChangeEventsDeleted: expiredChanges.count,
          retainedDataDeleted: retainedData,
        },
      },
      { status: responseStatus },
    )
  } catch (error) {
    if (activeLeaseToken) {
      await releaseReminderGenerationLease(activeLeaseToken).catch(() => undefined)
    }
    await recordOpsEvent({
      level: 'ERROR',
      event: 'cron.reminders.failed',
      message: 'Reminders cron failed',
      status: 'error',
      metadata: { error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt },
    })
    return new Response('Cron failed', { status: 500 })
  }
}
