/**
 * POST /api/nasiya/import — manually import an EXISTING (pre-Oryx) nasiya.
 *
 * This records carried-over debt, NOT a new sale:
 *   - creates a Device as SOLD_NASIYA (never IN_STOCK, purchasePrice 0, isImported)
 *   - creates a Nasiya with isImported=true; originalTotalAmount /
 *     alreadyPaidBeforeImport are informational and excluded from current gross/
 *     income/profit (shop-stats filters isImported=false)
 *   - generates ONLY the future schedule from the remaining debt
 *   - creates NO Sale row and NO NasiyaPayment for already-paid money
 *
 * Auth: SHOP_ADMIN only, scoped to their own shop.
 */

import { NextRequest, after } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession } from '@/lib/api-auth'
import { importNasiyaSchema } from '@/lib/validations'
import { generateImportSchedule } from '@/lib/nasiya-utils'
import { created, badRequest, conflict, forbidden, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaImportedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import type { ZodError } from 'zod'

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId) {
      return forbidden("Faqat do'kon adminlari eski nasiya import qila oladi")
    }
    const shopId = session.user.shopId
    const currency = await getShopCurrencyContext(shopId)

    const body: unknown = await req.json()
    const parsed = importNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const data = parsed.data

    const enteredImei = data.imei?.trim() || ''
    const normalizedPhone = normalizePhone(data.customerPhone)
    let originalTotalInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let alreadyPaidInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let remainingDebtInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let monthlyPaymentInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    try {
      originalTotalInput = await moneyInputToUzs(data.originalTotalAmount, data.inputCurrency)
      alreadyPaidInput = await moneyInputToUzs(data.alreadyPaidBeforeImport, data.inputCurrency)
      remainingDebtInput = await moneyInputToUzs(data.remainingDebt, data.inputCurrency)
      monthlyPaymentInput = await moneyInputToUzs(data.monthlyPayment, data.inputCurrency)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }
    if (remainingDebtInput.amountUzs > originalTotalInput.amountUzs) {
      return badRequest("Qolgan qarz eski nasiya umumiy summasidan oshmasligi kerak")
    }

    // Native contract-currency ledger — computed from the RAW inputs (not
    // UZS-converted), in whatever currency the import file/form specifies.
    // Old (already-imported) rows stay UZS via the migration backfill; only
    // NEW imports get a real contractCurrency here. See
    // docs/currency-accounting-model.md.
    const contractCurrency = originalTotalInput.inputCurrency
    const contractTotalAmount = roundContractMoney(data.originalTotalAmount, contractCurrency)
    const contractDownPayment = roundContractMoney(data.alreadyPaidBeforeImport, contractCurrency)
    const contractRemainingDebt = roundContractMoney(data.remainingDebt, contractCurrency)
    const contractMonthlyPayment = roundContractMoney(data.monthlyPayment, contractCurrency)

    // Build the future-only schedule up-front so we can reject bad money before
    // touching the DB, and reuse the exact rows inside the transaction.
    let schedule: ReturnType<typeof generateImportSchedule>
    let contractSchedule: ReturnType<typeof generateImportSchedule>
    try {
      schedule = generateImportSchedule(data.nextPaymentDate, remainingDebtInput.amountUzs, monthlyPaymentInput.amountUzs)
      // Force the same instalment count as the legacy schedule — their
      // independently-rounded ratios could otherwise occasionally disagree
      // by one row. See docs/currency-accounting-model.md.
      contractSchedule = generateImportSchedule(
        data.nextPaymentDate,
        contractRemainingDebt,
        contractMonthlyPayment,
        contractCurrency,
        schedule.length,
      )
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "To'lov jadvali noto'g'ri")
    }
    const scheduleTotal = schedule.reduce((sum, item) => sum + item.expectedAmount, 0)
    if (scheduleTotal !== Math.round(remainingDebtInput.amountUzs)) {
      return badRequest("To'lov jadvali qolgan qarz bilan mos emas")
    }

    // Reject a duplicate active IMEI up-front (also guarded by the DB partial
    // unique index). A blank IMEI gets a unique IMPORT- placeholder so multiple
    // no-IMEI imports don't collide on the active-IMEI unique index.
    if (enteredImei) {
      const dup = await prisma.device.findFirst({
        where: { shopId, imei: enteredImei, deletedAt: null },
        select: { id: true },
      })
      if (dup) return conflict('Bu IMEI raqami allaqachon mavjud')
    }

    const duplicateImport = await prisma.nasiya.findFirst({
      where: {
        shopId,
        deletedAt: null,
        isImported: true,
        status: { not: 'CANCELLED' },
        remainingAtImport: Math.round(remainingDebtInput.amountUzs),
        monthlyPayment: Math.round(monthlyPaymentInput.amountUzs),
        ...(data.originalSaleDate ? { originalSaleDate: data.originalSaleDate } : {}),
        customer: {
          is: {
            shopId,
            deletedAt: null,
            OR: [...(normalizedPhone ? [{ normalizedPhone }] : []), { phone: data.customerPhone }],
          },
        },
        device: {
          is: {
            shopId,
            deletedAt: null,
            model: data.deviceModel,
          },
        },
      },
      select: { id: true },
    })
    if (duplicateImport) {
      return conflict("Bu mijoz va qurilma uchun shunga o'xshash eski nasiya allaqachon import qilingan")
    }

    const storedImei = enteredImei || `IMPORT-${randomBytes(4).toString('hex').toUpperCase()}`

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingCustomer = await tx.customer.findFirst({
        where: {
          shopId,
          deletedAt: null,
          OR: [...(normalizedPhone ? [{ normalizedPhone }] : []), { phone: data.customerPhone }],
        },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { name: data.customerName, normalizedPhone },
          })
        : await tx.customer.create({
            data: { shopId, name: data.customerName, phone: data.customerPhone, normalizedPhone },
          })

      // Device exists only to carry the debt — SOLD_NASIYA, cost 0, imported.
      const device = await tx.device.create({
        data: {
          shopId,
          model: data.deviceModel,
          color: data.color || null,
          storage: data.storage || null,
          batteryHealth: data.batteryHealth ?? null,
          purchasePrice: 0,
          imei: storedImei,
          status: 'SOLD_NASIYA',
          isImported: true,
          addedBy: session.user.id,
        },
      })

      const remainingDebt = Math.round(remainingDebtInput.amountUzs)
      const nasiya = await tx.nasiya.create({
        data: {
          shopId,
          deviceId: device.id,
          customerId: customer.id,
          // Legacy accounting fields, mapped for display; excluded from current
          // gross/profit because isImported=true.
          totalAmount: originalTotalInput.amountUzs,
          downPayment: alreadyPaidInput.amountUzs,
          baseRemainingAmount: remainingDebt,
          interestPercent: 0,
          interestAmount: 0,
          finalNasiyaAmount: remainingDebt,
          remainingAmount: remainingDebt,
          months: schedule.length,
          monthlyPayment: Math.round(monthlyPaymentInput.amountUzs),
          startDate: data.nextPaymentDate,
          note: data.importNote,
          createdBy: session.user.id,
          // Import bookkeeping
          isImported: true,
          importSource: 'MANUAL',
          importedAt: new Date(),
          importedById: session.user.id,
          originalSaleDate: data.originalSaleDate ?? null,
          originalTotalAmount: originalTotalInput.amountUzs,
          alreadyPaidBeforeImport: alreadyPaidInput.amountUzs,
          remainingAtImport: remainingDebt,
          importNote: data.importNote,
          // Native contract-currency ledger — source of truth going forward.
          // See docs/currency-accounting-model.md.
          contractCurrency,
          contractExchangeRateAtCreation: originalTotalInput.exchangeRateUsed,
          contractTotalAmount,
          contractDownPayment,
          contractBaseRemainingAmount: contractRemainingDebt,
          contractInterestAmount: 0,
          contractFinalAmount: contractRemainingDebt,
          contractMonthlyPayment,
          contractRemainingAmount: contractRemainingDebt,
          contractPaidAmount: 0,
        },
      })

      await tx.nasiyaSchedule.createMany({
        data: schedule.map((item, index) => ({
          nasiyaId: nasiya.id,
          shopId,
          contractCurrency,
          contractExpectedAmount: contractSchedule[index].expectedAmount,
          monthNumber: item.monthNumber,
          dueDate: item.dueDate,
          expectedAmount: item.expectedAmount,
        })),
      })

      // NOTE: intentionally NO NasiyaPayment row for alreadyPaidBeforeImport —
      // that money was collected before Oryx and must never count as current cash.

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'IMPORT_NASIYA',
          targetType: 'Nasiya',
          targetId: nasiya.id,
          newValue: {
            customerName: data.customerName,
            model: data.deviceModel,
            imei: enteredImei || null,
            originalTotalAmount: originalTotalInput.amountUzs,
            inputOriginalTotalAmount: data.originalTotalAmount,
            alreadyPaidBeforeImport: alreadyPaidInput.amountUzs,
            inputAlreadyPaidBeforeImport: data.alreadyPaidBeforeImport,
            remainingAtImport: remainingDebt,
            inputRemainingDebt: data.remainingDebt,
            monthlyPayment: Math.round(monthlyPaymentInput.amountUzs),
            inputMonthlyPayment: data.monthlyPayment,
            importSource: 'MANUAL',
            ...moneyInputMeta(originalTotalInput),
          },
          note: data.importNote,
        },
      })

      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true } })
      const message = nasiyaImportedMessage({
        shopName: shop?.name ?? '',
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        device: {
          deviceModel: data.deviceModel,
          storage: data.storage,
          color: data.color,
          imei: enteredImei || null,
        },
        originalTotalAmount: originalTotalInput.amountUzs,
        alreadyPaidBeforeImport: alreadyPaidInput.amountUzs,
        remainingDebt,
        monthlyPayment: Math.round(monthlyPaymentInput.amountUzs),
        nextPaymentDate: data.nextPaymentDate,
        adminName: session.user.name,
        currency,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'NASIYA_IMPORTED',
            message,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: nasiya.id,
            relatedType: 'Nasiya',
          },
        })
      }

      return { nasiyaId: nasiya.id, deviceId: device.id, scheduleCount: schedule.length }
    })

    invalidateShopNasiyaMutation(shopId)

    after(() =>
      processPendingNotifications().catch((e) =>
        logger.warn('notification flush failed', { event: 'notification.flush_failed', route: '/api/nasiya/import', error: e }),
      ),
    )

    return created(result, 'Eski nasiya muvaffaqiyatli import qilindi')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu IMEI raqami allaqachon mavjud')
    }
    console.error('[POST /api/nasiya/import]', err)
    return serverError()
  }
}
