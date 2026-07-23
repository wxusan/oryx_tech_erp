/**
 * GET  /api/devices — list devices for the authenticated shop
 * POST /api/devices — add a new device to the shop
 *
 * Both routes require SHOP_ADMIN (or SUPER_ADMIN) authentication.
 * Shop admins can only see/add devices for their own shop.
 */

import { createHash } from 'node:crypto'
import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopAnyPermission, requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { addDeviceSchema } from '@/lib/validations'
import { ok, created, badRequest, conflict, forbidden, serverError } from '@/lib/api-helpers'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { deviceAddedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopDeviceMutation, invalidateShopSupplierPayableMutation } from '@/lib/server/cache-tags'
import { createMoneyInputConverter, moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { buildShopDevicesWhere, getShopDeviceListItemsByIds, getShopDevicesList, type DeviceStatusFilter } from '@/lib/server/shop-lists'
import { latestChangeCursorForShop } from '@/lib/server/change-events'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'
import type { ZodError } from 'zod'
import { formatDeviceStorage, deviceConditionLabel, normalizeImei } from '@/lib/device-specs'
import { displayImei } from '@/lib/device-display'
import { enabledFeatureSet, getActiveShopPackage, getLiveShopPrincipalForMutation, principalHasPermission } from '@/lib/server/shop-access'
import { computeSaleContractMargin } from '@/lib/nasiya-contract'
import { resolveTelegramRecipients, telegramNotificationRows, telegramUnavailableMarkerRows, TELEGRAM_AUDIENCES } from '@/lib/server/telegram-recipients'
import {
  createSupplierPayableCore,
  supplierPayableCreationIdempotencyKey,
} from '@/lib/server/supplier-payable-payments'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { representativePaymentMethod, validatePaymentBreakdown } from '@/lib/payment-breakdown'
import { prepareSearchNeedle } from '@/lib/search-needle'
import { searchMatchEvidence } from '@/lib/search-match-evidence'
import { canonicalPaymentBreakdown } from '@/lib/idempotency-replay'

const deviceStatuses = ['IN_STOCK', 'SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA', 'RETURNED', 'DELETED'] as const

// ---------------------------------------------------------------------------
// GET /api/devices
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const isReturnPicker = searchParams.get('view') === 'return-picker'
    const actionPickerPurpose = searchParams.get('view') === 'action-picker' ? searchParams.get('purpose') : null
    const pickerPurpose = searchParams.get('view') === 'picker' ? searchParams.get('purpose') : null
    if (searchParams.get('view') === 'picker' && pickerPurpose !== 'sale' && pickerPurpose !== 'nasiya') {
      return badRequest("Qurilma tanlash maqsadi noto'g'ri")
    }
    if (searchParams.get('view') === 'action-picker' && actionPickerPurpose !== 'device' && actionPickerPurpose !== 'sale') {
      return badRequest("Amal tanlash maqsadi noto'g'ri")
    }
    const guarded = isReturnPicker
      ? await requireShopAnyPermission(['SALE_RETURN_REFUND'])
      : actionPickerPurpose === 'device'
        ? await requireShopAnyPermission(['DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK'])
        : actionPickerPurpose === 'sale'
          ? await requireShopAnyPermission(['SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'])
      : pickerPurpose
        ? await requireShopPermission(pickerPurpose === 'sale' ? 'SALE_CREATE' : 'NASIYA_CREATE')
        : await requireShopPermission('INVENTORY_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeOwnerFinancials =
      session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'

    // Super admins can pass an explicit shopId; shop admins are scoped to their own shop.
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const statusParam = searchParams.get('status') ?? undefined
    if (statusParam && !deviceStatuses.includes(statusParam as (typeof deviceStatuses)[number])) {
      return badRequest("Qurilma statusi noto'g'ri")
    }
    const status = statusParam as (typeof deviceStatuses)[number] | undefined
    const conditionParam = searchParams.get('condition') ?? undefined
    if (conditionParam && conditionParam !== 'NEW' && conditionParam !== 'USED') return badRequest("Qurilma holati noto'g'ri")
    const preparedSearch = prepareSearchNeedle(searchParams.get('search'))
    if (preparedSearch.exceedsMaxLength) return badRequest('Qidiruv 100 ta belgidan oshmasligi kerak')
    const search = preparedSearch.query || undefined // IMEI / model / color / note / customer name/phone

    if (actionPickerPurpose) {
      const can = (permission: 'DEVICE_EDIT' | 'DEVICE_DELETE' | 'DEVICE_RESTOCK' | 'SALE_VIEW' | 'SALE_EDIT' | 'SALE_REMINDER_MANAGE') => (
        session.user.role === 'SUPER_ADMIN' || Boolean(
          guarded.principal && principalHasPermission(guarded.principal, permission),
        )
      )
      const statuses = actionPickerPurpose === 'device'
        ? [
            ...(can('DEVICE_EDIT') || can('DEVICE_DELETE') ? ['IN_STOCK'] as const : []),
            ...(can('DEVICE_RESTOCK') ? ['RETURNED'] as const : []),
          ]
        : (can('SALE_VIEW') || can('SALE_EDIT')
            ? ['SOLD_CASH', 'SOLD_DEBT'] as const
            : ['SOLD_DEBT'] as const)
      const requestedTake = Number(searchParams.get('take') ?? 25)
      const requestedSkip = Number(searchParams.get('skip') ?? 0)
      const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 50)) : 25
      const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
      const where = {
        ...buildShopDevicesWhere(shopId, { search }),
        status: { in: [...statuses] },
      }
      const [rows, total] = await Promise.all([
        prisma.device.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
          select: {
            id: true,
            model: true,
            color: true,
            storage: true,
            imei: true,
            imeis: {
              where: { deletedAt: null },
              orderBy: { slot: 'asc' },
              select: { slot: true, value: true },
            },
            status: true,
            createdAt: true,
            // These never leave the server. They are only used to calculate
            // the sale margin for the shop owner below.
            purchaseCurrency: true,
            purchaseInputAmount: true,
            purchaseAmountUzsSnapshot: true,
            ...(actionPickerPurpose === 'sale'
              ? {
                  sales: {
                    where: { deletedAt: null, returnedAt: null },
                    orderBy: { createdAt: 'desc' as const },
                    take: 1,
                    select: {
                      id: true,
                      dueDate: true,
                      reminderEnabled: true,
                      contractCurrency: true,
                      contractSalePrice: true,
                      contractRemainingAmount: true,
                      contractExchangeRateAtCreation: true,
                      paymentMethod: true,
                      paidFully: true,
                      createdAt: true,
                      customer: { select: { name: true, phone: true, additionalPhones: true } },
                    },
                  },
                }
              : {}),
          },
        }),
        prisma.device.count({ where }),
      ])
      return ok({
        items: rows.map((row) => {
          const sale = 'sales' in row
            ? row.sales[0] as (typeof row.sales)[number] & {
                customer: { name: string; phone: string; additionalPhones: string[] }
              }
            : null
          const contractProfit = includeOwnerFinancials && sale
            ? computeSaleContractMargin(
                Number(sale.contractSalePrice),
                sale.contractCurrency,
                sale.contractExchangeRateAtCreation == null ? null : Number(sale.contractExchangeRateAtCreation),
                {
                  purchaseCurrency: row.purchaseCurrency,
                  purchaseInputAmount: Number(row.purchaseInputAmount),
                  purchaseAmountUzsSnapshot: Number(row.purchaseAmountUzsSnapshot),
                },
              )
            : undefined

          return {
            id: row.id,
            model: row.model,
            color: row.color,
            storage: row.storage,
            imei: displayImei(row.imei),
            status: row.status,
            createdAt: row.createdAt,
            ...(search
              ? {
                  matchEvidence: searchMatchEvidence(search, [
                    {
                      field: 'SECONDARY_IMEI',
                      value: row.imeis.find((entry) => entry.slot === 'SECONDARY')?.value,
                      mode: 'identifier',
                    },
                    ...(sale?.customer.additionalPhones ?? []).map((value) => ({
                      field: 'ADDITIONAL_PHONE' as const,
                      value,
                      mode: 'identifier' as const,
                      exposeValue: false,
                    })),
                  ]),
                }
              : {}),
            ...('sales' in row
              ? {
                  sale: sale
                    ? {
                        ...sale,
                        customer: {
                          name: sale.customer.name,
                          phone: sale.customer.phone,
                        },
                        ...(includeOwnerFinancials ? { contractProfit } : {}),
                      }
                    : null,
                }
              : {}),
          }
        }),
        total,
        skip,
        take,
      })
    }

    if (isReturnPicker) {
      const canReturnSale = session.user.role === 'SUPER_ADMIN' || Boolean(
        guarded.principal && principalHasPermission(guarded.principal, 'SALE_RETURN_REFUND'),
      )
      const eligibleStatuses = [
        ...(canReturnSale ? ['SOLD_CASH', 'SOLD_DEBT'] as const : []),
      ]
      const requestedTake = Number(searchParams.get('take') ?? 25)
      const requestedSkip = Number(searchParams.get('skip') ?? 0)
      const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 50)) : 25
      const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
      const where = {
        ...buildShopDevicesWhere(shopId, { search }),
        status: { in: [...eligibleStatuses] },
      }
      const [rows, total] = await Promise.all([
        prisma.device.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
          select: {
            id: true,
            model: true,
            color: true,
            storage: true,
            imei: true,
            imeis: {
              where: { deletedAt: null },
              orderBy: { slot: 'asc' },
              select: { slot: true, value: true },
            },
            status: true,
            sales: {
              where: { deletedAt: null, returnedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, contractCurrency: true, customer: { select: { name: true, phone: true, additionalPhones: true } } },
            },
            nasiya: {
              where: { deletedAt: null, returnedAt: null, status: { not: 'CANCELLED' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, contractCurrency: true, customer: { select: { name: true, phone: true, additionalPhones: true } } },
            },
          },
        }),
        prisma.device.count({ where }),
      ])
      return ok({
        items: rows.map((row) => {
          const contract = row.sales[0] ?? row.nasiya[0]
          return {
            id: row.id,
            model: row.model,
            color: row.color,
            storage: row.storage,
            imei: displayImei(row.imei),
            status: row.status,
            contractType: row.sales[0] ? 'SALE' as const : 'NASIYA' as const,
            contractId: contract?.id ?? null,
            contractCurrency: contract?.contractCurrency ?? 'UZS',
            customer: contract?.customer
              ? { name: contract.customer.name, phone: contract.customer.phone }
              : null,
            ...(search
              ? {
                  matchEvidence: searchMatchEvidence(search, [
                    {
                      field: 'SECONDARY_IMEI',
                      value: row.imeis.find((entry) => entry.slot === 'SECONDARY')?.value,
                      mode: 'identifier',
                    },
                    ...(contract?.customer.additionalPhones ?? []).map((value) => ({
                      field: 'ADDITIONAL_PHONE' as const,
                      value,
                      mode: 'identifier' as const,
                      exposeValue: false,
                    })),
                  ]),
                }
              : {}),
          }
        }),
        total,
        skip,
        take,
      })
    }

    // Sale and nasiya forms need only a tiny searchable stock projection.
    // Keeping this separate from the full device-list projection avoids joins
    // to sales, nasiyas, returns and suppliers for every keystroke.
    if (searchParams.get('view') === 'picker') {
      const requestedTake = Number(searchParams.get('take') ?? 25)
      const requestedSkip = Number(searchParams.get('skip') ?? 0)
      const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 50)) : 25
      const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
      // The picker and full inventory list share one tenant-scoped predicate,
      // so model/IMEI 1+2/storage/note/supplier search cannot drift. The
      // picker adds the stricter IN_STOCK cohort and keeps its small DTO.
      const pickerWhere = buildShopDevicesWhere(shopId, { search, status: 'IN_STOCK' })

      const [rows, total] = await Promise.all([
        prisma.device.findMany({
          where: pickerWhere,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: {
            id: true,
            model: true,
            color: true,
            storage: true,
            storageAmount: true,
            storageUnit: true,
            conditionCode: true,
            batteryHealth: true,
            purchasePrice: true,
            imei: true,
            imeis: { where: { deletedAt: null }, select: { slot: true, value: true } },
            status: true,
          },
        }),
        prisma.device.count({ where: pickerWhere }),
      ])

      return ok(
        {
          items: rows.map(({ purchasePrice, ...device }) => ({
            ...device,
            ...(includeOwnerFinancials ? { purchasePrice: Number(purchasePrice) } : {}),
            storageDisplay: formatDeviceStorage(device) || null,
            secondaryImei: device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
            conditionLabel: deviceConditionLabel(device.conditionCode),
            ...(search
              ? {
                  matchEvidence: searchMatchEvidence(search, [{
                    field: 'SECONDARY_IMEI',
                    value: device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value,
                    mode: 'identifier',
                  }]),
                }
              : {}),
          })),
          total,
          skip,
          take,
        },
        "Qurilmalar ro'yxati",
      )
    }

    // The canonical response is always a bounded page envelope. `paginated=1`
    // remains harmless for older links, but no consumer can accidentally fall
    // back to the former wide, reduced-field array response.
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
    const { items, total } = await getShopDevicesList(shopId, {
      search,
      status: status as DeviceStatusFilter | undefined,
      condition: conditionParam as 'NEW' | 'USED' | undefined,
      skip,
      take,
    }, { includeOwnerFinancials })
    return ok({ items, total, skip, take }, "Qurilmalar ro'yxati")
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const typed = err as { status: number; message: string }
      if (typed.status === 403) return forbidden(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    logger.error('[GET /api/devices]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// POST /api/devices
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission(['DEVICE_CREATE', 'DEVICE_PURCHASE_ON_CREDIT'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeOwnerFinancials =
      session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'

    const body: unknown = await req.json()

    const parsed = addDeviceSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const purchaseSettlement = parsed.data.purchaseSettlement
    const requiredPermission = purchaseSettlement === 'PAY_LATER' ? 'DEVICE_PURCHASE_ON_CREDIT' : 'DEVICE_CREATE'
    if (
      session.user.role !== 'SUPER_ADMIN' &&
      (!guarded.principal || !principalHasPermission(guarded.principal, requiredPermission))
    ) return forbidden("Bu amal uchun ruxsat berilmagan")
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Qurilma xaridi uchun Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }

    const {
      model, color, storageAmount, storageUnit, conditionCode, batteryHealth, purchasePrice,
      supplierName, supplierPhone, note, imageUrls,
    } = parsed.data
    const storage = formatDeviceStorage({ storageAmount, storageUnit })
    const imei = normalizeImei(parsed.data.imei)!
    const secondaryImei = parsed.data.secondaryImei ? normalizeImei(parsed.data.secondaryImei) : null

    const resolved = await resolveActiveShopId(
      session,
      session.user.role === 'SUPER_ADMIN' ? (body as { shopId?: string }).shopId : session.user.shopId,
    )
    if (!resolved.ok) return resolved.response
    const resolvedShopId = resolved.shopId
    const commandHash = createHash('sha256').update(JSON.stringify({
      version: 2,
      shopId: resolvedShopId,
      actorId: session.user.id,
      command: {
        model,
        color,
        storageAmount,
        storageUnit,
        conditionCode,
        batteryHealth: batteryHealth ?? null,
        purchasePrice,
        inputCurrency: parsed.data.inputCurrency,
        imei,
        secondaryImei,
        supplierName: supplierName ?? null,
        supplierPhone: supplierPhone ?? null,
        purchaseSettlement,
        supplierDueDate: parsed.data.supplierDueDate?.toISOString() ?? null,
        supplierInitialPaymentAmount: parsed.data.supplierInitialPaymentAmount ?? null,
        supplierPaymentMethod: parsed.data.supplierPaymentMethod ?? null,
        supplierPaymentBreakdown: canonicalPaymentBreakdown(
          parsed.data.supplierPaymentBreakdown,
          parsed.data.inputCurrency,
        ),
        supplierReminderEnabled: parsed.data.supplierReminderEnabled ?? null,
        earlyReminderEnabled: parsed.data.earlyReminderEnabled ?? null,
        earlyReminderDays: parsed.data.earlyReminderDays ?? null,
        note: note ?? null,
        imageUrls: imageUrls ?? [],
      },
    })).digest('hex')
    const payableCreationIdempotencyKey = supplierPayableCreationIdempotencyKey(
      'DEVICE_PURCHASE',
      idempotencyKey,
    )

    const lookupAcquisitionReplay = async (db: Prisma.TransactionClient) => {
      const receipt = await db.devicePurchaseReceipt.findUnique({
        where: { shopId_idempotencyKey: { shopId: resolvedShopId, idempotencyKey } },
        select: { id: true, deviceId: true, actorId: true, commandHash: true },
      })
      const payable = await db.supplierPayable.findUnique({
        where: {
          shopId_creationIdempotencyKey: {
            shopId: resolvedShopId,
            creationIdempotencyKey: payableCreationIdempotencyKey,
          },
        },
        select: { id: true, deviceId: true, status: true, createdBy: true, creationCommandHash: true, origin: true },
      })
      if (receipt && payable) {
        throw { status: 409, message: "Idempotency-Key bir nechta xarid daliliga bog'langan" }
      }
      if (receipt) {
        if (
          purchaseSettlement !== 'PAID_NOW' ||
          receipt.actorId !== session.user.id ||
          receipt.commandHash !== commandHash
        ) {
          throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan qurilma xaridi uchun ishlatilgan" }
        }
        return {
          deviceId: receipt.deviceId,
          payable: null,
          purchaseReceiptId: receipt.id,
          duplicate: true as const,
        }
      }
      if (payable) {
        if (
          purchaseSettlement !== 'PAY_LATER' ||
          payable.origin !== 'DEVICE_PURCHASE' ||
          payable.createdBy !== session.user.id ||
          payable.creationCommandHash !== commandHash
        ) {
          throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan qurilma xaridi uchun ishlatilgan" }
        }
        return {
          deviceId: payable.deviceId,
          payable,
          purchaseReceiptId: null,
          duplicate: true as const,
        }
      }
      return null
    }

    const replay = await lookupAcquisitionReplay(prisma)
    if (replay) {
      const [item, changeCursor] = await Promise.all([
        getShopDeviceListItemsByIds(resolvedShopId, [replay.deviceId], { includeOwnerFinancials }).then((items) => items[0]),
        latestChangeCursorForShop(resolvedShopId),
      ])
      if (!item) return serverError('Qurilma topilmadi. Sahifani yangilang.')
      return ok({
        id: replay.deviceId,
        item,
        purchaseReceiptId: replay.purchaseReceiptId,
        supplierPayableId: replay.payable?.id ?? null,
        supplierPayableStatus: replay.payable?.status ?? null,
        changeCursor,
        affectedDomains: replay.payable ? ['devices', 'debts', 'reports', 'logs'] : ['devices', 'reports', 'logs'],
        mutationId: `device.acquisition.replay:${replay.purchaseReceiptId ?? replay.payable?.id}`,
      }, "Qurilma xaridi allaqachon saqlangan")
    }

    const imageKeys = imageUrls?.map((value) => resolvePrivateUploadReference({
      value,
      shopId: resolvedShopId,
      kind: 'device',
      allowLegacyRawKey: true,
    })) ?? []
    if (imageKeys.some((key) => !key)) {
      return badRequest("Qurilma rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }
    let purchaseInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let supplierInitialInput: Awaited<ReturnType<typeof moneyInputToUzs>> | null = null
    const supplierInitialRaw = purchaseSettlement === 'PAY_LATER'
      ? (parsed.data.supplierInitialPaymentAmount ?? 0)
      : 0
    try {
      const convertMoney = await createMoneyInputConverter(parsed.data.inputCurrency)
      purchaseInput = convertMoney(purchasePrice)
      if (supplierInitialRaw > 0) supplierInitialInput = convertMoney(supplierInitialRaw)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }
    if (parsed.data.supplierPaymentBreakdown) {
      const breakdownError = validatePaymentBreakdown(
        parsed.data.supplierPaymentBreakdown,
        purchaseSettlement === 'PAID_NOW' ? purchasePrice : supplierInitialRaw,
        purchaseInput.inputCurrency,
      )
      if (breakdownError) return badRequest(breakdownError)
    }
    const effectivePurchasePaymentMethod = parsed.data.supplierPaymentBreakdown
      ? representativePaymentMethod(parsed.data.supplierPaymentBreakdown)
      : parsed.data.supplierPaymentMethod
    if (
      (purchaseSettlement === 'PAID_NOW' || supplierInitialRaw > 0) &&
      !effectivePurchasePaymentMethod
    ) {
      return badRequest("Pul to'langanda to'lov usuli kiritilishi shart")
    }
    const acquisitionPaidAt = new Date()
    const [shop, currency] = await Promise.all([
      prisma.shop.findUnique({ where: { id: resolvedShopId }, select: { name: true } }),
      getShopCurrencyContext(resolvedShopId),
    ])

    // Check active IMEI uniqueness within shop. Soft-deleted rows may be reused.
    const existing = await prisma.device.findFirst({
      where: {
        shopId: resolvedShopId,
        deletedAt: null,
        OR: [
          { imei: { in: [imei, secondaryImei].filter((value): value is string => Boolean(value)) } },
          { imeis: { some: { normalizedValue: { in: [imei, secondaryImei].filter((value): value is string => Boolean(value)) }, deletedAt: null } } },
        ],
      },
    })
    if (existing) return conflict("Bu IMEI raqami allaqachon mavjud")

    const run = () => prisma.$transaction(async (tx) => {
      if (session.user.role === 'SHOP_ADMIN') {
        const live = await getLiveShopPrincipalForMutation(tx, { shopId: resolvedShopId, actorId: session.user.id })
        if (!live || !principalHasPermission(live, requiredPermission)) {
          throw { status: 403, message: "Bu amal uchun ruxsat berilmagan" }
        }
      } else {
        const activePackage = await getActiveShopPackage(resolvedShopId, new Date(), tx)
        if (!enabledFeatureSet(activePackage).has('INVENTORY')) {
          throw { status: 403, message: "Ombor moduli do'kon paketida yoqilmagan" }
        }
      }
      // One shop-scoped lock spans both evidence tables, so the same key
      // cannot concurrently create a PAID_NOW receipt and a PAY_LATER payable.
      await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`device-acquisition:${resolvedShopId}:${idempotencyKey}`}, 0)
        )
      `)
      const replay = await lookupAcquisitionReplay(tx)
      if (replay) return replay
      let supplierId: string | undefined
      if (supplierName) {
        const supplier = await tx.supplier.create({
          data: { shopId: resolvedShopId, name: supplierName, phone: supplierPhone ?? '' },
        })
        supplierId = supplier.id
      }

      const createdDevice = await tx.device.create({
        data: {
          shopId: resolvedShopId,
          model, color, storage, storageAmount, storageUnit, conditionCode, condition: conditionCode === 'NEW' ? 'Yangi' : 'B/U', batteryHealth,
          purchasePrice: purchaseInput.amountUzs,
          // Native purchase-currency context — see docs/currency-accounting-model.md.
          purchaseCurrency: purchaseInput.inputCurrency,
          purchaseInputAmount: purchasePrice,
          purchaseExchangeRateAtCreation: purchaseInput.exchangeRateUsed,
          purchaseExchangeRateSource: purchaseInput.exchangeRateSource,
          purchaseExchangeRateEffectiveAt: purchaseInput.exchangeRateEffectiveAt,
          purchaseExchangeRateFetchedAt: purchaseInput.exchangeRateFetchedAt,
          purchaseAmountUzsSnapshot: purchaseInput.amountUzs,
          evidenceVersion: 2,
          evidenceStatus: 'CAPTURED',
          imei,
          supplierId,
          supplierPhone,
          imageUrls: imageKeys as string[],
          addedBy: session.user.id,
          note,
          imeis: {
            create: [
              { slot: 'PRIMARY', value: imei, normalizedValue: imei },
              ...(secondaryImei ? [{ slot: 'SECONDARY' as const, value: secondaryImei, normalizedValue: secondaryImei }] : []),
            ],
          },
        },
      })

      const purchaseReceipt = purchaseSettlement === 'PAID_NOW'
        ? await tx.devicePurchaseReceipt.create({
            data: {
              shopId: resolvedShopId,
              deviceId: createdDevice.id,
              inputAmount: purchasePrice,
              inputCurrency: purchaseInput.inputCurrency,
              nativeAmount: purchasePrice,
              nativeCurrency: purchaseInput.inputCurrency,
              amountUzsSnapshot: purchaseInput.amountUzs,
              paymentMethod: effectivePurchasePaymentMethod!,
              paymentBreakdown: parsed.data.supplierPaymentBreakdown,
              exchangeRate: purchaseInput.exchangeRateUsed,
              exchangeRateSource: purchaseInput.exchangeRateSource,
              exchangeRateEffectiveAt: purchaseInput.exchangeRateEffectiveAt,
              exchangeRateFetchedAt: purchaseInput.exchangeRateFetchedAt,
              paidAt: acquisitionPaidAt,
              actorId: session.user.id,
              actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
              idempotencyKey,
              commandHash,
              evidenceVersion: 2,
              evidenceStatus: 'CAPTURED',
            },
            select: { id: true },
          })
        : null

      const payable = purchaseSettlement === 'PAY_LATER'
        ? await createSupplierPayableCore({
            tx,
            shopId: resolvedShopId,
            deviceId: createdDevice.id,
            supplierId,
            origin: 'DEVICE_PURCHASE',
            supplierName: supplierName!,
            supplierPhone: supplierPhone!,
            purchaseInput,
            contractAmount: purchasePrice,
            dueDate: parsed.data.supplierDueDate!,
            reminderEnabled: parsed.data.supplierReminderEnabled ?? true,
            earlyReminderEnabled: parsed.data.earlyReminderEnabled ?? false,
            earlyReminderDays: parsed.data.earlyReminderDays,
            initialPayment: supplierInitialInput && effectivePurchasePaymentMethod ? {
              rawAmount: supplierInitialRaw,
              converted: supplierInitialInput,
              paymentMethod: effectivePurchasePaymentMethod,
              paymentBreakdown: parsed.data.supplierPaymentBreakdown,
              paidAt: acquisitionPaidAt,
              note: "Boshlang'ich to'lov",
            } : undefined,
            actorId: session.user.id,
            commandHash,
            idempotencyScope: idempotencyKey,
          })
        : null

      await tx.log.create({
        data: {
          shopId: resolvedShopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: payable ? 'CREATE_DEVICE_PAY_LATER' : 'CREATE',
          targetType: 'Device',
          targetId: createdDevice.id,
          newValue: {
            model,
            imei,
            purchasePrice: purchaseInput.amountUzs,
            purchaseReceiptId: purchaseReceipt?.id ?? null,
            purchasePaymentMethod: effectivePurchasePaymentMethod ?? null,
            purchasePaymentBreakdown: parsed.data.supplierPaymentBreakdown ?? null,
            ...(payable ? {
              supplierPayableId: payable.id,
              supplierName: payable.supplierName,
              supplierDueDate: payable.dueDate,
              supplierRemainingAmount: Number(payable.contractRemainingAmount),
              supplierStatus: payable.status,
            } : {}),
            ...moneyInputMeta(purchaseInput),
          },
        },
      })
      if (payable) {
        await tx.log.create({
          data: {
            shopId: resolvedShopId,
            actorId: session.user.id,
            actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
            action: 'CREATE_SUPPLIER_PAYABLE',
            targetType: 'SupplierPayable',
            targetId: payable.id,
            newValue: {
              origin: payable.origin,
              deviceId: createdDevice.id,
              supplierName: payable.supplierName,
              supplierPhone: payable.supplierPhone,
              dueDate: payable.dueDate,
              contractCurrency: payable.contractCurrency,
              contractAmount: Number(payable.contractAmount),
              contractPaidAmount: Number(payable.contractPaidAmount),
              contractRemainingAmount: Number(payable.contractRemainingAmount),
              status: payable.status,
            },
          },
        })
      }

      // The device-added template includes purchase cost, so the shared
      // resolver deliberately targets only the owner.
      const recipients = await resolveTelegramRecipients(tx, {
        shopId: resolvedShopId,
        audience: TELEGRAM_AUDIENCES.OWNER_ONLY,
      })
      const scheduledAt = new Date()
      const notificationMessage = deviceAddedMessage({
        shopName: shop?.name ?? '',
        device: { deviceModel: model, storage, color, batteryHealth, imei, secondaryImei, conditionLabel: conditionCode === 'NEW' ? 'Yangi' : 'Ishlatilgan' },
        purchasePrice,
        purchaseCurrency: purchaseInput.inputCurrency,
        supplierPhone,
        supplierRemainingAmount: payable ? Number(payable.contractRemainingAmount) : null,
        supplierDueDate: payable?.dueDate,
        adminName: session.user.name,
        currency,
      })
      const notificationRows = [
        ...telegramNotificationRows(recipients, {
          type: 'DEVICE_CREATED',
          message: notificationMessage,
          scheduledAt,
          relatedId: createdDevice.id,
          relatedType: 'Device',
        }),
        ...telegramUnavailableMarkerRows(recipients, {
          type: 'DEVICE_CREATED',
          dedupeScope: createdDevice.id,
          cancelledAt: scheduledAt,
        }),
      ]
      if (notificationRows.length) {
        await tx.notification.createMany({
          data: notificationRows,
        })
      }

      return {
        deviceId: createdDevice.id,
        payable,
        purchaseReceiptId: purchaseReceipt?.id ?? null,
        duplicate: false as const,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof run>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { result = await run(); break } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const duplicate = await lookupAcquisitionReplay(prisma)
          if (duplicate) {
            result = duplicate
            break
          }
        }
        if (isRetryableTransactionError(error) && attempt < 2) continue
        throw error
      }
    }
    if (!result) return serverError()

    if (!result.duplicate) {
      invalidateShopDeviceMutation(resolvedShopId)
      if (result.payable) invalidateShopSupplierPayableMutation(resolvedShopId)
    }

    // Deliver notifications after the response is sent (non-blocking) so the
    // add-device request never waits on Telegram HTTP calls.
    if (!result.duplicate) {
      after(async () => {
        try {
          await flushQueuedTelegramWork()
        } catch (e) {
          logger.warn('device create notification failed', {
            event: 'notification.flush_failed',
            route: '/api/devices',
            error: e,
          })
        }
      })
    }

    const [item, changeCursor] = await Promise.all([
      getShopDeviceListItemsByIds(resolvedShopId, [result.deviceId], { includeOwnerFinancials }).then((items) => items[0]),
      latestChangeCursorForShop(resolvedShopId),
    ])
    if (!item) throw new Error('CREATED_DEVICE_DTO_NOT_FOUND')
    const responseData = {
      id: result.deviceId,
      item,
      purchaseReceiptId: result.purchaseReceiptId,
      supplierPayableId: result.payable?.id ?? null,
      supplierPayableStatus: result.payable?.status ?? null,
      changeCursor,
      affectedDomains: result.payable ? ['devices', 'debts', 'reports', 'logs'] : ['devices', 'reports', 'logs'],
      mutationId: `device.created:${result.deviceId}:${changeCursor}`,
    }
    return result.duplicate
      ? ok(responseData, "Qurilma xaridi allaqachon saqlangan")
      : created(responseData, "Qurilma muvaffaqiyatli qo'shildi")
  } catch (err) {
    // Handle the race where two concurrent adds both pass the IMEI pre-check
    // and one violates the active partial unique index (Prisma P2002).
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const typed = err as { status: number; message: string }
      if (typed.status === 403) return forbidden(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return conflict('Bu IMEI allaqachon mavjud.')
    }
    if (err instanceof Error && err.message === 'CREATED_DEVICE_DTO_NOT_FOUND') {
      return serverError('Qurilma yaratildi, ammo yangilangan ma’lumotni yuklab bo‘lmadi. Sahifani yangilang.')
    }
    logger.error('[POST /api/devices]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
