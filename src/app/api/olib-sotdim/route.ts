/**
 * GET  /api/olib-sotdim — list this shop's olib-sotdim operations (via their SupplierPayable row)
 * POST /api/olib-sotdim — create a new olib-sotdim operation
 *
 * "Olib-sotdim": we source a device from another shop/person and sell it to
 * our customer in the same operation. Creates a Device (status SOLD_CASH or
 * SOLD_DEBT when the customer still owes money)
 * directly — never IN_STOCK, never available for a later normal sale/nasiya),
 * a Customer (lookup-or-create, same as the normal sale/nasiya flow), a Sale
 * (so it counts in existing reports/profit exactly like a normal cash sale —
 * see shop-stats.ts, unchanged), and a SupplierPayable tracking what WE owe
 * the external supplier — entirely separate from Sale.remainingAmount (what
 * the customer owes us).
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { createOlibSotdimSchema } from '@/lib/validations'
import { ok, created, badRequest, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { olibSotdimCreatedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopSaleMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import type { ZodError } from 'zod'
import { deviceConditionLabel, formatDeviceStorage, normalizeImei } from '@/lib/device-specs'

// ---------------------------------------------------------------------------
// GET /api/olib-sotdim
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const search = searchParams.get('search')?.trim()
    const searchDigits = search ? normalizePhone(search) : null
    const status = searchParams.get('status')
    const payableStatuses = ['PENDING', 'PAID', 'CANCELLED', 'OVERDUE'] as const
    const statusFilter = payableStatuses.find((candidate) => candidate === status)
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const where: Prisma.SupplierPayableWhereInput = {
        shopId,
        deletedAt: null,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search
          ? {
              OR: [
                { supplierName: { contains: search, mode: 'insensitive' } },
                { supplierPhone: { contains: search, mode: 'insensitive' } },
                { supplierNote: { contains: search, mode: 'insensitive' } },
                ...(searchDigits ? [{ supplierPhone: { contains: searchDigits } }] : []),
                { sale: { customer: { name: { contains: search, mode: 'insensitive' } } } },
                { sale: { customer: { phone: { contains: search, mode: 'insensitive' } } } },
                { device: { model: { contains: search, mode: 'insensitive' } } },
                { device: { imei: { contains: search, mode: 'insensitive' } } },
                { device: { imeis: { some: { deletedAt: null, value: { contains: search, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      }

    const [payables, total] = await Promise.all([
      prisma.supplierPayable.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        amount: true,
        contractAmount: true,
        contractCurrency: true,
        status: true,
        dueDate: true,
        paidAt: true,
        paymentMethod: true,
        supplierName: true,
        supplierPhone: true,
        supplierLocation: true,
        createdAt: true,
        device: { select: {
          id: true, model: true, imei: true, color: true, storage: true,
          storageAmount: true, storageUnit: true, conditionCode: true,
          purchasePrice: true, purchaseInputAmount: true, purchaseCurrency: true,
          imeis: { where: { deletedAt: null }, select: { slot: true, value: true } },
        } },
        sale: { select: { id: true, salePrice: true, contractSalePrice: true, contractCurrency: true, customer: { select: { name: true, phone: true } } } },
      },
      }),
      prisma.supplierPayable.count({ where }),
    ])

    return ok(
      { items: payables.map((p) => ({
        id: p.id,
        amount: Number(p.contractAmount),
        contractCurrency: p.contractCurrency,
        status: p.status,
        dueDate: p.dueDate.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
        paymentMethod: p.paymentMethod,
        supplierName: p.supplierName,
        supplierPhone: p.supplierPhone,
        supplierLocation: p.supplierLocation,
        createdAt: p.createdAt.toISOString(),
        device: {
          ...p.device,
          purchasePrice: Number(p.device.purchaseInputAmount),
          purchaseCurrency: p.device.purchaseCurrency,
          storageDisplay: formatDeviceStorage(p.device) || null,
          secondaryImei: p.device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
          conditionLabel: deviceConditionLabel(p.device.conditionCode),
        },
        sale: { ...p.sale, salePrice: Number(p.sale.contractSalePrice), contractCurrency: p.sale.contractCurrency },
        profit: Number(p.sale.contractSalePrice) - Number(p.contractAmount),
      })), total, skip, take },
      "Olib-sotdim ro'yxati",
    )
  } catch (err) {
    logger.error('[GET /api/olib-sotdim]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// POST /api/olib-sotdim
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const body: unknown = await req.json()
    const parsed = createOlibSotdimSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const d = parsed.data

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Per-instance abuse guard (not distributed — see src/lib/rate-limit.ts).
    const rate = await checkRateLimitDistributed(rateLimitKey('olib-sotdim-create', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)

    if (d.imageUrls?.some((url) => !url.startsWith(`shops/${shopId}/devices/`))) {
      return badRequest("Qurilma rasmi faqat shu do'kon private storage papkasidan bo'lishi kerak")
    }

    let purchaseInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let saleInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let amountPaidInput: Awaited<ReturnType<typeof moneyInputToUzs>> | null = null
    try {
      purchaseInput = await moneyInputToUzs(d.purchasePrice, d.inputCurrency)
      saleInput = await moneyInputToUzs(d.salePrice, d.inputCurrency)
      if (d.amountPaid !== undefined) amountPaidInput = await moneyInputToUzs(d.amountPaid, d.inputCurrency)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }
    const purchasePriceUzs = purchaseInput.amountUzs
    const salePriceUzs = saleInput.amountUzs
    const amountPaidUzs = amountPaidInput?.amountUzs

    // Native contract-currency ledger — computed from the RAW inputs (not
    // UZS-converted), in the currency this operation was actually made in.
    // See docs/currency-accounting-model.md.
    const contractCurrency = saleInput.inputCurrency
    const contractSalePrice = roundContractMoney(d.salePrice, contractCurrency)
    const contractPurchasePrice = roundContractMoney(d.purchasePrice, contractCurrency)
    const contractAmountPaidInput = d.amountPaid !== undefined ? roundContractMoney(d.amountPaid, contractCurrency) : undefined
    const paid = d.paidFully ? salePriceUzs : amountPaidUzs ?? 0
    const remaining = salePriceUzs - paid
    const contractPaid = d.paidFully ? contractSalePrice : contractAmountPaidInput ?? 0
    const contractRemaining = contractSalePrice - contractPaid
    const deviceStatus = contractRemaining > 0 ? 'SOLD_DEBT' : 'SOLD_CASH'

    const imei = normalizeImei(d.imei)!
    const secondaryImei = d.secondaryImei ? normalizeImei(d.secondaryImei) : null
    const imeiValues = [imei, secondaryImei].filter((value): value is string => Boolean(value))
    const existingImei = await prisma.device.findFirst({
      where: { shopId, deletedAt: null, OR: [{ imei: { in: imeiValues } }, { imeis: { some: { normalizedValue: { in: imeiValues }, deletedAt: null } } }] },
    })
    if (existingImei) return conflict('Bu IMEI raqami allaqachon mavjud')

    const normalizedCustomerPhone = normalizePhone(d.customerPhone)
    const supplierPaidNow = d.supplierPaidNow

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Never IN_STOCK — this device skips inventory entirely and goes straight
      // to a sold/history state, so it can never be picked up by the normal
      // "Naqd sotish"/"Nasiyaga berish" device pickers or restocked implicitly.
      const device = await tx.device.create({
        data: {
          shopId,
          model: d.model,
          color: d.color,
          storage: d.storage,
          storageAmount: d.storageAmount,
          storageUnit: d.storageUnit,
          batteryHealth: d.batteryHealth,
          purchasePrice: purchasePriceUzs,
          // Native purchase-currency context — see docs/currency-accounting-model.md.
          purchaseCurrency: purchaseInput.inputCurrency,
          purchaseInputAmount: d.purchasePrice,
          purchaseExchangeRateAtCreation: purchaseInput.exchangeRateUsed,
          purchaseAmountUzsSnapshot: purchasePriceUzs,
          imei,
          supplierPhone: d.supplierPhone,
          imageUrls: d.imageUrls ?? [],
          status: deviceStatus,
          addedBy: session.user.id,
          note: d.deviceNote,
          condition: d.conditionCode === 'NEW' ? 'Yangi' : 'B/U',
          conditionCode: d.conditionCode,
          imeis: { create: [
            { slot: 'PRIMARY', value: imei, normalizedValue: imei },
            ...(secondaryImei ? [{ slot: 'SECONDARY' as const, value: secondaryImei, normalizedValue: secondaryImei }] : []),
          ] },
          isExternalSourced: true,
        },
      })

      const existingCustomer = await tx.customer.findFirst({
        where: {
          shopId,
          deletedAt: null,
          OR: [
            ...(normalizedCustomerPhone ? [{ normalizedPhone: normalizedCustomerPhone }] : []),
            { phone: d.customerPhone },
          ],
        },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { name: d.customerName, normalizedPhone: normalizedCustomerPhone },
          })
        : await tx.customer.create({
            data: { shopId, name: d.customerName, phone: d.customerPhone, normalizedPhone: normalizedCustomerPhone },
          })

      const sale = await tx.sale.create({
        data: {
          shopId,
          deviceId: device.id,
          customerId: customer.id,
          salePrice: salePriceUzs,
          paymentMethod: d.paymentMethod,
          paidFully: remaining <= 0,
          amountPaid: paid,
          remainingAmount: remaining,
          dueDate: d.dueDate,
          reminderEnabled: d.customerReminderEnabled ?? false,
          note: d.note,
          createdBy: session.user.id,
          // Informational only — see docs/currency-accounting-model.md.
          creationCurrency: saleInput.inputCurrency,
          creationExchangeRate: saleInput.exchangeRateUsed,
          // Native contract-currency ledger — source of truth going forward.
          contractCurrency,
          contractExchangeRateAtCreation: saleInput.exchangeRateUsed,
          contractSalePrice,
          contractAmountPaid: contractPaid,
          contractRemainingAmount: contractRemaining,
        },
      })

      if (paid > 0) {
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            shopId,
            amount: paid,
            paymentMethod: d.paymentMethod,
            paidAt: new Date(),
            note: remaining > 0 ? "Boshlang'ich to'lov" : "To'liq to'lov",
            idempotencyKey: `olib-sotdim-initial:${sale.id}`,
            createdBy: session.user.id,
            paymentInputAmount: d.paidFully ? d.salePrice : d.amountPaid,
            paymentInputCurrency: saleInput.inputCurrency,
            paymentExchangeRate: saleInput.exchangeRateUsed,
            appliedAmountInContractCurrency: contractPaid,
          },
        })
      }

      const payable = await tx.supplierPayable.create({
        data: {
          shopId,
          deviceId: device.id,
          saleId: sale.id,
          supplierName: d.supplierName,
          supplierPhone: d.supplierPhone,
          supplierLocation: d.supplierLocation,
          supplierNote: d.supplierNote,
          amount: purchasePriceUzs,
          // Native contract-currency ledger — see docs/currency-accounting-model.md.
          contractCurrency,
          contractExchangeRateAtCreation: purchaseInput.exchangeRateUsed,
          contractAmount: contractPurchasePrice,
          status: supplierPaidNow ? 'PAID' : 'PENDING',
          dueDate: supplierPaidNow ? (d.supplierPaidDate ?? new Date()) : d.supplierDueDate!,
          reminderEnabled: supplierPaidNow ? false : (d.supplierReminderEnabled ?? true),
          earlyReminderEnabled: supplierPaidNow ? false : d.earlyReminderEnabled,
          earlyReminderDays: supplierPaidNow ? null : (d.earlyReminderEnabled ? (d.earlyReminderDays ?? null) : null),
          paidAt: supplierPaidNow ? (d.supplierPaidDate ?? new Date()) : null,
          paymentMethod: supplierPaidNow ? d.supplierPaymentMethod : null,
          createdBy: session.user.id,
        },
      })

      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true } })
      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const message = olibSotdimCreatedMessage({
        shopName: shop?.name ?? '',
        device: { deviceModel: d.model, storage: d.storage, color: d.color, batteryHealth: d.batteryHealth, imei, secondaryImei, conditionLabel: d.conditionCode === 'NEW' ? 'Yangi' : 'B/U' },
        supplierName: d.supplierName,
        supplierPhone: d.supplierPhone,
        supplierLocation: d.supplierLocation,
        purchasePrice: contractPurchasePrice,
        salePrice: contractSalePrice,
        profit: contractSalePrice - contractPurchasePrice,
        contractCurrency,
        supplierPaidNow,
        customerName: d.customerName,
        customerPhone: d.customerPhone,
        adminName: session.user.name,
        currency,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'OLIB_SOTDIM_CREATED',
            message,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: sale.id,
            relatedType: 'Sale',
          },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'OLIB_SOTDIM_CREATE',
          targetType: 'Sale',
          targetId: sale.id,
          newValue: {
            model: d.model,
            imei,
            purchasePrice: purchasePriceUzs,
            salePrice: salePriceUzs,
            profit: salePriceUzs - purchasePriceUzs,
            supplierName: d.supplierName,
            supplierPaidNow,
            customerName: d.customerName,
            deviceStatus,
            ...moneyInputMeta(purchaseInput),
          },
        },
      })

      return { device, sale, payable }
    })

    invalidateShopSaleMutation(shopId)

    after(() =>
      processPendingNotifications().catch((e) =>
        logger.warn('notification flush failed', { event: 'notification.flush_failed', route: '/api/olib-sotdim', error: e }),
      ),
    )

    return created(result, "Olib-sotdim muvaffaqiyatli saqlandi")
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return conflict("Bu IMEI raqami allaqachon mavjud")
    }
    logger.error('[POST /api/olib-sotdim]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
