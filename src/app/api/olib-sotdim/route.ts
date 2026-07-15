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
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopAnyPermission, requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { createOlibSotdimSchema } from '@/lib/validations'
import { ok, created, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { olibSotdimCreatedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopSaleMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { CustomerSelectionError, resolveCustomerSelection } from '@/lib/server/customer-selection'
import { createMoneyInputConverter, moneyInputMeta, type MoneyInputResult } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import type { ZodError } from 'zod'
import { deviceConditionLabel, formatDeviceStorage, normalizeImei } from '@/lib/device-specs'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'
import {
  allocateCumulativePaymentComponents,
  buildSaleComponentPlan,
  splitUzsReportingAmount,
} from '@/lib/payment-profit-allocation'

// ---------------------------------------------------------------------------
// GET /api/olib-sotdim
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission(['OLIB_VIEW', 'SUPPLIER_PAYMENT_MARK_PAID'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeOwnerFinancials =
      session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'

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
          purchaseInputAmount: true, purchaseCurrency: true,
          imeis: { where: { deletedAt: null }, select: { slot: true, value: true } },
        } },
        sale: { select: { id: true, contractSalePrice: true, contractCurrency: true, customer: { select: { name: true, phone: true } } } },
      },
      }),
      prisma.supplierPayable.count({ where }),
    ])

    return ok(
      {
        items: payables.map((p) => {
          const device = {
            id: p.device.id,
            model: p.device.model,
            imei: p.device.imei,
            color: p.device.color,
            storage: p.device.storage,
            storageAmount: p.device.storageAmount,
            storageUnit: p.device.storageUnit,
            conditionCode: p.device.conditionCode,
            imeis: p.device.imeis,
            storageDisplay: formatDeviceStorage(p.device) || null,
            secondaryImei: p.device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
            conditionLabel: deviceConditionLabel(p.device.conditionCode),
            ...(includeOwnerFinancials
              ? {
                  purchasePrice: Number(p.device.purchaseInputAmount),
                  purchaseCurrency: p.device.purchaseCurrency,
                }
              : {}),
          }

          return {
            id: p.id,
            // A supplier payable is an individual operational amount needed
            // by a staff member authorized to record the supplier payment.
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
            device,
            // A staff member may need the individual supplier payable to
            // record that payment, but pairing it with the customer sale
            // price would disclose the operation's margin.
            sale: {
              id: p.sale.id,
              customer: p.sale.customer,
              ...(includeOwnerFinancials
                ? {
                    salePrice: Number(p.sale.contractSalePrice),
                    contractCurrency: p.sale.contractCurrency,
                  }
                : {}),
            },
            ...(includeOwnerFinancials
              ? { profit: Number(p.sale.contractSalePrice) - Number(p.contractAmount) }
              : {}),
          }
        }),
        total,
        skip,
        take,
      },
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
    const guarded = await requireShopPermission('OLIB_CREATE')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }

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
    const commandHash = createHash('sha256').update(JSON.stringify({
      shopId,
      actorId: session.user.id,
      command: d,
    })).digest('hex')

    const existingSale = await prisma.sale.findUnique({
      where: { shopId_creationIdempotencyKey: { shopId, creationIdempotencyKey: idempotencyKey } },
      select: {
        id: true,
        createdBy: true,
        creationCommandHash: true,
        device: { select: { id: true, isExternalSourced: true } },
        supplierPayable: { select: { id: true, status: true } },
      },
    })
    if (existingSale) {
      if (
        existingSale.createdBy !== session.user.id
        || existingSale.creationCommandHash !== commandHash
        || !existingSale.device.isExternalSourced
        || !existingSale.supplierPayable
      ) return conflict("Idempotency-Key boshqa yoki o'zgartirilgan olib-sotdim uchun ishlatilgan")
      return ok({
        deviceId: existingSale.device.id,
        saleId: existingSale.id,
        payableId: existingSale.supplierPayable.id,
        payableStatus: existingSale.supplierPayable.status,
      }, "Olib-sotdim allaqachon saqlangan")
    }

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('olib-sotdim-create', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)

    const imageKeys = d.imageUrls?.map((value) => resolvePrivateUploadReference({
      value,
      shopId,
      kind: 'device',
      allowLegacyRawKey: true,
    })) ?? []
    if (imageKeys.some((key) => !key)) {
      return badRequest("Qurilma rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }

    let purchaseInput: MoneyInputResult
    let saleInput: MoneyInputResult
    let amountPaidInput: MoneyInputResult | null = null
    try {
      const convertMoney = await createMoneyInputConverter(d.inputCurrency)
      purchaseInput = convertMoney(d.purchasePrice)
      saleInput = convertMoney(d.salePrice)
      if (d.amountPaid !== undefined) amountPaidInput = convertMoney(d.amountPaid)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }
    const purchasePriceUzs = purchaseInput.amountUzs
    const salePriceUzs = saleInput.amountUzs
    const amountPaidUzs = amountPaidInput?.amountUzs
    const storage = formatDeviceStorage({ storageAmount: d.storageAmount, storageUnit: d.storageUnit })

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
    if (paid > 0 && !d.paymentMethod) return badRequest("Pul qabul qilinganda to'lov usuli kiritilishi shart")
    const componentPlan = buildSaleComponentPlan({
      currency: contractCurrency,
      salePrice: contractSalePrice,
      costBasisAmount: contractPurchasePrice,
    })
    const initialComponents = contractPaid > 0
      ? allocateCumulativePaymentComponents({
          currency: contractCurrency,
          totals: componentPlan,
          paid: { principal: 0, margin: 0, interest: 0 },
          paymentAmount: contractPaid,
        })
      : null

    const imei = normalizeImei(d.imei)!
    const secondaryImei = d.secondaryImei ? normalizeImei(d.secondaryImei) : null
    const imeiValues = [imei, secondaryImei].filter((value): value is string => Boolean(value))
    const existingImei = await prisma.device.findFirst({
      where: { shopId, deletedAt: null, OR: [{ imei: { in: imeiValues } }, { imeis: { some: { normalizedValue: { in: imeiValues }, deletedAt: null } } }] },
    })
    if (existingImei) return conflict('Bu IMEI raqami allaqachon mavjud')

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
          storage,
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
          imageUrls: imageKeys as string[],
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

      const customer = await resolveCustomerSelection(tx, {
        shopId,
        mode: d.customerMode,
        customerId: d.customerId,
        customerName: d.customerName,
        customerPhone: d.customerPhone,
      })

      const sale = await tx.sale.create({
        data: {
          shopId,
          deviceId: device.id,
          customerId: customer.id,
          salePrice: salePriceUzs,
          paymentMethod: paid > 0 ? d.paymentMethod : null,
          paidFully: remaining <= 0,
          amountPaid: paid,
          remainingAmount: remaining,
          dueDate: d.dueDate,
          reminderEnabled: d.customerReminderEnabled ?? false,
          note: d.note,
          createdBy: session.user.id,
          creationIdempotencyKey: idempotencyKey,
          creationCommandHash: commandHash,
          // Informational only — see docs/currency-accounting-model.md.
          creationCurrency: saleInput.inputCurrency,
          creationExchangeRate: saleInput.exchangeRateUsed,
          // Native contract-currency ledger — source of truth going forward.
          contractCurrency,
          contractExchangeRateAtCreation: saleInput.exchangeRateUsed,
          contractSalePrice,
          contractAmountPaid: contractPaid,
          contractRemainingAmount: contractRemaining,
          contractCostBasisAmount: componentPlan.principal,
          contractMarginAmount: componentPlan.margin,
          contractPrincipalPaidAmount: initialComponents?.paidAfter.principal ?? 0,
          contractMarginPaidAmount: initialComponents?.paidAfter.margin ?? 0,
          accountingReconstructionStatus: 'COMPLETE',
          accountingReconstructedAt: new Date(),
        },
      })

      if (paid > 0) {
        const reportingComponents = splitUzsReportingAmount({
          amountUzs: paid,
          contractAmount: contractPaid,
          contractComponents: initialComponents!.allocation,
        })
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            shopId,
            amount: paid,
            paymentMethod: d.paymentMethod!,
            paidAt: new Date(),
            note: remaining > 0 ? "Boshlang'ich to'lov" : "To'liq to'lov",
            idempotencyKey: `olib-sotdim-initial:${sale.id}`,
            createdBy: session.user.id,
            paymentInputAmount: d.paidFully ? d.salePrice : d.amountPaid,
            paymentInputCurrency: saleInput.inputCurrency,
            paymentExchangeRate: saleInput.exchangeRateUsed,
            appliedAmountInContractCurrency: contractPaid,
            contractPrincipalAmount: initialComponents!.allocation.principal,
            contractMarginAmount: initialComponents!.allocation.margin,
            principalAmountUzs: reportingComponents.principal,
            marginAmountUzs: reportingComponents.margin,
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

      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true, ownerAdminId: true } })
      const shopAdmins = await tx.shopAdmin.findMany({
        // Olib-sotdim messages include purchase cost and margin, so a staff
        // Telegram identity must not receive them even when general Telegram
        // notifications are enabled for that worker.
        where: {
          shopId,
          id: shop?.ownerAdminId ?? '__no-shop-owner__',
          deletedAt: null,
          isActive: true,
          telegramId: { not: '' },
          telegramVerifiedAt: { not: null },
        },
      })
      const message = olibSotdimCreatedMessage({
        shopName: shop?.name ?? '',
        device: { deviceModel: d.model, storage, color: d.color, batteryHealth: d.batteryHealth, imei, secondaryImei, conditionLabel: d.conditionCode === 'NEW' ? 'Yangi' : 'B/U' },
        supplierName: d.supplierName,
        supplierPhone: d.supplierPhone,
        supplierLocation: d.supplierLocation,
        purchasePrice: contractPurchasePrice,
        salePrice: contractSalePrice,
        profit: contractSalePrice - contractPurchasePrice,
        contractCurrency,
        supplierPaidNow,
        customerName: customer.name,
        customerPhone: customer.phone,
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
            recipientShopAdminId: admin.id,
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
            customerId: customer.id,
            customerName: customer.name,
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

    // This mutation navigates immediately; return only stable identifiers.
    // Returning Prisma's raw create results here exposed purchase cost and
    // other owner-financial fields to an authorized staff browser/cache.
    return created({
      deviceId: result.device.id,
      saleId: result.sale.id,
      payableId: result.payable.id,
      payableStatus: result.payable.status,
    }, "Olib-sotdim muvaffaqiyatli saqlandi")
  } catch (err) {
    if (err instanceof CustomerSelectionError) {
      if (err.status === 404) return notFound(err.message)
      if (err.status === 409) return conflict(err.message)
      return badRequest(err.message)
    }
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      const meta = (err as { meta?: { target?: unknown } }).meta
      const target = Array.isArray(meta?.target) ? meta.target.join(',') : String(meta?.target ?? '')
      if (target.includes('creationIdempotencyKey')) {
        return conflict("Olib-sotdim so'rovi allaqachon bajarilmoqda. Shu so'rovni qayta yuboring.")
      }
      if (target.includes('Customer') || target.includes('normalizedPhone') || target.includes('passportIdentifierHash')) {
        return conflict('Bu telefon yoki pasport bilan faol mijoz mavjud. Uni qidiruvdan tanlang; mijozlar avtomatik birlashtirilmaydi.')
      }
      return conflict("Bu IMEI raqami allaqachon mavjud")
    }
    logger.error('[POST /api/olib-sotdim]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
