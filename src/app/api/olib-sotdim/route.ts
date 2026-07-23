import { createHash } from 'node:crypto'
import { NextRequest, after } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireShopAnyPermission, requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, conflict, created, forbidden, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { createOlibSotdimSchema } from '@/lib/validations'
import { normalizePhone } from '@/lib/phone'
import { normalizeImei, formatDeviceStorage, deviceConditionLabel, presentDeviceSpecs } from '@/lib/device-specs'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'
import { CustomerSelectionError, resolveCustomerSelection } from '@/lib/server/customer-selection'
import { CustomerPassportConfigurationError } from '@/lib/customer-passport'
import { createMoneyInputConverter, moneyInputMeta, type MoneyInputResult } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { roundContractMoney, computeSaleContractMargin } from '@/lib/nasiya-contract'
import { allocateCumulativePaymentComponents, buildSaleComponentPlan, splitUzsReportingAmount } from '@/lib/payment-profit-allocation'
import { prepareNasiyaContract, createNasiyaContractCore, type PreparedNasiyaContract } from '@/lib/server/nasiya-contract-core'
import { hasNasiyaPaymentFxQuoteColumns } from '@/lib/server/nasiya-payment-schema'
import { createSupplierPayableCore } from '@/lib/server/supplier-payable-payments'
import { getActiveShopPackage, enabledFeatureSet, getLiveShopPrincipalForMutation, principalHasFeature, principalHasPermission } from '@/lib/server/shop-access'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import { validatePaymentBreakdown, representativePaymentMethod } from '@/lib/payment-breakdown'
import { invalidateShopNasiyaMutation, invalidateShopSaleMutation, invalidateShopSupplierPayableMutation } from '@/lib/server/cache-tags'
import { resolveTelegramRecipients, telegramNotificationRows, telegramUnavailableMarkerRows, TELEGRAM_AUDIENCES } from '@/lib/server/telegram-recipients'
import { olibSotdimCreatedMessage, olibSotdimNasiyaCreatedMessage } from '@/lib/telegram-templates'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import type { ZodError } from 'zod'

const payableStatuses = ['PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'OVERDUE'] as const

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission([
      'OLIB_VIEW', 'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID',
    ])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeOwnerFinancials = session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'
    const resolved = await resolveActiveShopId(session, req.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const search = req.nextUrl.searchParams.get('search')?.trim()
    const searchDigits = search ? normalizePhone(search) : null
    const statusParam = req.nextUrl.searchParams.get('status')
    const status = payableStatuses.find((candidate) => candidate === statusParam)
    const requestedTake = Number(req.nextUrl.searchParams.get('take') ?? 25)
    const requestedSkip = Number(req.nextUrl.searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
    const where: Prisma.SupplierPayableWhereInput = {
      shopId,
      origin: 'OLIB_SOTDIM',
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { supplierName: { contains: search, mode: 'insensitive' } },
          { supplierPhone: { contains: search, mode: 'insensitive' } },
          ...(searchDigits ? [{ supplierPhone: { contains: searchDigits } }] : []),
          { device: { model: { contains: search, mode: 'insensitive' } } },
          { device: { imei: { contains: search, mode: 'insensitive' } } },
          { olibSotdimOperation: { customer: { name: { contains: search, mode: 'insensitive' } } } },
          { olibSotdimOperation: { customer: { phone: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.supplierPayable.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true, origin: true, amount: true, contractAmount: true, contractCurrency: true,
          paidAmount: true, remainingAmount: true, contractPaidAmount: true, contractRemainingAmount: true,
          status: true, dueDate: true, paidAt: true, lastPaymentAt: true, paymentMethod: true,
          supplierName: true, supplierPhone: true, supplierLocation: true, createdAt: true,
          device: { select: {
            id: true, model: true, imei: true, color: true, storage: true, storageAmount: true,
            storageUnit: true, conditionCode: true, purchaseInputAmount: true, purchaseCurrency: true,
            imageUrls: true, imeis: { where: { deletedAt: null }, select: { slot: true, value: true } },
          } },
          olibSotdimOperation: { select: {
            id: true, dealType: true,
            customer: { select: { id: true, name: true, phone: true } },
            sale: { select: { id: true, contractSalePrice: true, contractCurrency: true, contractRemainingAmount: true } },
            nasiya: { select: { id: true, contractFinalAmount: true, contractCurrency: true, contractRemainingAmount: true, months: true, monthlyPayment: true } },
          } },
        },
      }),
      prisma.supplierPayable.count({ where }),
    ])
    return ok({
      items: rows.map((row) => {
        const operation = row.olibSotdimOperation
        const customerOutcome = operation?.dealType === 'NASIYA' && operation.nasiya
          ? {
              type: 'NASIYA' as const,
              id: operation.nasiya.id,
              total: Number(operation.nasiya.contractFinalAmount),
              remaining: Number(operation.nasiya.contractRemainingAmount),
              contractCurrency: operation.nasiya.contractCurrency,
              months: operation.nasiya.months,
              monthlyPayment: Number(operation.nasiya.monthlyPayment),
            }
          : operation?.sale ? {
              type: 'SALE' as const,
              id: operation.sale.id,
              total: Number(operation.sale.contractSalePrice),
              remaining: Number(operation.sale.contractRemainingAmount),
              contractCurrency: operation.sale.contractCurrency,
            } : null
        return {
          id: row.id,
          operationId: operation?.id ?? null,
          amount: Number(row.contractAmount),
          paidAmount: Number(row.contractPaidAmount),
          remainingAmount: Number(row.contractRemainingAmount),
          contractCurrency: row.contractCurrency,
          status: row.status,
          dueDate: row.dueDate.toISOString(),
          paidAt: row.paidAt?.toISOString() ?? null,
          lastPaymentAt: row.lastPaymentAt?.toISOString() ?? null,
          paymentMethod: row.paymentMethod,
          supplierName: row.supplierName,
          supplierPhone: row.supplierPhone,
          supplierLocation: row.supplierLocation,
          createdAt: row.createdAt.toISOString(),
          customer: operation?.customer ?? null,
          customerOutcome,
          device: {
            id: row.device.id,
            model: row.device.model,
            imei: row.device.imei,
            color: row.device.color,
            storage: row.device.storage,
            storageDisplay: formatDeviceStorage(row.device) || null,
            secondaryImei: row.device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
            conditionCode: row.device.conditionCode,
            conditionLabel: deviceConditionLabel(row.device.conditionCode),
            imageUrl: row.device.imageUrls[0] ?? null,
            ...(includeOwnerFinancials ? {
              purchasePrice: Number(row.device.purchaseInputAmount),
              purchaseCurrency: row.device.purchaseCurrency,
            } : {}),
          },
          ...(includeOwnerFinancials && customerOutcome ? {
            profit: customerOutcome.type === 'SALE' && customerOutcome.contractCurrency === row.contractCurrency
              ? customerOutcome.total - Number(row.contractAmount)
              : null,
          } : {}),
        }
      }),
      total,
      skip,
      take,
    }, "Olib-sotdim ro'yxati")
  } catch (error) {
    logger.error('[GET /api/olib-sotdim]', { event: 'api.route_error', error })
    return serverError()
  }
}

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
    if (!parsed.success) return badRequest((parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot")
    const d = parsed.data
    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const commandHash = createHash('sha256').update(JSON.stringify({ shopId, actorId: session.user.id, command: d })).digest('hex')
    const rate = await checkRateLimitDistributed(rateLimitKey('olib-sotdim-create', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const canManagePassport = session.user.role === 'SUPER_ADMIN' || Boolean(guarded.principal && principalHasPermission(guarded.principal, 'CUSTOMER_PASSPORT_MANAGE'))
    const canOverrideTrust = session.user.role === 'SUPER_ADMIN' || Boolean(guarded.principal && principalHasPermission(guarded.principal, 'CUSTOMER_TRUST_OVERRIDE'))
    if (d.customerMode === 'NEW' && d.customerPassportIdentifier && !canManagePassport) return forbidden("Pasport ma'lumotlarini qo'shish ruxsati berilmagan")
    if (d.customerMode === 'NEW' && d.customerTrustOverride !== undefined && !canOverrideTrust) return forbidden("Ishonch darajasini o'zgartirish ruxsati berilmagan")
    if (d.supplierPaymentBreakdown) {
      const breakdownError = validatePaymentBreakdown(d.supplierPaymentBreakdown, d.supplierPaidNow ? d.purchasePrice : (d.supplierInitialPaymentAmount ?? 0), d.purchaseInputCurrency ?? d.inputCurrency ?? 'UZS')
      if (breakdownError) return badRequest(breakdownError)
    }
    if (d.paymentBreakdown && d.customerDealType === 'SALE') {
      const customerPaid = d.paidFully ? d.salePrice! : (d.amountPaid ?? 0)
      const breakdownError = validatePaymentBreakdown(d.paymentBreakdown, customerPaid, d.customerInputCurrency ?? d.inputCurrency ?? 'UZS')
      if (breakdownError) return badRequest(breakdownError)
    }

    const imageKeys = d.imageUrls?.map((value) => resolvePrivateUploadReference({ value, shopId, kind: 'device', allowLegacyRawKey: true })) ?? []
    if (imageKeys.some((key) => !key)) return badRequest("Qurilma rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    const passportPhotoKey = d.passportPhotoUrl
      ? resolvePrivateUploadReference({ value: d.passportPhotoUrl, shopId, kind: 'passport', allowLegacyRawKey: true }) ?? undefined
      : undefined
    if (d.passportPhotoUrl && !passportPhotoKey) return badRequest("Pasport rasmi boshqa do'konga tegishli yoki havola muddati tugagan")

    let purchaseInput: MoneyInputResult
    let supplierInitialInput: MoneyInputResult | null = null
    let saleInput: MoneyInputResult | null = null
    let salePaidInput: MoneyInputResult | null = null
    let preparedNasiya: PreparedNasiyaContract | null = null
    const supplierInitialRaw = d.supplierPaidNow ? d.purchasePrice : (d.supplierInitialPaymentAmount ?? 0)
    try {
      const convertPurchase = await createMoneyInputConverter(d.purchaseInputCurrency ?? d.inputCurrency)
      purchaseInput = convertPurchase(d.purchasePrice)
      if (supplierInitialRaw > 0) supplierInitialInput = convertPurchase(supplierInitialRaw)
      if (d.customerDealType === 'SALE') {
        const convertCustomer = await createMoneyInputConverter(d.customerInputCurrency ?? d.inputCurrency)
        saleInput = convertCustomer(d.salePrice!)
        const rawPaid = d.paidFully ? d.salePrice! : (d.amountPaid ?? 0)
        if (rawPaid > 0) salePaidInput = convertCustomer(rawPaid)
      } else {
        preparedNasiya = await prepareNasiyaContract({
          totalAmount: d.totalAmount!,
          downPayment: d.downPayment!,
          months: d.months!,
          interestPercent: d.interestPercent,
          monthlyPayment: d.monthlyPayment,
          useMonthlyPaymentOverride: d.useMonthlyPaymentOverride,
          startDate: d.startDate!,
          inputCurrency: d.customerInputCurrency ?? d.inputCurrency,
        })
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Valyuta kursi mavjud emas')
    }
    if (supplierInitialRaw > 0 && !d.supplierPaymentMethod) return badRequest("Yetkazib beruvchiga to'lov usuli kiritilishi shart")
    const imei = normalizeImei(d.imei)!
    const secondaryImei = d.secondaryImei ? normalizeImei(d.secondaryImei) : null
    const currency = await getShopCurrencyContext(shopId)
    const paymentFxQuoteColumnsAvailable = d.customerDealType === 'NASIYA' ? await hasNasiyaPaymentFxQuoteColumns() : false
    const storage = formatDeviceStorage(d)

    const run = () => prisma.$transaction(async (tx) => {
      if (session.user.role === 'SHOP_ADMIN') {
        const live = await getLiveShopPrincipalForMutation(tx, { shopId, actorId: session.user.id })
        if (!live || !principalHasPermission(live, 'OLIB_CREATE') || !principalHasFeature(live, 'OLIB_SOTDIM')) {
          throw { status: 403, message: "Bu amal uchun ruxsat berilmagan" }
        }
        if (d.customerDealType === 'NASIYA' && !principalHasFeature(live, 'NASIYA')) {
          throw { status: 403, message: "Nasiya moduli do'kon paketida yoqilmagan" }
        }
      } else {
        const activePackage = await getActiveShopPackage(shopId, new Date(), tx)
        const features = enabledFeatureSet(activePackage)
        if (!features.has('OLIB_SOTDIM') || !features.has(d.customerDealType === 'NASIYA' ? 'NASIYA' : 'CASH_SALES')) {
          throw { status: 403, message: "Kerakli modul do'kon paketida yoqilmagan" }
        }
      }
      const replay = await tx.olibSotdimOperation.findUnique({
        where: { shopId_creationIdempotencyKey: { shopId, creationIdempotencyKey: idempotencyKey } },
        select: { id: true, deviceId: true, saleId: true, nasiyaId: true, dealType: true, createdBy: true, creationCommandHash: true, supplierPayable: { select: { id: true, status: true } } },
      })
      if (replay) {
        if (replay.createdBy !== session.user.id || replay.creationCommandHash !== commandHash || replay.dealType !== d.customerDealType || !replay.supplierPayable) {
          throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan olib-sotdim uchun ishlatilgan" }
        }
        return { duplicate: true as const, operation: replay, payable: replay.supplierPayable }
      }
      const imeiValues = [imei, secondaryImei].filter((value): value is string => Boolean(value))
      const existingImei = await tx.device.findFirst({
        where: { shopId, deletedAt: null, OR: [{ imei: { in: imeiValues } }, { imeis: { some: { normalizedValue: { in: imeiValues }, deletedAt: null } } }] },
        select: { id: true },
      })
      if (existingImei) throw { status: 409, message: 'Bu IMEI raqami allaqachon mavjud' }

      const deviceStatus = d.customerDealType === 'NASIYA'
        ? 'SOLD_NASIYA' as const
        : ((d.paidFully ? 0 : (d.salePrice! - (d.amountPaid ?? 0))) > 0 ? 'SOLD_DEBT' as const : 'SOLD_CASH' as const)
      const device = await tx.device.create({
        data: {
          shopId, model: d.model, color: d.color, storage, storageAmount: d.storageAmount,
          storageUnit: d.storageUnit, batteryHealth: d.batteryHealth,
          purchasePrice: purchaseInput.amountUzs, purchaseCurrency: purchaseInput.inputCurrency,
          purchaseInputAmount: d.purchasePrice, purchaseExchangeRateAtCreation: purchaseInput.exchangeRateUsed,
          purchaseAmountUzsSnapshot: purchaseInput.amountUzs, imei, supplierPhone: d.supplierPhone,
          imageUrls: imageKeys as string[], status: deviceStatus, addedBy: session.user.id,
          note: d.deviceNote, condition: d.conditionCode === 'NEW' ? 'Yangi' : 'B/U',
          conditionCode: d.conditionCode, isExternalSourced: true,
          imeis: { create: [
            { slot: 'PRIMARY', value: imei, normalizedValue: imei },
            ...(secondaryImei ? [{ slot: 'SECONDARY' as const, value: secondaryImei, normalizedValue: secondaryImei }] : []),
          ] },
        },
        include: { imeis: { where: { deletedAt: null } } },
      })

      let customer: { id: string; name: string; phone: string }
      let sale: { id: string } | null = null
      let nasiya: { id: string } | null = null
      let saleProfit: number | null = null
      if (d.customerDealType === 'SALE') {
        customer = await resolveCustomerSelection(tx, {
          shopId, mode: d.customerMode, customerId: d.customerId, customerName: d.customerName,
          customerPhone: d.customerPhone,
        })
        const contractCurrency = saleInput!.inputCurrency
        const contractSalePrice = roundContractMoney(d.salePrice!, contractCurrency)
        const rawPaid = d.paidFully ? d.salePrice! : (d.amountPaid ?? 0)
        const contractPaid = roundContractMoney(rawPaid, contractCurrency)
        const contractRemaining = contractSalePrice - contractPaid
        const margin = computeSaleContractMargin(contractSalePrice, contractCurrency, saleInput!.exchangeRateUsed, {
          purchaseCurrency: purchaseInput.inputCurrency,
          purchaseInputAmount: d.purchasePrice,
          purchaseAmountUzsSnapshot: purchaseInput.amountUzs,
        })
        if (margin === null) throw { status: 409, message: "Qurilma tannarxini shartnoma valyutasida aniq ajratib bo'lmadi" }
        saleProfit = margin
        const componentPlan = buildSaleComponentPlan({ currency: contractCurrency, salePrice: contractSalePrice, costBasisAmount: contractSalePrice - margin })
        const initialComponents = contractPaid > 0 ? allocateCumulativePaymentComponents({
          currency: contractCurrency, totals: componentPlan, paid: { principal: 0, margin: 0, interest: 0 }, paymentAmount: contractPaid,
        }) : null
        const saleRow = await tx.sale.create({
          data: {
            shopId, deviceId: device.id, customerId: customer.id, salePrice: saleInput!.amountUzs,
            paymentMethod: contractPaid > 0 ? (d.paymentBreakdown ? representativePaymentMethod(d.paymentBreakdown) : d.paymentMethod) : null,
            paidFully: contractRemaining <= 0, amountPaid: salePaidInput?.amountUzs ?? 0,
            remainingAmount: Math.max(0, saleInput!.amountUzs - (salePaidInput?.amountUzs ?? 0)),
            dueDate: contractRemaining > 0 ? d.dueDate : null,
            reminderEnabled: contractRemaining > 0 && (d.customerReminderEnabled ?? false),
            earlyReminderEnabled: contractRemaining > 0 && (d.customerReminderEnabled ?? false) && (d.customerEarlyReminderEnabled ?? false),
            earlyReminderDays: contractRemaining > 0 && d.customerReminderEnabled && d.customerEarlyReminderEnabled
              ? d.customerEarlyReminderDays
              : null,
            note: d.note, createdBy: session.user.id, creationIdempotencyKey: idempotencyKey,
            creationCommandHash: commandHash, creationCurrency: contractCurrency,
            creationExchangeRate: saleInput!.exchangeRateUsed, contractCurrency,
            contractExchangeRateAtCreation: saleInput!.exchangeRateUsed, contractSalePrice,
            contractAmountPaid: contractPaid, contractRemainingAmount: contractRemaining,
            contractCostBasisAmount: componentPlan.principal, contractMarginAmount: componentPlan.margin,
            contractPrincipalPaidAmount: initialComponents?.paidAfter.principal ?? 0,
            contractMarginPaidAmount: initialComponents?.paidAfter.margin ?? 0,
            accountingReconstructionStatus: 'COMPLETE', accountingReconstructedAt: new Date(),
          },
        })
        sale = saleRow
        if (contractPaid > 0) {
          const reporting = splitUzsReportingAmount({ amountUzs: salePaidInput!.amountUzs, contractAmount: contractPaid, contractComponents: initialComponents!.allocation })
          await tx.salePayment.create({
            data: {
              saleId: saleRow.id, shopId, amount: salePaidInput!.amountUzs,
              paymentMethod: d.paymentBreakdown ? representativePaymentMethod(d.paymentBreakdown) : d.paymentMethod!,
              paymentBreakdown: d.paymentBreakdown ?? undefined, paidAt: new Date(),
              note: contractRemaining > 0 ? "Boshlang'ich to'lov" : "To'liq to'lov",
              idempotencyKey: `${idempotencyKey}:customer-initial`, createdBy: session.user.id,
              paymentInputAmount: rawPaid, paymentInputCurrency: salePaidInput!.inputCurrency,
              paymentExchangeRate: salePaidInput!.exchangeRateUsed, appliedAmountInContractCurrency: contractPaid,
              contractPrincipalAmount: initialComponents!.allocation.principal, contractMarginAmount: initialComponents!.allocation.margin,
              principalAmountUzs: reporting.principal, marginAmountUzs: reporting.margin,
            },
          })
        }
      } else {
        const core = await createNasiyaContractCore({
          tx, shopId, device, reserveInStockDevice: false, prepared: preparedNasiya!,
          customer: {
            mode: d.customerMode, customerId: d.customerId, customerName: d.customerName, customerPhone: d.customerPhone,
            customerAdditionalPhones: d.customerAdditionalPhones, customerNote: d.customerNote,
            customerPassportIdentifier: d.customerPassportIdentifier, customerTrustOverride: d.customerTrustOverride,
            passportPhotoUrl: passportPhotoKey,
          },
          months: d.months!, startDate: d.startDate!, paymentMethod: d.nasiyaPaymentMethod!,
          earlyReminderEnabled: d.customerEarlyReminderEnabled, earlyReminderDays: d.customerEarlyReminderDays,
          note: d.note, actorId: session.user.id, paymentFxQuoteColumnsAvailable,
        })
        customer = core.customer
        nasiya = core.nasiya
      }

      const operation = await tx.olibSotdimOperation.create({
        data: {
          shopId, deviceId: device.id, customerId: customer.id, dealType: d.customerDealType,
          saleId: sale?.id, nasiyaId: nasiya?.id, createdBy: session.user.id,
          creationIdempotencyKey: idempotencyKey, creationCommandHash: commandHash,
        },
      })
      const payable = await createSupplierPayableCore({
        tx, shopId, deviceId: device.id, saleId: sale?.id, olibSotdimOperationId: operation.id,
        origin: 'OLIB_SOTDIM', supplierName: d.supplierName, supplierPhone: d.supplierPhone,
        supplierLocation: d.supplierLocation, supplierNote: d.supplierNote, purchaseInput,
        contractAmount: roundContractMoney(d.purchasePrice, purchaseInput.inputCurrency),
        dueDate: d.supplierPaidNow ? (d.supplierPaidDate ?? new Date()) : d.supplierDueDate!,
        reminderEnabled: !d.supplierPaidNow && (d.supplierReminderEnabled ?? true),
        earlyReminderEnabled: !d.supplierPaidNow && d.earlyReminderEnabled,
        earlyReminderDays: d.earlyReminderDays,
        initialPayment: supplierInitialInput && d.supplierPaymentMethod ? {
          rawAmount: supplierInitialRaw, converted: supplierInitialInput,
          paymentMethod: d.supplierPaymentMethod, paymentBreakdown: d.supplierPaymentBreakdown,
          paidAt: d.supplierPaidDate ?? new Date(), note: d.supplierPaidNow ? "To'liq to'lov" : "Boshlang'ich to'lov",
        } : undefined,
        actorId: session.user.id, commandHash, idempotencyScope: idempotencyKey,
      })

      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true } })
      const recipients = await resolveTelegramRecipients(tx, { shopId, audience: TELEGRAM_AUDIENCES.OWNER_ONLY })
      const message = d.customerDealType === 'NASIYA'
        ? olibSotdimNasiyaCreatedMessage({
            shopName: shop?.name ?? '', device: presentDeviceSpecs(device), supplierName: d.supplierName,
            supplierPhone: d.supplierPhone, supplierLocation: d.supplierLocation,
            purchasePrice: d.purchasePrice, purchaseCurrency: purchaseInput.inputCurrency,
            supplierRemainingAmount: Number(payable.contractRemainingAmount), customerName: customer.name,
            customerPhone: customer.phone, totalAmount: preparedNasiya!.contractAmounts.totalAmount,
            downPayment: preparedNasiya!.contractAmounts.downPayment,
            finalNasiyaAmount: preparedNasiya!.contractAmounts.finalNasiyaAmount, months: d.months!,
            monthlyPayment: preparedNasiya!.contractAmounts.monthlyPayment,
            nextPaymentDate: preparedNasiya!.contractScheduleItems[0]?.dueDate,
            nasiyaCurrency: preparedNasiya!.totalInput.inputCurrency, adminName: session.user.name, currency,
          })
        : olibSotdimCreatedMessage({
            shopName: shop?.name ?? '', device: presentDeviceSpecs(device), supplierName: d.supplierName,
            supplierPhone: d.supplierPhone, supplierLocation: d.supplierLocation,
            purchasePrice: d.purchasePrice, salePrice: d.salePrice!, profit: saleProfit!,
            contractCurrency: saleInput!.inputCurrency, purchaseCurrency: purchaseInput.inputCurrency,
            saleCurrency: saleInput!.inputCurrency, supplierPaidNow: payable.status === 'PAID',
            customerName: customer.name, customerPhone: customer.phone, adminName: session.user.name, currency,
          })
      const scheduledAt = new Date()
      const notificationRows = [
        ...telegramNotificationRows(recipients, { type: d.customerDealType === 'NASIYA' ? 'OLIB_SOTDIM_NASIYA_CREATED' : 'OLIB_SOTDIM_CREATED', message, scheduledAt, relatedId: operation.id, relatedType: 'OlibSotdimOperation' }),
        ...telegramUnavailableMarkerRows(recipients, { type: d.customerDealType === 'NASIYA' ? 'OLIB_SOTDIM_NASIYA_CREATED' : 'OLIB_SOTDIM_CREATED', dedupeScope: operation.id, cancelledAt: scheduledAt }),
      ]
      if (notificationRows.length) await tx.notification.createMany({ data: notificationRows })
      await tx.log.create({
        data: {
          shopId, actorId: session.user.id, actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: d.customerDealType === 'NASIYA' ? 'OLIB_SOTDIM_NASIYA_CREATE' : 'OLIB_SOTDIM_CREATE',
          targetType: 'OlibSotdimOperation', targetId: operation.id,
          newValue: {
            dealType: d.customerDealType, deviceId: device.id, model: d.model, imei,
            supplierName: d.supplierName, supplierPayableId: payable.id,
            supplierStatus: payable.status, customerId: customer.id,
            customerOutcomeId: sale?.id ?? nasiya?.id, purchasePrice: purchaseInput.amountUzs,
            ...moneyInputMeta(purchaseInput),
          },
        },
      })
      return { duplicate: false as const, operation, payable }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof run>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { result = await run(); break } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 2) continue
        throw error
      }
    }
    if (!result) return serverError()
    if (!result.duplicate) {
      if (d.customerDealType === 'NASIYA') invalidateShopNasiyaMutation(shopId)
      else invalidateShopSaleMutation(shopId)
      invalidateShopSupplierPayableMutation(shopId)
    }
    after(() => flushQueuedTelegramWork().catch((error) => logger.warn('notification flush failed', { event: 'notification.flush_failed', route: '/api/olib-sotdim', error })))
    const response = {
      operationId: result.operation.id,
      deviceId: result.operation.deviceId,
      dealType: result.operation.dealType,
      saleId: result.operation.saleId,
      nasiyaId: result.operation.nasiyaId,
      payableId: result.payable.id,
      payableStatus: result.payable.status,
    }
    return result.duplicate ? ok(response, "Olib-sotdim allaqachon saqlangan") : created(response, "Olib-sotdim muvaffaqiyatli saqlandi")
  } catch (error) {
    if (error instanceof CustomerPassportConfigurationError) return serverError("Pasport ma'lumotlarini saqlash sozlanmagan")
    if (error instanceof CustomerSelectionError) {
      if (error.status === 404) return notFound(error.message)
      if (error.status === 409) return conflict(error.message)
      return badRequest(error.message)
    }
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const typed = error as { status: number; message: string }
      if (typed.status === 403) return forbidden(typed.message)
      if (typed.status === 404) return notFound(typed.message)
      if (typed.status === 409) return conflict(typed.message)
      return badRequest(typed.message)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict("Bu IMEI, mijoz yoki Idempotency-Key allaqachon ishlatilgan")
    }
    logger.error('[POST /api/olib-sotdim]', { event: 'api.route_error', error })
    return serverError()
  }
}
