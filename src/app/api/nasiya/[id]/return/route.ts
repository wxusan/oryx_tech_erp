import { NextRequest, after } from 'next/server'
import { z, type ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, conflict, forbidden, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import {
  getLiveShopPrincipalForMutation,
  principalHasFeature,
  principalHasPermission,
} from '@/lib/server/shop-access'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { createMoneyDto, moneyDtoToAmount, normalizeMoneyInput, type CurrencyCode } from '@/lib/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import { reconcileNasiyaLedger } from '@/lib/nasiya-ledger'
import {
  calculateNasiyaReturnQuote,
  nasiyaReturnLedgerHasBlockingReasons,
  type NasiyaReturnRecordDto,
} from '@/lib/nasiya-return'
import {
  allocateReturnRefund,
  type ReturnReceiptSource,
} from '@/lib/return-accounting'
import { invalidateShopReturnMutation } from '@/lib/server/cache-tags'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import {
  resolveTelegramRecipientsTransactionSafe as resolveTelegramRecipients,
  telegramNotificationRows,
  telegramUnavailableMarkerRows,
  TELEGRAM_AUDIENCES,
} from '@/lib/server/telegram-recipients'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { nasiyaReturnedMessage } from '@/lib/telegram-templates'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { recordRequestTiming } from '@/lib/server/request-context'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

const MAX_RETURN_PAYMENTS = 500
const MAX_RETURN_SCHEDULES = 60
const MAX_RETURN_ALLOCATIONS = 1000

const returnNasiyaSchema = z.object({
  shopId: z.string().optional(),
  note: z.string({ error: 'Qaytarish sababi kiritilishi shart' })
    .trim()
    .min(5, "Qaytarish sababi kamida 5 ta belgidan iborat bo‘lishi kerak")
    .max(1000, "Qaytarish sababi 1000 belgidan oshmasligi kerak"),
  refundAmount: z.number().finite().min(0, "Qaytariladigan summa manfiy bo‘lmasligi kerak"),
  refundMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']).optional(),
  inputCurrency: z.enum(['UZS', 'USD']),
  expectedReceiptsMinorUnits: z.number().int().nonnegative(),
  expectedRemainingMinorUnits: z.number().int().nonnegative(),
}).refine((data) => data.refundAmount === 0 || data.refundMethod !== undefined, {
  message: "Pul qaytarilsa, qaytarish usuli tanlanishi shart",
  path: ['refundMethod'],
})

type ReturnPayment = {
  id: string
  paidAt: Date
  paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER' | null
  paymentBreakdown: Prisma.JsonValue | null
  amount: Prisma.Decimal
  paymentInputAmount: Prisma.Decimal | null
  paymentExchangeRate: Prisma.Decimal | null
  appliedAmountInContractCurrency: Prisma.Decimal | null
}

function paymentSource(payment: ReturnPayment): ReturnReceiptSource {
  return {
    id: payment.id,
    kind: 'NASIYA',
    paidAt: payment.paidAt,
    paymentMethod: payment.paymentMethod,
    paymentBreakdown: payment.paymentBreakdown,
    amountUzs: Number(payment.amount),
    paymentInputAmount: payment.paymentInputAmount === null ? null : Number(payment.paymentInputAmount),
    paymentExchangeRate: payment.paymentExchangeRate === null ? null : Number(payment.paymentExchangeRate),
    appliedContractAmount: payment.appliedAmountInContractCurrency === null
      ? null
      : Number(payment.appliedAmountInContractCurrency),
  }
}

function serializeReturn(record: {
  id: string
  createdAt: Date
  contractCurrency: CurrencyCode
  contractReceiptsAtReturn: Prisma.Decimal
  contractRefundAmount: Prisma.Decimal
  contractRetainedAmount: Prisma.Decimal
  contractCancelledDebt: Prisma.Decimal
  refundAmount: Prisma.Decimal
  retainedValueAmountUzs: Prisma.Decimal
  refundMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER' | null
  note: string
  createdBy: string
}): NasiyaReturnRecordDto {
  return {
    id: record.id,
    returnedAt: record.createdAt.toISOString(),
    contractCurrency: record.contractCurrency,
    receipts: createMoneyDto(record.contractCurrency, record.contractReceiptsAtReturn.toString()),
    refund: createMoneyDto(record.contractCurrency, record.contractRefundAmount.toString()),
    retained: createMoneyDto(record.contractCurrency, record.contractRetainedAmount.toString()),
    cancelledDebt: createMoneyDto(record.contractCurrency, record.contractCancelledDebt.toString()),
    refundUzs: createMoneyDto('UZS', record.refundAmount.toString()),
    retainedUzs: createMoneyDto('UZS', record.retainedValueAmountUzs.toString()),
    refundMethod: record.refundMethod,
    reason: record.note,
    actorId: record.createdBy,
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const startedAt = performance.now()
  try {
    const guarded = await requireShopPermissionAndFeature('NASIYA_RETURN_REFUND', 'NASIYA')
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { id: nasiyaId } = await ctx.params

    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo‘lishi shart")
    }

    const body: unknown = await req.json()
    const parsed = returnNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest((parsed.error as ZodError).issues[0]?.message ?? "Noto‘g‘ri ma’lumot")
    }
    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const rate = await checkRateLimitDistributed(
      rateLimitKey('nasiya-return', shopId, session.user.id),
      { windowMs: 60_000, max: 12 },
    )
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currencyContext = await getShopCurrencyContext(shopId)
    const liveUsdUzsRate = currencyContext.usdUzsRate

    const run = () => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
      if (session.user.role === 'SHOP_ADMIN') {
        const livePrincipal = await getLiveShopPrincipalForMutation(tx, { shopId, actorId: session.user.id })
        const allowed = livePrincipal &&
          principalHasFeature(livePrincipal, 'NASIYA') &&
          principalHasPermission(livePrincipal, 'NASIYA_RETURN_REFUND')
        if (!allowed) throw { status: 403, message: "Bu nasiyani qaytarish uchun ruxsat berilmagan" }
      }

      const replay = await tx.deviceReturn.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
      })
      if (replay) {
        const samePayload = replay.nasiyaId === nasiyaId &&
          replay.createdBy === session.user.id &&
          Number(replay.refundInputAmount ?? replay.contractRefundAmount) === parsed.data.refundAmount &&
          (replay.refundInputCurrency ?? replay.contractCurrency) === parsed.data.inputCurrency &&
          (replay.refundMethod ?? undefined) === parsed.data.refundMethod &&
          replay.note === parsed.data.note
        if (!samePayload) {
          throw { status: 409, message: "Idempotency-Key boshqa qaytarish amali uchun ishlatilgan" }
        }
        return {
          duplicate: true,
          deviceId: replay.deviceId,
          returnRecord: serializeReturn(replay),
        }
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Nasiya"
        WHERE "id" = ${nasiyaId} AND "shopId" = ${shopId}
        FOR UPDATE
      `)
      const nasiya = await tx.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null },
      })
      if (!nasiya || nasiya.returnedAt || nasiya.status === 'CANCELLED') {
        throw { status: 404, message: 'Nasiya topilmadi' }
      }
      if (nasiya.months > MAX_RETURN_SCHEDULES) {
        throw { status: 409, message: "Nasiya jadvali tasdiqlangan chegaradan oshgan; avval tekshiruv kerak" }
      }

      const device = await tx.device.findFirst({
        where: { id: nasiya.deviceId, shopId, deletedAt: null },
        include: { imeis: { where: { deletedAt: null } } },
      })
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true } })
      const customer = await tx.customer.findFirst({
        where: { id: nasiya.customerId, shopId, deletedAt: null },
        select: { name: true, phone: true },
      })
      if (!device || !shop || !customer) {
        throw { status: 409, message: "Nasiya, mijoz yoki qurilma yozuvi to‘liq emas" }
      }

      const schedules = await tx.nasiyaSchedule.findMany({
        where: { nasiyaId, shopId },
        orderBy: { monthNumber: 'asc' },
        take: MAX_RETURN_SCHEDULES + 1,
      })
      if (schedules.length > MAX_RETURN_SCHEDULES) {
        throw { status: 409, message: "Nasiya jadvali tasdiqlangan chegaradan oshgan; avval tekshiruv kerak" }
      }
      const ledgerAllocations = await tx.nasiyaPaymentAllocation.findMany({
        where: { nasiyaId, shopId },
        orderBy: { id: 'asc' },
        take: MAX_RETURN_ALLOCATIONS + 1,
        select: { nasiyaScheduleId: true, contractCurrency: true, contractAmount: true },
      })
      if (ledgerAllocations.length > MAX_RETURN_ALLOCATIONS) {
        throw { status: 409, message: "Nasiya to‘lov ledgeri tasdiqlangan chegaradan oshgan; avval tekshiruv kerak" }
      }
      const payments = await tx.nasiyaPayment.findMany({
        where: { nasiyaId, shopId, deletedAt: null },
        orderBy: { paidAt: 'asc' },
        take: MAX_RETURN_PAYMENTS + 1,
        select: {
          id: true,
          paidAt: true,
          paymentMethod: true,
          paymentBreakdown: true,
          amount: true,
          paymentInputAmount: true,
          paymentExchangeRate: true,
          appliedAmountInContractCurrency: true,
        },
      })
      if (payments.length > MAX_RETURN_PAYMENTS) {
        throw { status: 409, message: "Nasiya tushumlari tasdiqlangan chegaradan oshgan; avval tekshiruv kerak" }
      }

      const ledger = reconcileNasiyaLedger({
        status: nasiya.status,
        contractCurrency: nasiya.contractCurrency,
        contractFinalAmount: nasiya.contractFinalAmount.toString(),
        contractPaidAmount: nasiya.contractPaidAmount.toString(),
        contractInterestWaivedAmount: nasiya.contractInterestWaivedAmount.toString(),
        contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
        schedules: schedules.map((schedule) => ({
          id: schedule.id,
          status: schedule.status,
          dueDate: schedule.dueDate,
          delayedUntil: schedule.delayedUntil,
          expectedAmount: schedule.expectedAmount.toString(),
          paidAmount: schedule.paidAmount.toString(),
          contractCurrency: schedule.contractCurrency,
          contractExpectedAmount: schedule.contractExpectedAmount.toString(),
          contractPaidAmount: schedule.contractPaidAmount.toString(),
          contractInterestWaivedAmount: schedule.contractInterestWaivedAmount.toString(),
          contractRemainingAmount: schedule.contractRemainingAmount.toString(),
        })),
        allocationHistoryComplete: nasiya.accountingReconstructionStatus === 'COMPLETE',
        allocations: ledgerAllocations.map((allocation) => ({
          nasiyaScheduleId: allocation.nasiyaScheduleId,
          contractCurrency: allocation.contractCurrency,
          contractAmount: allocation.contractAmount.toString(),
        })),
      })
      if (nasiyaReturnLedgerHasBlockingReasons(ledger.reasons)) {
        throw { status: 409, message: "Nasiya hisob-kitobida tekshiruv talab qilinadigan tafovut bor" }
      }

      const sources = payments.map(paymentSource)
      const quote = calculateNasiyaReturnQuote({
        contractCurrency: nasiya.contractCurrency,
        contractDownPayment: Number(nasiya.contractDownPayment),
        cancelledDebt: moneyDtoToAmount(ledger.remaining),
        contractExchangeRateAtCreation: Number(nasiya.contractExchangeRateAtCreation ?? 0) || null,
        accountingReconstructionStatus: nasiya.accountingReconstructionStatus,
        resolutionState: nasiya.resolutionState,
        deviceStatus: device.status,
        sources,
      })
      if (!quote.eligible) {
        throw { status: 409, message: quote.ineligibilityReason ?? "Bu nasiyani qaytarib bo‘lmaydi" }
      }
      if (
        quote.receipts.minorUnits !== parsed.data.expectedReceiptsMinorUnits ||
        quote.cancelledDebt.minorUnits !== parsed.data.expectedRemainingMinorUnits
      ) {
        throw { status: 409, message: "To‘lov yoki qarz summasi o‘zgargan. Yangilangan hisobni ko‘rib, qayta tasdiqlang" }
      }
      if (parsed.data.inputCurrency !== nasiya.contractCurrency) {
        throw { status: 400, message: "Qaytariladigan summa nasiya shartnomasi valyutasida kiritilishi kerak" }
      }

      let refundMoney
      try {
        refundMoney = createMoneyDto(nasiya.contractCurrency, parsed.data.refundAmount)
      } catch (error) {
        throw { status: 400, message: error instanceof Error ? error.message : "Qaytariladigan summa noto‘g‘ri" }
      }
      if (refundMoney.minorUnits > quote.maxRefund.minorUnits) {
        throw { status: 400, message: "Qaytariladigan summa mijozdan amalda olingan summadan oshmasligi kerak" }
      }
      const contractRefundAmount = moneyDtoToAmount(refundMoney)
      if (contractRefundAmount > 0 && !parsed.data.refundMethod) {
        throw { status: 400, message: "Qaytarish usuli tanlanishi shart" }
      }
      const methodCapacity = quote.methodCapacities.find(({ method }) => method === parsed.data.refundMethod)?.available
      if (contractRefundAmount > 0 && (!methodCapacity || refundMoney.minorUnits > methodCapacity.minorUnits)) {
        throw { status: 400, message: "Tanlangan qaytarish usuli bo‘yicha tasdiqlangan tushum yetarli emas" }
      }
      if (contractRefundAmount > 0 && nasiya.contractCurrency === 'USD' && !liveUsdUzsRate) {
        throw { status: 400, message: "USD qaytarish uchun joriy USD/UZS kursi mavjud emas" }
      }

      const refundAmountUzs = contractRefundAmount > 0
        ? normalizeMoneyInput(contractRefundAmount, nasiya.contractCurrency, liveUsdUzsRate).amountUzs
        : 0
      const receiptsUzs = sources.reduce((sum, source) => sum + source.amountUzs, 0)
      if (refundAmountUzs > receiptsUzs) {
        throw { status: 400, message: "Joriy kurs bo‘yicha qaytariladigan UZS qiymati tasdiqlangan tushumdan oshadi" }
      }
      const allocations = contractRefundAmount > 0
        ? allocateReturnRefund({
            sources,
            contractCurrency: nasiya.contractCurrency,
            frozenUsdUzsRate: Number(nasiya.contractExchangeRateAtCreation ?? 0) || null,
            refundMethod: parsed.data.refundMethod!,
            refundContractAmount: contractRefundAmount,
            refundAmountUzs,
          })
        : []
      const sourceUzs = new Map(sources.map((source) => [source.id, source.amountUzs]))
      const allocatedUzs = new Map<string, number>()
      for (const allocation of allocations) {
        const paymentId = allocation.nasiyaPaymentId!
        allocatedUzs.set(paymentId, (allocatedUzs.get(paymentId) ?? 0) + allocation.amountUzs)
      }
      if ([...allocatedUzs].some(([paymentId, amount]) => amount > (sourceUzs.get(paymentId) ?? 0))) {
        throw { status: 400, message: "Joriy USD kursi bo‘yicha refund asl tushum yozuviga sig‘maydi; summani kamaytiring" }
      }

      const recognized = await tx.nasiyaPaymentAllocation.aggregate({
        where: { nasiyaId, shopId },
        _sum: { marginAmountUzs: true, interestAmountUzs: true },
      })
      const contractReceiptsAtReturn = moneyDtoToAmount(quote.receipts)
      const contractRetainedAmount = roundContractMoney(
        contractReceiptsAtReturn - contractRefundAmount,
        nasiya.contractCurrency,
      )
      const contractCancelledDebt = moneyDtoToAmount(quote.cancelledDebt)
      const now = new Date()

      const returnedDevice = await tx.device.updateMany({
        where: { id: device.id, shopId, deletedAt: null, status: 'SOLD_NASIYA' },
        data: { status: 'IN_STOCK', updatedAt: now },
      })
      if (returnedDevice.count !== 1) {
        throw { status: 409, message: "Qurilma holati bir vaqtda o‘zgargan. Sahifani yangilang" }
      }
      const returnedNasiya = await tx.nasiya.updateMany({
        where: { id: nasiyaId, shopId, deletedAt: null, returnedAt: null, status: { not: 'CANCELLED' } },
        data: {
          // A previously completed early settlement has its own deferred DB
          // invariant requiring COMPLETED. `returnedAt` is the authoritative
          // physical-return state in both cases; open contracts additionally
          // move to CANCELLED.
          status: nasiya.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
          returnedAt: now,
          returnedBy: session.user.id,
          reminderEnabled: false,
          earlyReminderEnabled: false,
        },
      })
      if (returnedNasiya.count !== 1) {
        throw { status: 409, message: "Nasiya bir vaqtda o‘zgargan. Sahifani yangilang" }
      }
      await tx.nasiyaSchedule.updateMany({
        where: {
          nasiyaId,
          shopId,
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'] },
        },
        data: { status: 'CANCELLED', note: `Qurilma qaytarildi: ${parsed.data.note}` },
      })

      const returnRecord = await tx.deviceReturn.create({
        data: {
          shopId,
          deviceId: device.id,
          nasiyaId,
          idempotencyKey,
          ledgerVersion: 2,
          refundAmount: refundAmountUzs,
          refundInputAmount: contractRefundAmount,
          refundInputCurrency: nasiya.contractCurrency,
          refundExchangeRateAtCreation: nasiya.contractCurrency === 'USD' ? liveUsdUzsRate : null,
          refundMethod: refundAmountUzs > 0 ? parsed.data.refundMethod : undefined,
          contractCurrency: nasiya.contractCurrency,
          contractAmount: Number(nasiya.contractDownPayment) + Number(nasiya.contractFinalAmount),
          contractReceiptsAtReturn,
          contractRefundAmount,
          contractRetainedAmount,
          contractCancelledDebt,
          revenueReversalAmountUzs: Number(nasiya.totalAmount),
          interestReversalAmountUzs: Number(recognized._sum.interestAmountUzs ?? 0),
          inventoryCostRecoveryUzs: Number(device.purchasePrice),
          retainedValueAmountUzs: receiptsUzs - refundAmountUzs,
          note: parsed.data.note,
          createdBy: session.user.id,
          createdAt: now,
        },
      })
      await tx.returnProfitReversal.create({
        data: {
          shopId,
          deviceReturnId: returnRecord.id,
          nasiyaId,
          recognizedMarginAmountUzs: Number(recognized._sum.marginAmountUzs ?? 0),
          recognizedInterestAmountUzs: Number(recognized._sum.interestAmountUzs ?? 0),
          createdAt: now,
        },
      })
      if (allocations.length > 0) {
        await tx.returnRefundAllocation.createMany({
          data: allocations.map((allocation) => ({ ...allocation, shopId, deviceReturnId: returnRecord.id })),
        })
      }

      await tx.notification.updateMany({
        where: {
          shopId,
          type: { in: ['REMINDER', 'OVERDUE', 'EARLY_REMINDER'] },
          status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
          OR: [
            { relatedType: 'Nasiya', relatedId: nasiyaId },
            { relatedType: 'NasiyaSchedule', relatedId: { in: schedules.map((schedule) => schedule.id) } },
          ],
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          nextAttemptAt: null,
          lastError: 'Cancelled: nasiya returned',
        },
      })

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'RETURN',
          targetType: 'Nasiya',
          targetId: nasiyaId,
          oldValue: {
            status: nasiya.status,
            deviceStatus: device.status,
            contractRemainingAmount: contractCancelledDebt,
          },
          newValue: {
            status: 'RETURNED',
            deviceStatus: 'IN_STOCK',
            returnId: returnRecord.id,
            contractCurrency: nasiya.contractCurrency,
            contractReceiptsAtReturn,
            contractRefundAmount,
            contractRetainedAmount,
            contractCancelledDebt,
            refundAmountUzs,
            refundMethod: parsed.data.refundMethod ?? null,
            allocationCount: allocations.length,
          },
          note: parsed.data.note,
        },
      })

      const recipients = await resolveTelegramRecipients(tx, {
        shopId,
        audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
      })
      const message = nasiyaReturnedMessage({
        shopName: shop.name,
        customerName: customer.name,
        customerPhone: customer.phone,
        device: presentDeviceSpecs(device),
        receipts: contractReceiptsAtReturn,
        refund: contractRefundAmount,
        retained: contractRetainedAmount,
        cancelledDebt: contractCancelledDebt,
        contractCurrency: nasiya.contractCurrency,
        refundMethod: parsed.data.refundMethod,
        reason: parsed.data.note,
        adminName: session.user.name,
        currency: currencyContext,
      })
      const notificationRows = [
        ...telegramNotificationRows(recipients, {
          type: 'RETURN',
          message,
          scheduledAt: now,
          relatedId: returnRecord.id,
          relatedType: 'DeviceReturn',
          dedupeKey: (recipient) => `NASIYA_RETURN:${returnRecord.id}:${recipient.id}`,
        }),
        ...telegramUnavailableMarkerRows(recipients, {
          type: 'RETURN',
          dedupeScope: `NASIYA_RETURN:${returnRecord.id}`,
          cancelledAt: now,
        }),
      ]
      if (notificationRows.length > 0) await tx.notification.createMany({ data: notificationRows })

      return {
        duplicate: false,
        deviceId: device.id,
        returnRecord: serializeReturn(returnRecord),
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof run>> | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await run()
        break
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 2) continue
        throw error
      }
    }
    if (!result) throw new Error('RETURN_TRANSACTION_RETRY_EXHAUSTED')

    invalidateShopReturnMutation(shopId)
    if (!result.duplicate) {
      after(() => flushQueuedTelegramWork().catch((error) => logger.warn('notification flush failed', {
        event: 'notification.flush_failed',
        error,
      })))
    }
    return ok({
      duplicate: result.duplicate,
      nasiyaId,
      deviceId: result.deviceId,
      deviceStatus: 'IN_STOCK' as const,
      status: 'RETURNED' as const,
      return: result.returnRecord,
    }, result.duplicate
      ? 'Nasiya qaytarishi avval muvaffaqiyatli saqlangan'
      : 'Nasiya qaytarildi, qurilma omborga olindi va qolgan qarz bekor qilindi')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const typed = error as { status: number; message: string }
      if (typed.status === 400) return badRequest(typed.message)
      if (typed.status === 403) return forbidden(typed.message)
      if (typed.status === 404) return notFound(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    if (error instanceof Error && (
      error.message.includes("asl to'lov") ||
      error.message.includes('Tanlangan usul') ||
      error.message.includes('saqlangan kursi')
    )) return badRequest(error.message)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict('Qaytarish amali avval saqlangan. Sahifani yangilang.')
    }
    if (error instanceof Error && error.message === 'RETURN_TRANSACTION_RETRY_EXHAUSTED') {
      return serverError("Qaytarishni yakunlab bo‘lmadi. Iltimos, qayta urinib ko‘ring.")
    }
    logger.error('[POST /api/nasiya/[id]/return]', { event: 'api.route_error', error })
    return serverError()
  } finally {
    recordRequestTiming('nasiya-return', performance.now() - startedAt)
  }
}
