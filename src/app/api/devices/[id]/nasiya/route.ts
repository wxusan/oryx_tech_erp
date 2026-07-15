/**
 * POST /api/devices/[id]/nasiya — create a nasiya (instalment) plan for a device
 *
 * Validates device is IN_STOCK, creates Customer + Nasiya + NasiyaSchedule rows
 * in a single transaction, updates device status to SOLD_NASIYA, creates
 * notifications, and logs the action.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { createNasiyaSchema } from '@/lib/validations'
import { calculateNasiyaAmounts, calculateNasiyaAmountsFromMonthlyPayment, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { created, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaCreatedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { CustomerSelectionError, resolveCustomerSelection } from '@/lib/server/customer-selection'
import { createMoneyInputConverter, moneyInputMeta, type MoneyInputResult } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import type { ZodError } from 'zod'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'
import { computeSaleContractMargin } from '@/lib/nasiya-contract'
import { buildNasiyaComponentPlan, splitUzsReportingAmount } from '@/lib/payment-profit-allocation'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('NASIYA_CREATE')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = createNasiyaSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      customerMode, customerId, customerName, customerPhone, passportPhotoUrl,
      totalAmount, downPayment, months, interestPercent,
      monthlyPayment: monthlyPaymentOverrideInput, useMonthlyPaymentOverride,
      startDate, paymentMethod, note,
      earlyReminderEnabled, earlyReminderDays,
    } = parsed.data

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('nasiya-create', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)
    const passportPhotoKey = passportPhotoUrl
      ? resolvePrivateUploadReference({
          value: passportPhotoUrl,
          shopId,
          kind: 'passport',
          allowLegacyRawKey: true,
        }) ?? undefined
      : undefined
    if (passportPhotoUrl && !passportPhotoKey) {
      return badRequest("Pasport rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }
    let totalInput: MoneyInputResult
    let downPaymentInput: MoneyInputResult
    let monthlyPaymentOverrideUzs: number | undefined
    try {
      const convertMoney = await createMoneyInputConverter(parsed.data.inputCurrency)
      totalInput = convertMoney(totalAmount)
      downPaymentInput = convertMoney(downPayment)
      if (useMonthlyPaymentOverride && monthlyPaymentOverrideInput !== undefined) {
        monthlyPaymentOverrideUzs = convertMoney(monthlyPaymentOverrideInput).amountUzs
      }
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }

    let amounts: ReturnType<typeof calculateNasiyaAmounts>
    let contractAmounts: ReturnType<typeof calculateNasiyaAmounts>
    try {
      // Item 6: when the shop admin manually set a monthly payment (instead
      // of an interest percent), that monthly payment — not interestPercent
      // — is the source of truth. Uses the exact reverse-of-forward formula
      // already unit-tested in nasiya-utils.ts, so this always matches what
      // the create-nasiya form previewed (no separate rounding path).
      if (useMonthlyPaymentOverride && monthlyPaymentOverrideUzs !== undefined) {
        amounts = calculateNasiyaAmountsFromMonthlyPayment({
          totalAmount: totalInput.amountUzs,
          downPayment: downPaymentInput.amountUzs,
          months,
          monthlyPayment: monthlyPaymentOverrideUzs,
        })
        contractAmounts = calculateNasiyaAmountsFromMonthlyPayment({
          totalAmount,
          downPayment,
          months,
          monthlyPayment: monthlyPaymentOverrideInput as number,
          currency: totalInput.inputCurrency,
        })
      } else {
        amounts = calculateNasiyaAmounts({
          totalAmount: totalInput.amountUzs,
          downPayment: downPaymentInput.amountUzs,
          months,
          interestPercent,
        })
        // Native contract-currency ledger (source of truth going forward) — the
        // same shape, computed from the RAW input amounts (not UZS-converted),
        // in the currency the deal was actually made in. See
        // docs/currency-accounting-model.md.
        contractAmounts = calculateNasiyaAmounts({
          totalAmount,
          downPayment,
          months,
          interestPercent,
          currency: totalInput.inputCurrency,
        })
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Nasiya summasi noto'g'ri")
    }

    // Generate exact schedule rows. The last month absorbs rounding remainder.
    const scheduleItems = generatePaymentSchedule(startDate, months, amounts.finalNasiyaAmount)
    const scheduleTotal = scheduleItems.reduce((sum, item) => sum + item.expectedAmount, 0)
    if (scheduleTotal !== amounts.finalNasiyaAmount) {
      return badRequest("To'lov jadvali nasiya jami bilan mos emas")
    }
    const contractScheduleItems = generatePaymentSchedule(
      startDate,
      months,
      contractAmounts.finalNasiyaAmount,
      totalInput.inputCurrency,
    )

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: { shop: { select: { name: true } }, imeis: { where: { deletedAt: null } } },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma nasiyaga sotishga tayyor emas" }

      const contractMarginAmount = computeSaleContractMargin(
        contractAmounts.totalAmount,
        totalInput.inputCurrency,
        totalInput.exchangeRateUsed,
        {
          purchaseCurrency: device.purchaseCurrency,
          purchaseInputAmount: Number(device.purchaseInputAmount),
          purchaseAmountUzsSnapshot: Number(device.purchaseAmountUzsSnapshot),
        },
      )
      if (contractMarginAmount === null) {
        throw { status: 409, message: "Qurilma tannarxini shartnoma valyutasida aniq ajratib bo'lmadi" }
      }
      const componentPlan = buildNasiyaComponentPlan({
        currency: totalInput.inputCurrency,
        totalAmount: contractAmounts.totalAmount,
        downPayment: contractAmounts.downPayment,
        interestAmount: contractAmounts.interestAmount,
        costBasisAmount: contractAmounts.totalAmount - contractMarginAmount,
        scheduleExpectedAmounts: contractScheduleItems.map((item) => item.expectedAmount),
      })

      const reserved = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: 'IN_STOCK' },
        data: { status: 'SOLD_NASIYA', updatedAt: new Date() },
      })
      if (reserved.count !== 1) throw { status: 409, message: "Qurilma allaqachon sotilgan" }

      const customer = await resolveCustomerSelection(tx, {
        shopId,
        mode: customerMode,
        customerId,
        customerName,
        customerPhone,
        passportPhotoUrl: passportPhotoKey,
        requirePassportPhoto: true,
      })

      const nasiya = await tx.nasiya.create({
        data: {
          shopId,
          deviceId,
          customerId: customer.id,
          totalAmount: amounts.totalAmount,
          downPayment: amounts.downPayment,
          baseRemainingAmount: amounts.baseRemainingAmount,
          interestPercent: amounts.interestPercent,
          interestAmount: amounts.interestAmount,
          finalNasiyaAmount: amounts.finalNasiyaAmount,
          remainingAmount: amounts.finalNasiyaAmount,
          months,
          monthlyPayment: amounts.monthlyPayment,
          startDate,
          earlyReminderEnabled,
          earlyReminderDays: earlyReminderEnabled ? earlyReminderDays : null,
          note,
          createdBy: session.user.id,
          // Informational only — see docs/currency-accounting-model.md.
          creationCurrency: totalInput.inputCurrency,
          creationExchangeRate: totalInput.exchangeRateUsed,
          // Native contract-currency ledger — source of truth for debt/
          // schedule/allocation math from here on. Frozen forever: switching
          // the shop's preferredCurrency later never touches these.
          contractCurrency: totalInput.inputCurrency,
          contractExchangeRateAtCreation: totalInput.exchangeRateUsed,
          contractTotalAmount: contractAmounts.totalAmount,
          contractDownPayment: contractAmounts.downPayment,
          contractBaseRemainingAmount: contractAmounts.baseRemainingAmount,
          contractInterestAmount: contractAmounts.interestAmount,
          contractFinalAmount: contractAmounts.finalNasiyaAmount,
          contractMonthlyPayment: contractAmounts.monthlyPayment,
          contractRemainingAmount: contractAmounts.finalNasiyaAmount,
          contractPaidAmount: 0,
          contractCostBasisAmount: componentPlan.costBasisAmount,
          contractMarginAmount: componentPlan.marginAmount,
          contractDownPaymentPrincipalAmount: componentPlan.downPayment.principal,
          contractDownPaymentMarginAmount: componentPlan.downPayment.margin,
          accountingReconstructionStatus: 'COMPLETE',
          accountingReconstructedAt: new Date(),
        },
      })

      // Create one NasiyaSchedule row per month (UZS legacy + native contract mirror).
      await tx.nasiyaSchedule.createMany({
        data: scheduleItems.map((item, index) => ({
          nasiyaId: nasiya.id,
          shopId,
          monthNumber: item.monthNumber,
          dueDate: item.dueDate,
          expectedAmount: item.expectedAmount,
          contractCurrency: totalInput.inputCurrency,
          contractExpectedAmount: contractScheduleItems[index].expectedAmount,
          contractRemainingAmount: contractScheduleItems[index].expectedAmount,
          contractPrincipalAmount: componentPlan.schedules[index].principal,
          contractMarginAmount: componentPlan.schedules[index].margin,
          contractInterestAmount: componentPlan.schedules[index].interest,
        })),
      })

      if (amounts.downPayment > 0) {
        const initialPayment = await tx.nasiyaPayment.create({
          data: {
            nasiyaId: nasiya.id,
            nasiyaScheduleId: null,
            shopId,
            amount: amounts.downPayment,
            paymentMethod,
            paidAt: new Date(),
            note: "Boshlang'ich to'lov",
            createdBy: session.user.id,
            paymentInputAmount: downPayment,
            paymentInputCurrency: downPaymentInput.inputCurrency,
            paymentExchangeRate: downPaymentInput.exchangeRateUsed,
            appliedAmountInContractCurrency: contractAmounts.downPayment,
          },
        })
        const reportingComponents = splitUzsReportingAmount({
          amountUzs: amounts.downPayment,
          contractAmount: contractAmounts.downPayment,
          contractComponents: componentPlan.downPayment,
        })
        await tx.nasiyaPaymentAllocation.create({
          data: {
            shopId,
            nasiyaId: nasiya.id,
            nasiyaPaymentId: initialPayment.id,
            nasiyaScheduleId: null,
            sequence: 1,
            contractCurrency: totalInput.inputCurrency,
            contractAmount: contractAmounts.downPayment,
            contractPrincipalAmount: componentPlan.downPayment.principal,
            contractMarginAmount: componentPlan.downPayment.margin,
            contractInterestAmount: 0,
            amountUzs: amounts.downPayment,
            principalAmountUzs: reportingComponents.principal,
            marginAmountUzs: reportingComponents.margin,
            interestAmountUzs: 0,
          },
        })
      }

      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const nasiyaMessage = nasiyaCreatedMessage({
        shopName: device.shop.name,
        customerName: customer.name,
        customerPhone: customer.phone,
        device: presentDeviceSpecs(device),
        totalAmount: amounts.totalAmount,
        downPayment: amounts.downPayment,
        baseRemainingAmount: amounts.baseRemainingAmount,
        interestPercent: amounts.interestPercent,
        interestAmount: amounts.interestAmount,
        finalNasiyaAmount: amounts.finalNasiyaAmount,
        months,
        monthlyPayment: amounts.monthlyPayment,
        nextPaymentDate: scheduleItems[0]?.dueDate ?? null,
        adminName: session.user.name,
        currency,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'NASIYA',
            message: nasiyaMessage,
            telegramId: admin.telegramId!,
            recipientShopAdminId: admin.id,
            scheduledAt: new Date(),
            relatedId: nasiya.id,
            relatedType: 'Nasiya',
          },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'CREATE_NASIYA',
          targetType: 'Nasiya',
          targetId: nasiya.id,
          newValue: {
            customerId: customer.id,
            customerName: customer.name,
            totalAmount: amounts.totalAmount,
            inputTotalAmount: totalAmount,
            downPayment: amounts.downPayment,
            inputDownPayment: downPayment,
            baseRemainingAmount: amounts.baseRemainingAmount,
            interestPercent: amounts.interestPercent,
            interestAmount: amounts.interestAmount,
            finalNasiyaAmount: amounts.finalNasiyaAmount,
            months,
            ...moneyInputMeta(totalInput),
          },
        },
      })

      return nasiya
    })

    invalidateShopNasiyaMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return created(result, "Nasiya muvaffaqiyatli yaratildi")
  } catch (err: unknown) {
    if (err instanceof CustomerSelectionError) {
      if (err.status === 404) return notFound(err.message)
      if (err.status === 409) return conflict(err.message)
      return badRequest(err.message)
    }
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon bilan faol mijoz mavjud. Uni qidiruvdan tanlang; mijozlar avtomatik birlashtirilmaydi.')
    }
    logger.error('[POST /api/devices/[id]/nasiya]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
