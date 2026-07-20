import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { calculateNasiyaAmounts, calculateNasiyaAmountsFromMonthlyPayment, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { createMoneyInputConverter, type MoneyInputResult } from '@/lib/server/money-input'
import { computeSaleContractMargin } from '@/lib/nasiya-contract'
import { buildNasiyaComponentPlan, splitUzsReportingAmount } from '@/lib/payment-profit-allocation'
import { resolveCustomerSelection } from '@/lib/server/customer-selection'
import { nasiyaPaymentFxSourceForPersistence } from '@/lib/server/nasiya-payment-schema'

type CustomerTrustOverride = 'NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'

export type PreparedNasiyaContract = {
  totalInput: MoneyInputResult
  downPaymentInput: MoneyInputResult
  amounts: ReturnType<typeof calculateNasiyaAmounts>
  contractAmounts: ReturnType<typeof calculateNasiyaAmounts>
  scheduleItems: ReturnType<typeof generatePaymentSchedule>
  contractScheduleItems: ReturnType<typeof generatePaymentSchedule>
  raw: {
    totalAmount: number
    downPayment: number
    months: number
    startDate: Date
  }
}

/** One calculator/conversion boundary shared by standalone and Olib Nasiya. */
export async function prepareNasiyaContract(input: {
  totalAmount: number
  downPayment: number
  months: number
  interestPercent: number
  monthlyPayment?: number
  useMonthlyPaymentOverride?: boolean
  startDate: Date
  inputCurrency?: 'UZS' | 'USD'
}): Promise<PreparedNasiyaContract> {
  const convertMoney = await createMoneyInputConverter(input.inputCurrency)
  const totalInput = convertMoney(input.totalAmount)
  const downPaymentInput = convertMoney(input.downPayment)
  const monthlyPaymentUzs = input.useMonthlyPaymentOverride && input.monthlyPayment !== undefined
    ? convertMoney(input.monthlyPayment).amountUzs
    : undefined

  const amounts = input.useMonthlyPaymentOverride && monthlyPaymentUzs !== undefined
    ? calculateNasiyaAmountsFromMonthlyPayment({
        totalAmount: totalInput.amountUzs,
        downPayment: downPaymentInput.amountUzs,
        months: input.months,
        monthlyPayment: monthlyPaymentUzs,
      })
    : calculateNasiyaAmounts({
        totalAmount: totalInput.amountUzs,
        downPayment: downPaymentInput.amountUzs,
        months: input.months,
        interestPercent: input.interestPercent,
      })
  const contractAmounts = input.useMonthlyPaymentOverride && input.monthlyPayment !== undefined
    ? calculateNasiyaAmountsFromMonthlyPayment({
        totalAmount: input.totalAmount,
        downPayment: input.downPayment,
        months: input.months,
        monthlyPayment: input.monthlyPayment,
        currency: totalInput.inputCurrency,
      })
    : calculateNasiyaAmounts({
        totalAmount: input.totalAmount,
        downPayment: input.downPayment,
        months: input.months,
        interestPercent: input.interestPercent,
        currency: totalInput.inputCurrency,
      })
  const scheduleItems = generatePaymentSchedule(input.startDate, input.months, amounts.finalNasiyaAmount)
  const contractScheduleItems = generatePaymentSchedule(
    input.startDate,
    input.months,
    contractAmounts.finalNasiyaAmount,
    totalInput.inputCurrency,
  )
  if (scheduleItems.reduce((sum, item) => sum + item.expectedAmount, 0) !== amounts.finalNasiyaAmount) {
    throw new Error("To'lov jadvali nasiya jami bilan mos emas")
  }
  return {
    totalInput,
    downPaymentInput,
    amounts,
    contractAmounts,
    scheduleItems,
    contractScheduleItems,
    raw: {
      totalAmount: input.totalAmount,
      downPayment: input.downPayment,
      months: input.months,
      startDate: input.startDate,
    },
  }
}

type NasiyaDevice = {
  id: string
  shopId: string
  status: string
  purchaseCurrency: 'UZS' | 'USD'
  purchaseInputAmount: Prisma.Decimal
  purchaseAmountUzsSnapshot: Prisma.Decimal
}

/** Persist the financial contract, schedule, down payment and allocation.
 * Notifications/logs remain at the orchestration layer so Olib emits one
 * coherent compound-operation message instead of duplicate creation alerts. */
export async function createNasiyaContractCore(input: {
  tx: Prisma.TransactionClient
  shopId: string
  device: NasiyaDevice
  reserveInStockDevice: boolean
  prepared: PreparedNasiyaContract
  customer: {
    mode: 'EXISTING' | 'NEW'
    customerId?: string
    customerName?: string
    customerPhone?: string
    customerAdditionalPhones?: string[]
    customerNote?: string
    customerPassportIdentifier?: string
    customerTrustOverride?: CustomerTrustOverride | null
    passportPhotoUrl?: string
  }
  months: number
  startDate: Date
  paymentMethod: PaymentMethod
  earlyReminderEnabled?: boolean
  earlyReminderDays?: number
  note?: string
  actorId: string
  paymentFxQuoteColumnsAvailable: boolean
}) {
  const {
    tx, shopId, device, prepared, months, startDate, paymentMethod,
    earlyReminderEnabled, earlyReminderDays, note, actorId,
  } = input
  const contractMarginAmount = computeSaleContractMargin(
    prepared.contractAmounts.totalAmount,
    prepared.totalInput.inputCurrency,
    prepared.totalInput.exchangeRateUsed,
    {
      purchaseCurrency: device.purchaseCurrency,
      purchaseInputAmount: Number(device.purchaseInputAmount),
      purchaseAmountUzsSnapshot: Number(device.purchaseAmountUzsSnapshot),
    },
  )
  if (contractMarginAmount === null) {
    throw new Error("Qurilma tannarxini shartnoma valyutasida aniq ajratib bo'lmadi")
  }
  const componentPlan = buildNasiyaComponentPlan({
    currency: prepared.totalInput.inputCurrency,
    totalAmount: prepared.contractAmounts.totalAmount,
    downPayment: prepared.contractAmounts.downPayment,
    interestAmount: prepared.contractAmounts.interestAmount,
    costBasisAmount: prepared.contractAmounts.totalAmount - contractMarginAmount,
    scheduleExpectedAmounts: prepared.contractScheduleItems.map((item) => item.expectedAmount),
  })

  if (input.reserveInStockDevice) {
    const reserved = await tx.device.updateMany({
      where: { id: device.id, shopId, deletedAt: null, status: 'IN_STOCK' },
      data: { status: 'SOLD_NASIYA', updatedAt: new Date() },
    })
    if (reserved.count !== 1) throw new Error('Qurilma allaqachon sotilgan')
  }

  const customer = await resolveCustomerSelection(tx, {
    shopId,
    mode: input.customer.mode,
    customerId: input.customer.customerId,
    customerName: input.customer.customerName,
    customerPhone: input.customer.customerPhone,
    customerAdditionalPhones: input.customer.customerAdditionalPhones,
    customerNote: input.customer.customerNote,
    customerPassportIdentifier: input.customer.customerPassportIdentifier,
    customerTrustOverride: input.customer.customerTrustOverride,
    passportPhotoUrl: input.customer.passportPhotoUrl,
    requirePassportPhoto: true,
  })

  const nasiya = await tx.nasiya.create({
    data: {
      shopId,
      deviceId: device.id,
      customerId: customer.id,
      totalAmount: prepared.amounts.totalAmount,
      downPayment: prepared.amounts.downPayment,
      baseRemainingAmount: prepared.amounts.baseRemainingAmount,
      interestPercent: prepared.amounts.interestPercent,
      interestAmount: prepared.amounts.interestAmount,
      finalNasiyaAmount: prepared.amounts.finalNasiyaAmount,
      remainingAmount: prepared.amounts.finalNasiyaAmount,
      months,
      monthlyPayment: prepared.amounts.monthlyPayment,
      startDate,
      earlyReminderEnabled,
      earlyReminderDays: earlyReminderEnabled ? earlyReminderDays : null,
      note,
      createdBy: actorId,
      creationCurrency: prepared.totalInput.inputCurrency,
      creationExchangeRate: prepared.totalInput.exchangeRateUsed,
      contractCurrency: prepared.totalInput.inputCurrency,
      contractExchangeRateAtCreation: prepared.totalInput.exchangeRateUsed,
      contractTotalAmount: prepared.contractAmounts.totalAmount,
      contractDownPayment: prepared.contractAmounts.downPayment,
      contractBaseRemainingAmount: prepared.contractAmounts.baseRemainingAmount,
      contractInterestAmount: prepared.contractAmounts.interestAmount,
      contractFinalAmount: prepared.contractAmounts.finalNasiyaAmount,
      contractMonthlyPayment: prepared.contractAmounts.monthlyPayment,
      contractRemainingAmount: prepared.contractAmounts.finalNasiyaAmount,
      contractPaidAmount: 0,
      contractCostBasisAmount: componentPlan.costBasisAmount,
      contractMarginAmount: componentPlan.marginAmount,
      contractDownPaymentPrincipalAmount: componentPlan.downPayment.principal,
      contractDownPaymentMarginAmount: componentPlan.downPayment.margin,
      accountingReconstructionStatus: 'COMPLETE',
      accountingReconstructedAt: new Date(),
    },
  })

  await tx.nasiyaSchedule.createMany({
    data: prepared.scheduleItems.map((item, index) => ({
      nasiyaId: nasiya.id,
      shopId,
      monthNumber: item.monthNumber,
      dueDate: item.dueDate,
      expectedAmount: item.expectedAmount,
      contractCurrency: prepared.totalInput.inputCurrency,
      contractExpectedAmount: prepared.contractScheduleItems[index].expectedAmount,
      contractRemainingAmount: prepared.contractScheduleItems[index].expectedAmount,
      contractPrincipalAmount: componentPlan.schedules[index].principal,
      contractMarginAmount: componentPlan.schedules[index].margin,
      contractInterestAmount: componentPlan.schedules[index].interest,
    })),
  })

  if (prepared.amounts.downPayment > 0) {
    const initialPayment = await tx.nasiyaPayment.create({
      data: {
        nasiyaId: nasiya.id,
        nasiyaScheduleId: null,
        shopId,
        amount: prepared.amounts.downPayment,
        paymentMethod,
        paidAt: new Date(),
        note: "Boshlang'ich to'lov",
        createdBy: actorId,
        paymentInputAmount: prepared.raw.downPayment,
        paymentInputCurrency: prepared.downPaymentInput.inputCurrency,
        paymentExchangeRate: prepared.downPaymentInput.exchangeRateUsed,
        ...(input.paymentFxQuoteColumnsAvailable ? {
          paymentExchangeRateSource: nasiyaPaymentFxSourceForPersistence(prepared.downPaymentInput.exchangeRateSource),
          paymentExchangeRateEffectiveAt: prepared.downPaymentInput.exchangeRateEffectiveAt,
          paymentExchangeRateFetchedAt: prepared.downPaymentInput.exchangeRateFetchedAt,
        } : {}),
        appliedAmountInContractCurrency: prepared.contractAmounts.downPayment,
      },
    })
    const reportingComponents = splitUzsReportingAmount({
      amountUzs: prepared.amounts.downPayment,
      contractAmount: prepared.contractAmounts.downPayment,
      contractComponents: componentPlan.downPayment,
    })
    await tx.nasiyaPaymentAllocation.create({
      data: {
        shopId,
        nasiyaId: nasiya.id,
        nasiyaPaymentId: initialPayment.id,
        nasiyaScheduleId: null,
        sequence: 1,
        contractCurrency: prepared.totalInput.inputCurrency,
        contractAmount: prepared.contractAmounts.downPayment,
        contractPrincipalAmount: componentPlan.downPayment.principal,
        contractMarginAmount: componentPlan.downPayment.margin,
        contractInterestAmount: 0,
        amountUzs: prepared.amounts.downPayment,
        principalAmountUzs: reportingComponents.principal,
        marginAmountUzs: reportingComponents.margin,
        interestAmountUzs: 0,
      },
    })
  }

  return { nasiya, customer, componentPlan }
}
