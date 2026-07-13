import { NextRequest, after } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { invalidateShopReturnMutation } from '@/lib/server/cache-tags'
import { processPendingNotifications } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { deviceReturnedMessage } from '@/lib/telegram-templates'
import { getShopCurrencyContext, getUsdUzsRate } from '@/lib/server/currency'
import { normalizeMoneyInput, convertUzsToUsd, type CurrencyCode } from '@/lib/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import {
  allocateReturnRefund,
  resolveAppliedContractAmount,
  type ReturnReceiptSource,
} from '@/lib/return-accounting'
import { presentDeviceSpecs } from '@/lib/device-specs'

type RouteContext = { params: Promise<{ id: string }> }

const returnDeviceSchema = z.object({
  note: z.string({ error: 'Sabab kiritilishi shart' }).trim().min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak").max(1_000),
  refundAmount: z.number().finite().min(0, "Qaytarilgan summa manfiy bo'lmasligi kerak").optional().default(0),
  refundMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']).optional(),
  shopId: z.string().optional(),
  inputCurrency: z.enum(['UZS', 'USD']).optional(),
}).refine((data) => data.refundAmount <= 0 || data.refundMethod !== undefined, {
  message: "Pul qaytarilgan bo'lsa, qaytarish usuli tanlanishi shart",
  path: ['refundMethod'],
})

function paymentSource(
  kind: 'SALE' | 'NASIYA',
  payment: {
    id: string
    paidAt: Date
    paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER' | null
    paymentBreakdown: Prisma.JsonValue | null
    amount: Prisma.Decimal
    paymentInputAmount: Prisma.Decimal | null
    paymentExchangeRate: Prisma.Decimal | null
    appliedAmountInContractCurrency: Prisma.Decimal | null
  },
): ReturnReceiptSource {
  return {
    id: payment.id,
    kind,
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

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('RETURN_MANAGE')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }

    const body: unknown = await req.json()
    const parsed = returnDeviceSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // One rate snapshot is reused for settlement conversion and display. A
    // pure UZS return can still proceed if no USD rate exists.
    const [displayCurrency, liveUsdUzsRate] = await Promise.all([
      getShopCurrencyContext(shopId),
      parsed.data.refundAmount > 0 ? getUsdUzsRate().catch(() => null) : Promise.resolve(null),
    ])

    const runTransaction = () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const replay = await tx.deviceReturn.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
      })
      if (replay) {
        const samePayload = (
          replay.deviceId === deviceId &&
          Number(replay.refundInputAmount ?? replay.refundAmount) === parsed.data.refundAmount &&
          (replay.refundInputCurrency ?? 'UZS') === (parsed.data.inputCurrency ?? replay.contractCurrency) &&
          (replay.refundMethod ?? undefined) === parsed.data.refundMethod &&
          replay.note === parsed.data.note
        )
        if (!samePayload) {
          throw { status: 409, message: 'Idempotency-Key boshqa qaytarish ma\'lumoti uchun ishlatilgan' }
        }
        return {
          device: await tx.device.findFirst({ where: { id: deviceId, shopId } }),
          duplicate: true,
        }
      }

      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: {
          shop: { select: { name: true } },
          imeis: { where: { deletedAt: null } },
          sales: {
            where: { deletedAt: null, returnedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { payments: { where: { deletedAt: null }, orderBy: { paidAt: 'asc' } } },
          },
          nasiya: {
            where: { deletedAt: null, returnedAt: null, status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { payments: { where: { deletedAt: null }, orderBy: { paidAt: 'asc' } } },
          },
        },
      })
      if (!device) throw { status: 404, message: 'Qurilma topilmadi' }
      if (!['SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA'].includes(device.status)) {
        throw { status: 409, message: 'Faqat sotilgan qurilmani qaytarish mumkin' }
      }

      const sale = device.sales[0]
      const nasiya = device.nasiya[0]
      if ((sale ? 1 : 0) + (nasiya ? 1 : 0) !== 1) {
        throw { status: 409, message: 'Qurilmaning faol sotuv shartnomasi yagona emas. Avval ma\'lumotni tekshiring.' }
      }

      const contractCurrency: CurrencyCode = sale?.contractCurrency ?? nasiya!.contractCurrency
      const frozenRate = Number(sale?.contractExchangeRateAtCreation ?? nasiya?.contractExchangeRateAtCreation ?? 0) || null
      const settlementCurrency = parsed.data.inputCurrency ?? contractCurrency
      if (parsed.data.refundAmount > 0 && (settlementCurrency === 'USD' || contractCurrency === 'USD') && !liveUsdUzsRate) {
        throw { status: 400, message: 'USD kursi mavjud emas. Qaytarish summasini hozir hisoblab bo\'lmaydi.' }
      }

      let refundAmountUzs = 0
      let contractRefundAmount = 0
      if (parsed.data.refundAmount > 0) {
        const normalized = normalizeMoneyInput(parsed.data.refundAmount, settlementCurrency, liveUsdUzsRate)
        refundAmountUzs = normalized.amountUzs
        contractRefundAmount = settlementCurrency === contractCurrency
          ? roundContractMoney(parsed.data.refundAmount, contractCurrency)
          : contractCurrency === 'UZS'
            ? roundContractMoney(refundAmountUzs, 'UZS')
            : roundContractMoney(convertUzsToUsd(refundAmountUzs, liveUsdUzsRate!), 'USD')
      }

      const sources = sale
        ? sale.payments.map((payment) => paymentSource('SALE', payment))
        : nasiya!.payments.map((payment) => paymentSource('NASIYA', payment))
      const contractReceiptsAtReturn = roundContractMoney(
        sources.reduce(
          (sum, source) => sum + resolveAppliedContractAmount(source, contractCurrency, frozenRate),
          0,
        ),
        contractCurrency,
      )
      if (contractRefundAmount > contractReceiptsAtReturn) {
        throw { status: 400, message: 'Qaytariladigan summa mijozdan amalda olingan summadan oshmasligi kerak.' }
      }

      const allocations = contractRefundAmount > 0
        ? allocateReturnRefund({
            sources,
            contractCurrency,
            frozenUsdUzsRate: frozenRate,
            refundMethod: parsed.data.refundMethod!,
            refundContractAmount: contractRefundAmount,
            refundAmountUzs,
          })
        : []
      const contractRetainedAmount = roundContractMoney(
        contractReceiptsAtReturn - contractRefundAmount,
        contractCurrency,
      )
      const receiptsUzs = sources.reduce((sum, source) => sum + source.amountUzs, 0)
      const now = new Date()

      const guardedReturn = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: { in: ['SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA'] } },
        data: { status: 'IN_STOCK', updatedAt: now, note: parsed.data.note },
      })
      if (guardedReturn.count !== 1) {
        throw { status: 409, message: 'Qurilma qaytarish amali allaqachon bajarilgan' }
      }

      if (sale) {
        await tx.sale.update({
          where: { id: sale.id },
          data: { returnedAt: now, returnedBy: session.user.id },
        })
      }
      if (nasiya) {
        await tx.nasiya.update({
          where: { id: nasiya.id },
          data: { status: 'CANCELLED', returnedAt: now, returnedBy: session.user.id },
        })
        await tx.nasiyaSchedule.updateMany({
          where: { nasiyaId: nasiya.id, shopId, status: { not: 'PAID' } },
          data: { status: 'CANCELLED', note: `Qurilma qaytarildi: ${parsed.data.note}` },
        })
      }

      const returnRecord = await tx.deviceReturn.create({
        data: {
          shopId,
          deviceId,
          saleId: sale?.id,
          nasiyaId: nasiya?.id,
          idempotencyKey,
          ledgerVersion: 2,
          refundAmount: refundAmountUzs,
          refundInputAmount: parsed.data.refundAmount,
          refundInputCurrency: settlementCurrency,
          refundExchangeRateAtCreation: settlementCurrency === 'USD' || contractCurrency === 'USD' ? liveUsdUzsRate : null,
          refundMethod: refundAmountUzs > 0 ? parsed.data.refundMethod : undefined,
          contractCurrency,
          contractAmount: sale
            ? Number(sale.contractSalePrice)
            : Number(nasiya!.contractDownPayment) + Number(nasiya!.contractFinalAmount),
          contractReceiptsAtReturn,
          contractRefundAmount,
          contractRetainedAmount,
          contractCancelledDebt: Number(sale?.contractRemainingAmount ?? nasiya?.contractRemainingAmount ?? 0),
          revenueReversalAmountUzs: Number(sale?.salePrice ?? nasiya?.totalAmount ?? 0),
          interestReversalAmountUzs: Number(nasiya?.interestAmount ?? 0),
          inventoryCostRecoveryUzs: Number(device.purchasePrice),
          retainedValueAmountUzs: Math.max(0, receiptsUzs - refundAmountUzs),
          note: parsed.data.note,
          createdBy: session.user.id,
        },
      })

      if (allocations.length > 0) {
        await tx.returnRefundAllocation.createMany({
          data: allocations.map((allocation) => ({ ...allocation, shopId, deviceReturnId: returnRecord.id })),
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'RETURN',
          targetType: 'Device',
          targetId: deviceId,
          oldValue: { status: device.status, saleId: sale?.id, nasiyaId: nasiya?.id },
          newValue: {
            status: 'IN_STOCK',
            returnId: returnRecord.id,
            refundAmountUzs,
            refundInputAmount: parsed.data.refundAmount,
            refundInputCurrency: settlementCurrency,
            contractCurrency,
            contractReceiptsAtReturn,
            contractRefundAmount,
            contractRetainedAmount,
            contractCancelledDebt: Number(sale?.contractRemainingAmount ?? nasiya?.contractRemainingAmount ?? 0),
            refundMethod: parsed.data.refundMethod,
            allocationCount: allocations.length,
          },
          note: parsed.data.note,
        },
      })

      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
        select: { telegramId: true },
      })
      if (shopAdmins.length > 0) {
        const message = deviceReturnedMessage({
          shopName: device.shop.name,
          device: presentDeviceSpecs(device),
          refundAmount: refundAmountUzs,
          refundMethod: parsed.data.refundMethod,
          note: parsed.data.note,
          adminName: session.user.name,
          currency: displayCurrency,
        })
        await tx.notification.createMany({
          data: shopAdmins.map((admin) => ({
            shopId,
            type: 'RETURN',
            message,
            telegramId: admin.telegramId!,
            scheduledAt: now,
            relatedId: returnRecord.id,
            relatedType: 'DeviceReturn',
          })),
        })
      }

      return {
        device: await tx.device.findFirst({ where: { id: deviceId, shopId } }),
        duplicate: false,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof runTransaction>> | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runTransaction()
        break
      } catch (err) {
        if (isRetryableTransactionError(err) && attempt < 2) continue
        throw err
      }
    }
    if (!result) throw new Error('RETURN_TRANSACTION_RETRY_EXHAUSTED')

    invalidateShopReturnMutation(shopId)
    if (!result.duplicate) {
      after(() => processPendingNotifications().catch((error) => logger.warn('notification flush failed', {
        event: 'notification.flush_failed',
        error,
      })))
    }

    return ok(
      result.device,
      result.duplicate
        ? 'Qaytarish avval muvaffaqiyatli saqlangan'
        : "Qurilma omborga qaytarildi; asl shartnoma va to'lov tarixi saqlandi",
    )
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 400) return badRequest(e.message)
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Error && (
      err.message.includes('asl to\'lov') ||
      err.message.includes('Tanlangan usul') ||
      err.message.includes('saqlangan kursi')
    )) {
      return badRequest(err.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Qaytarish amali avval saqlangan. Sahifani yangilang.')
    }
    logger.error('[POST /api/devices/[id]/return]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
