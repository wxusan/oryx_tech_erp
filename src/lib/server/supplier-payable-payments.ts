import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { CurrencyContext } from '@/lib/currency'
import { moneyMinorUnitsFromAmount, moneyDtoToAmount } from '@/lib/currency'
import { convertPaymentToContractCurrency } from '@/lib/nasiya-contract'
import { canonicalPaymentBreakdown } from '@/lib/idempotency-replay'
import { representativePaymentMethod } from '@/lib/payment-breakdown'
import { moneyInputToUzs, moneyInputMeta, type MoneyInputResult } from '@/lib/server/money-input'
import { getUsdUzsRateSnapshot } from '@/lib/server/currency'
import { getLiveShopPrincipalForMutation, principalHasPermission } from '@/lib/server/shop-access'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { resolveTelegramRecipients, telegramNotificationRows, telegramUnavailableMarkerRows, TELEGRAM_AUDIENCES } from '@/lib/server/telegram-recipients'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { supplierPayablePaidMessage, supplierPayablePartialPaymentMessage } from '@/lib/telegram-templates'
import { tashkentDayRange } from '@/lib/timezone'
import type { RecordSupplierPayablePaymentInput } from '@/lib/validations'

export class SupplierPayablePaymentError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** Create a liability and optional initial payment inside a caller-owned
 * compound transaction. This is shared by Olib and normal device acquisition. */
export async function createSupplierPayableCore(input: {
  tx: Prisma.TransactionClient
  shopId: string
  deviceId: string
  saleId?: string
  olibSotdimOperationId?: string
  supplierId?: string
  origin: 'OLIB_SOTDIM' | 'DEVICE_PURCHASE'
  supplierName: string
  supplierPhone: string
  supplierLocation?: string
  supplierNote?: string
  purchaseInput: MoneyInputResult
  contractAmount: number
  dueDate: Date
  reminderEnabled: boolean
  earlyReminderEnabled?: boolean
  earlyReminderDays?: number
  initialPayment?: {
    rawAmount: number
    converted: MoneyInputResult
    paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'
    paymentBreakdown?: Array<{ method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'; amount: number }>
    paidAt: Date
    note?: string
  }
  actorId: string
  commandHash: string
  idempotencyScope: string
}) {
  const { tx } = input
  const payable = await tx.supplierPayable.create({
    data: {
      shopId: input.shopId,
      deviceId: input.deviceId,
      saleId: input.saleId,
      olibSotdimOperationId: input.olibSotdimOperationId,
      supplierId: input.supplierId,
      origin: input.origin,
      supplierName: input.supplierName,
      supplierPhone: input.supplierPhone,
      supplierLocation: input.supplierLocation,
      supplierNote: input.supplierNote,
      amount: input.purchaseInput.amountUzs,
      contractCurrency: input.purchaseInput.inputCurrency,
      contractExchangeRateAtCreation: input.purchaseInput.exchangeRateUsed,
      contractAmount: input.contractAmount,
      paidAmount: 0,
      remainingAmount: input.purchaseInput.amountUzs,
      contractPaidAmount: 0,
      contractRemainingAmount: input.contractAmount,
      status: 'PENDING',
      dueDate: input.dueDate,
      reminderEnabled: input.reminderEnabled,
      earlyReminderEnabled: input.earlyReminderEnabled ?? false,
      earlyReminderDays: input.earlyReminderEnabled ? input.earlyReminderDays : null,
      createdBy: input.actorId,
      creationIdempotencyKey: input.idempotencyScope,
      creationCommandHash: input.commandHash,
    },
  })
  if (!input.initialPayment || input.initialPayment.rawAmount <= 0) return payable

  const initial = input.initialPayment
  const totalContractMinor = moneyMinorUnitsFromAmount(input.contractAmount, input.purchaseInput.inputCurrency)
  const initialContractMinor = moneyMinorUnitsFromAmount(initial.rawAmount, input.purchaseInput.inputCurrency)
  if (initialContractMinor > totalContractMinor) {
    throw new SupplierPayablePaymentError(400, "Boshlang'ich to'lov qarz summasidan oshib ketdi")
  }
  const fullyPaid = initialContractMinor === totalContractMinor
  const totalUzsMinor = moneyMinorUnitsFromAmount(input.purchaseInput.amountUzs, 'UZS')
  const initialUzsMinor = moneyMinorUnitsFromAmount(initial.converted.amountUzs, 'UZS')
  const canonicalInitialContractAmount = amountFromMinorUnits(initialContractMinor, input.purchaseInput.inputCurrency)
  const effectiveMethod = initial.paymentBreakdown
    ? representativePaymentMethod(initial.paymentBreakdown)
    : initial.paymentMethod
  await tx.supplierPayablePayment.create({
    data: {
      shopId: input.shopId,
      supplierPayableId: payable.id,
      amount: initial.converted.amountUzs,
      paymentInputAmount: initial.rawAmount,
      paymentInputCurrency: initial.converted.inputCurrency,
      paymentExchangeRate: initial.converted.exchangeRateUsed,
      paymentExchangeRateSource: initial.converted.exchangeRateSource,
      paymentExchangeRateEffectiveAt: initial.converted.exchangeRateEffectiveAt,
      paymentExchangeRateFetchedAt: initial.converted.exchangeRateFetchedAt,
      appliedAmountInContractCurrency: canonicalInitialContractAmount,
      paymentMethod: effectiveMethod,
      paymentBreakdown: initial.paymentBreakdown ?? undefined,
      paidAt: initial.paidAt,
      note: initial.note,
      createdBy: input.actorId,
      idempotencyKey: `${input.idempotencyScope}:supplier-initial`,
      commandHash: input.commandHash,
    },
  })
  return tx.supplierPayable.update({
    where: { id: payable.id },
    data: {
      paidAmount: amountFromMinorUnits(fullyPaid ? totalUzsMinor : Math.min(initialUzsMinor, totalUzsMinor), 'UZS'),
      remainingAmount: amountFromMinorUnits(fullyPaid ? 0 : Math.max(0, totalUzsMinor - initialUzsMinor), 'UZS'),
      contractPaidAmount: canonicalInitialContractAmount,
      contractRemainingAmount: amountFromMinorUnits(totalContractMinor - initialContractMinor, input.purchaseInput.inputCurrency),
      ledgerVersion: { increment: 1 },
      status: fullyPaid ? 'PAID' : 'PARTIAL',
      paidAt: fullyPaid ? initial.paidAt : null,
      lastPaymentAt: initial.paidAt,
      paymentMethod: fullyPaid ? effectiveMethod : null,
      paymentBreakdown: fullyPaid ? (initial.paymentBreakdown ?? Prisma.JsonNull) : Prisma.JsonNull,
      reminderEnabled: fullyPaid ? false : input.reminderEnabled,
    },
  })
}

type RecordPaymentCommand = {
  shopId: string
  supplierPayableId: string
  actorId: string
  actorName: string
  actorType: 'SUPER_ADMIN' | 'SHOP_ADMIN'
  input: RecordSupplierPayablePaymentInput
  idempotencyKey: string
  currency: CurrencyContext
}

const paymentSelect = {
  id: true,
  supplierPayableId: true,
  amount: true,
  paymentInputAmount: true,
  paymentInputCurrency: true,
  appliedAmountInContractCurrency: true,
  paymentMethod: true,
  paymentBreakdown: true,
  paidAt: true,
  note: true,
  createdAt: true,
} satisfies Prisma.SupplierPayablePaymentSelect

function amountFromMinorUnits(minorUnits: number, currency: 'UZS' | 'USD') {
  return moneyDtoToAmount({ currency, minorUnits })
}

function paymentDto(payment: {
  id: string
  supplierPayableId: string
  amount: Prisma.Decimal
  paymentInputAmount: Prisma.Decimal
  paymentInputCurrency: 'UZS' | 'USD'
  appliedAmountInContractCurrency: Prisma.Decimal
  paymentMethod: string
  paymentBreakdown: Prisma.JsonValue | null
  paidAt: Date
  note: string | null
  createdAt: Date
}) {
  return {
    ...payment,
    amount: Number(payment.amount),
    paymentInputAmount: Number(payment.paymentInputAmount),
    appliedAmountInContractCurrency: Number(payment.appliedAmountInContractCurrency),
  }
}

function payableDto(payable: {
  id: string
  status: string
  contractCurrency: 'UZS' | 'USD'
  contractAmount: Prisma.Decimal
  contractPaidAmount: Prisma.Decimal
  contractRemainingAmount: Prisma.Decimal
  paidAmount: Prisma.Decimal
  remainingAmount: Prisma.Decimal
  dueDate: Date
  paidAt: Date | null
  lastPaymentAt: Date | null
  ledgerVersion: number
}) {
  return {
    ...payable,
    contractAmount: Number(payable.contractAmount),
    contractPaidAmount: Number(payable.contractPaidAmount),
    contractRemainingAmount: Number(payable.contractRemainingAmount),
    paidAmount: Number(payable.paidAmount),
    remainingAmount: Number(payable.remainingAmount),
  }
}

export async function recordSupplierPayablePayment(command: RecordPaymentCommand) {
  const amountInput = await moneyInputToUzs(command.input.amount, command.input.inputCurrency)
  const contractLookup = await prisma.supplierPayable.findFirst({
    where: { id: command.supplierPayableId, shopId: command.shopId, deletedAt: null },
    select: { contractCurrency: true },
  })
  if (!contractLookup) throw new SupplierPayablePaymentError(404, 'Qarz yozuvi topilmadi')

  let rate = amountInput.exchangeRateUsed
  let rateSource = amountInput.exchangeRateSource
  let rateEffectiveAt = amountInput.exchangeRateEffectiveAt
  let rateFetchedAt = amountInput.exchangeRateFetchedAt
  if (amountInput.inputCurrency !== contractLookup.contractCurrency && rate == null) {
    const snapshot = await getUsdUzsRateSnapshot()
    rate = snapshot.rate
    rateSource = snapshot.source
    rateEffectiveAt = snapshot.effectiveAt
    rateFetchedAt = snapshot.fetchedAt
  }
  const appliedContractAmount = convertPaymentToContractCurrency(
    command.input.amount,
    amountInput.inputCurrency,
    contractLookup.contractCurrency,
    rate,
  )
  const effectivePaymentMethod = command.input.paymentBreakdown
    ? representativePaymentMethod(command.input.paymentBreakdown)
    : command.input.paymentMethod
  const commandHash = createHash('sha256').update(JSON.stringify({
    supplierPayableId: command.supplierPayableId,
    amount: command.input.amount,
    inputCurrency: amountInput.inputCurrency,
    paymentMethod: effectivePaymentMethod,
    paymentBreakdown: canonicalPaymentBreakdown(command.input.paymentBreakdown, amountInput.inputCurrency),
    paidAt: command.input.paidAt?.toISOString() ?? null,
    note: command.input.note ?? null,
  })).digest('hex')

  const run = () => prisma.$transaction(async (tx) => {
    if (command.actorType === 'SHOP_ADMIN') {
      const livePrincipal = await getLiveShopPrincipalForMutation(tx, {
        shopId: command.shopId,
        actorId: command.actorId,
      })
      const allowed = livePrincipal && (
        principalHasPermission(livePrincipal, 'SUPPLIER_PAYMENT_RECORD') ||
        principalHasPermission(livePrincipal, 'SUPPLIER_PAYMENT_MARK_PAID')
      )
      if (!allowed) throw new SupplierPayablePaymentError(403, "Bu amal uchun ruxsat berilmagan")
    }

    const replay = await tx.supplierPayablePayment.findUnique({
      where: { shopId_idempotencyKey: { shopId: command.shopId, idempotencyKey: command.idempotencyKey } },
      select: { ...paymentSelect, commandHash: true, createdBy: true },
    })
    if (replay) {
      if (replay.commandHash !== commandHash || replay.createdBy !== command.actorId || replay.supplierPayableId !== command.supplierPayableId) {
        throw new SupplierPayablePaymentError(409, "Idempotency-Key boshqa yoki o'zgartirilgan to'lov uchun ishlatilgan")
      }
      const current = await tx.supplierPayable.findFirstOrThrow({
        where: { id: command.supplierPayableId, shopId: command.shopId },
        select: {
          id: true, status: true, contractCurrency: true, contractAmount: true,
          contractPaidAmount: true, contractRemainingAmount: true, paidAmount: true,
          remainingAmount: true, dueDate: true, paidAt: true, lastPaymentAt: true,
          ledgerVersion: true,
        },
      })
      return { payment: paymentDto(replay), payable: payableDto(current), duplicate: true }
    }

    const payable = await tx.supplierPayable.findFirst({
      where: { id: command.supplierPayableId, shopId: command.shopId, deletedAt: null },
      include: {
        device: { include: { imeis: { where: { deletedAt: null } } } },
        shop: { select: { name: true } },
      },
    })
    if (!payable) throw new SupplierPayablePaymentError(404, 'Qarz yozuvi topilmadi')
    if (payable.status === 'PAID' || payable.status === 'CANCELLED' || Number(payable.contractRemainingAmount) <= 0) {
      throw new SupplierPayablePaymentError(409, 'Bu qarz yopilgan yoki bekor qilingan', { payable: payableDto(payable) })
    }

    const remainingContractMinor = moneyMinorUnitsFromAmount(payable.contractRemainingAmount.toString(), payable.contractCurrency)
    const appliedContractMinor = moneyMinorUnitsFromAmount(appliedContractAmount, payable.contractCurrency)
    if (appliedContractMinor > remainingContractMinor) {
      throw new SupplierPayablePaymentError(409, "To'lov summasi qolgan qarzdan oshib ketdi", { payable: payableDto(payable) })
    }

    const remainingUzsMinor = moneyMinorUnitsFromAmount(payable.remainingAmount.toString(), 'UZS')
    const paidUzsMinor = moneyMinorUnitsFromAmount(payable.paidAmount.toString(), 'UZS')
    const paymentUzsMinor = moneyMinorUnitsFromAmount(amountInput.amountUzs, 'UZS')
    const nextContractRemainingMinor = remainingContractMinor - appliedContractMinor
    const nextContractPaidMinor = moneyMinorUnitsFromAmount(payable.contractPaidAmount.toString(), payable.contractCurrency) + appliedContractMinor
    const isFullyPaid = nextContractRemainingMinor === 0
    // The contract ledger decides closure. The UZS compatibility projection
    // snaps to zero at closure and otherwise remains non-negative under FX.
    const nextRemainingUzsMinor = isFullyPaid ? 0 : Math.max(0, remainingUzsMinor - paymentUzsMinor)
    const nextPaidUzsMinor = isFullyPaid
      ? moneyMinorUnitsFromAmount(payable.amount.toString(), 'UZS')
      : paidUzsMinor + Math.min(paymentUzsMinor, remainingUzsMinor)
    const paidAt = command.input.paidAt ?? new Date()
    const { start: todayStart } = tashkentDayRange()
    const nextStatus = isFullyPaid ? 'PAID' as const : payable.dueDate < todayStart ? 'OVERDUE' as const : 'PARTIAL' as const

    const payment = await tx.supplierPayablePayment.create({
      data: {
        shopId: command.shopId,
        supplierPayableId: payable.id,
        amount: amountInput.amountUzs,
        paymentInputAmount: command.input.amount,
        paymentInputCurrency: amountInput.inputCurrency,
        paymentExchangeRate: rate,
        paymentExchangeRateSource: rateSource,
        paymentExchangeRateEffectiveAt: rateEffectiveAt,
        paymentExchangeRateFetchedAt: rateFetchedAt,
        appliedAmountInContractCurrency: appliedContractAmount,
        paymentMethod: effectivePaymentMethod,
        paymentBreakdown: command.input.paymentBreakdown ?? undefined,
        paidAt,
        note: command.input.note,
        createdBy: command.actorId,
        idempotencyKey: command.idempotencyKey,
        commandHash,
      },
      select: paymentSelect,
    })

    const updated = await tx.supplierPayable.updateMany({
      where: {
        id: payable.id,
        shopId: command.shopId,
        ledgerVersion: payable.ledgerVersion,
        deletedAt: null,
        status: { notIn: ['PAID', 'CANCELLED'] },
      },
      data: {
        paidAmount: amountFromMinorUnits(nextPaidUzsMinor, 'UZS'),
        remainingAmount: amountFromMinorUnits(nextRemainingUzsMinor, 'UZS'),
        contractPaidAmount: amountFromMinorUnits(nextContractPaidMinor, payable.contractCurrency),
        contractRemainingAmount: amountFromMinorUnits(nextContractRemainingMinor, payable.contractCurrency),
        ledgerVersion: { increment: 1 },
        status: nextStatus,
        paidAt: isFullyPaid ? paidAt : null,
        lastPaymentAt: paidAt,
        paymentMethod: isFullyPaid ? effectivePaymentMethod : null,
        paymentBreakdown: isFullyPaid ? (command.input.paymentBreakdown ?? Prisma.JsonNull) : Prisma.JsonNull,
        note: command.input.note ?? payable.note,
      },
    })
    if (updated.count !== 1) throw new Prisma.PrismaClientKnownRequestError('Supplier payable ledger changed concurrently', { code: 'P2034', clientVersion: '7.8.0' })

    const current = await tx.supplierPayable.findFirstOrThrow({
      where: { id: payable.id, shopId: command.shopId },
      select: {
        id: true, status: true, contractCurrency: true, contractAmount: true,
        contractPaidAmount: true, contractRemainingAmount: true, paidAmount: true,
        remainingAmount: true, dueDate: true, paidAt: true, lastPaymentAt: true,
        ledgerVersion: true,
      },
    })
    const logAction = isFullyPaid ? 'SUPPLIER_PAYABLE_PAID' : 'SUPPLIER_PAYABLE_PARTIAL_PAYMENT'
    await tx.log.create({
      data: {
        shopId: command.shopId,
        actorId: command.actorId,
        actorType: command.actorType,
        action: logAction,
        targetType: 'SupplierPayable',
        targetId: payable.id,
        oldValue: {
          status: payable.status,
          contractPaidAmount: Number(payable.contractPaidAmount),
          contractRemainingAmount: Number(payable.contractRemainingAmount),
        },
        newValue: {
          paymentId: payment.id,
          status: nextStatus,
          paymentMethod: effectivePaymentMethod,
          paymentBreakdown: command.input.paymentBreakdown,
          contractPaidAmount: Number(current.contractPaidAmount),
          contractRemainingAmount: Number(current.contractRemainingAmount),
          appliedAmountInContractCurrency: appliedContractAmount,
          inputAmount: command.input.amount,
          ...moneyInputMeta({ ...amountInput, exchangeRateUsed: rate, exchangeRateSource: rateSource, exchangeRateEffectiveAt: rateEffectiveAt, exchangeRateFetchedAt: rateFetchedAt }),
        },
        note: command.input.note,
      },
    })

    const recipients = await resolveTelegramRecipients(tx, {
      shopId: command.shopId,
      audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
    })
    const message = isFullyPaid
      ? supplierPayablePaidMessage({
          shopName: payable.shop.name,
          device: presentDeviceSpecs(payable.device),
          supplierName: payable.supplierName,
          supplierPhone: payable.supplierPhone,
          amount: appliedContractAmount,
          contractCurrency: payable.contractCurrency,
          paymentMethod: effectivePaymentMethod,
          adminName: command.actorName,
          currency: command.currency,
        })
      : supplierPayablePartialPaymentMessage({
          shopName: payable.shop.name,
          device: presentDeviceSpecs(payable.device),
          supplierName: payable.supplierName,
          supplierPhone: payable.supplierPhone,
          paidAmount: appliedContractAmount,
          remainingAmount: Number(current.contractRemainingAmount),
          contractCurrency: payable.contractCurrency,
          paymentMethod: effectivePaymentMethod,
          adminName: command.actorName,
          currency: command.currency,
        })
    const scheduledAt = new Date()
    const notificationRows = [
      ...telegramNotificationRows(recipients, {
        type: isFullyPaid ? 'SUPPLIER_PAYABLE_PAID' : 'SUPPLIER_PAYABLE_PARTIAL_PAYMENT',
        message,
        scheduledAt,
        relatedId: payable.id,
        relatedType: 'SupplierPayable',
      }),
      ...telegramUnavailableMarkerRows(recipients, {
        type: isFullyPaid ? 'SUPPLIER_PAYABLE_PAID' : 'SUPPLIER_PAYABLE_PARTIAL_PAYMENT',
        dedupeScope: payment.id,
        cancelledAt: scheduledAt,
      }),
    ]
    if (notificationRows.length) await tx.notification.createMany({ data: notificationRows })

    return { payment: paymentDto(payment), payable: payableDto(current), duplicate: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue
      if (isRetryableTransactionError(error)) {
        const fresh = await prisma.supplierPayable.findFirst({
          where: { id: command.supplierPayableId, shopId: command.shopId, deletedAt: null },
          select: {
            id: true, status: true, contractCurrency: true, contractAmount: true,
            contractPaidAmount: true, contractRemainingAmount: true, paidAmount: true,
            remainingAmount: true, dueDate: true, paidAt: true, lastPaymentAt: true,
            ledgerVersion: true,
          },
        })
        throw new SupplierPayablePaymentError(409, "Qarz qoldig'i boshqa to'lov bilan yangilandi. Yangi qoldiqni tekshirib qayta urinib ko'ring", fresh ? { payable: payableDto(fresh) } : undefined)
      }
      throw error
    }
  }
  throw new Error('SUPPLIER_PAYMENT_RETRY_EXHAUSTED')
}
