import { createHash } from 'node:crypto'
import { NextRequest, after } from 'next/server'
import type { ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { settleNasiyaSchema } from '@/lib/validations'
import { badRequest, conflict, forbidden, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import {
  getLiveShopPrincipalForMutation,
  principalHasFeature,
  principalHasPermission,
} from '@/lib/server/shop-access'
import {
  calculateNasiyaSettlement,
  settlementMoneyAmount,
  type NasiyaSettlementMode,
} from '@/lib/nasiya-settlement'
import { reconcileNasiyaLedger } from '@/lib/nasiya-ledger'
import {
  addMoneyDto,
  convertMoneyDto,
  createFxQuoteDto,
  createMoneyDto,
  fxQuoteRate,
  moneyDtoToAmount,
  type CurrencyCode,
  type FxQuoteDto,
} from '@/lib/currency'
import {
  allocateUzsAcrossContractAmounts,
  splitUzsReportingAmount,
} from '@/lib/payment-profit-allocation'
import { canonicalPaymentBreakdown } from '@/lib/idempotency-replay'
import { representativePaymentMethod, validatePaymentBreakdown } from '@/lib/payment-breakdown'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { invalidateShopNasiyaSettlementMutation } from '@/lib/server/cache-tags'
import { nasiyaSettlementCompletedMessage } from '@/lib/telegram-templates'
import { presentDeviceSpecs } from '@/lib/device-specs'
import {
  resolveTelegramRecipientsTransactionSafe as resolveTelegramRecipients,
  telegramNotificationRows,
  telegramUnavailableMarkerRows,
  TELEGRAM_AUDIENCES,
} from '@/lib/server/telegram-recipients'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { currentBusinessLogContext, recordRequestTiming } from '@/lib/server/request-context'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

const MAX_SETTLEMENT_SCHEDULES = 60
const MAX_LEDGER_ALLOCATIONS = 1000

const settlementNasiyaInclude = {
  schedules: {
    orderBy: { monthNumber: 'asc' as const },
    take: MAX_SETTLEMENT_SCHEDULES + 1,
  },
  paymentAllocations: {
    orderBy: { id: 'asc' as const },
    take: MAX_LEDGER_ALLOCATIONS + 1,
    select: {
      nasiyaScheduleId: true,
      contractCurrency: true,
      contractAmount: true,
    },
  },
  settlement: true,
  shop: { select: { name: true } },
  customer: { select: { name: true, phone: true } },
  device: { include: { imeis: { where: { deletedAt: null } } } },
} satisfies Prisma.NasiyaInclude

type SettlementNasiya = Prisma.NasiyaGetPayload<{ include: typeof settlementNasiyaInclude }>

const storedSettlementInclude = {
  allocations: { orderBy: { sequence: 'asc' as const }, take: MAX_SETTLEMENT_SCHEDULES + 1 },
  payment: {
    select: {
      amount: true,
      paymentInputAmount: true,
      paymentInputCurrency: true,
      appliedAmountInContractCurrency: true,
      paymentExchangeRate: true,
      paymentExchangeRateSource: true,
      paymentExchangeRateEffectiveAt: true,
      paymentExchangeRateFetchedAt: true,
      paymentMethod: true,
      paymentBreakdown: true,
      paidAt: true,
    },
  },
  nasiya: {
    select: {
      status: true,
      contractCurrency: true,
      contractPaidAmount: true,
      contractInterestWaivedAmount: true,
      contractRemainingAmount: true,
    },
  },
} satisfies Prisma.NasiyaSettlementInclude

type StoredSettlement = Prisma.NasiyaSettlementGetPayload<{ include: typeof storedSettlementInclude }>

async function loadSettlementNasiyaForMutation(
  tx: Prisma.TransactionClient,
  input: { nasiyaId: string; shopId: string },
): Promise<SettlementNasiya | null> {
  // Prisma's driver adapter expands relation includes into concurrent reads.
  // An interactive PostgreSQL transaction owns one connection, so load each
  // bounded relation in order to avoid overlapping client.query() calls.
  const nasiya = await tx.nasiya.findFirst({
    where: { id: input.nasiyaId, shopId: input.shopId, deletedAt: null },
  })
  if (!nasiya) return null
  const schedules = await tx.nasiyaSchedule.findMany({
    where: { nasiyaId: input.nasiyaId, shopId: input.shopId },
    orderBy: { monthNumber: 'asc' },
    take: MAX_SETTLEMENT_SCHEDULES + 1,
  })
  const paymentAllocations = await tx.nasiyaPaymentAllocation.findMany({
    where: { nasiyaId: input.nasiyaId, shopId: input.shopId },
    orderBy: { id: 'asc' },
    take: MAX_LEDGER_ALLOCATIONS + 1,
    select: {
      nasiyaScheduleId: true,
      contractCurrency: true,
      contractAmount: true,
    },
  })
  const settlement = await tx.nasiyaSettlement.findUnique({ where: { nasiyaId: input.nasiyaId } })
  const shop = await tx.shop.findUniqueOrThrow({
    where: { id: input.shopId },
    select: { name: true },
  })
  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: nasiya.customerId },
    select: { name: true, phone: true },
  })
  const device = await tx.device.findUniqueOrThrow({ where: { id: nasiya.deviceId } })
  const imeis = await tx.deviceImei.findMany({
    where: { deviceId: nasiya.deviceId, deletedAt: null },
  })
  return {
    ...nasiya,
    schedules,
    paymentAllocations,
    settlement,
    shop,
    customer,
    device: { ...device, imeis },
  }
}

function settlementInput(nasiya: SettlementNasiya, mode: NasiyaSettlementMode) {
  return {
    mode,
    contractCurrency: nasiya.contractCurrency,
    contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
    contractPaidAmount: nasiya.contractPaidAmount.toString(),
    contractInterestWaivedAmount: nasiya.contractInterestWaivedAmount.toString(),
    accountingReconstructionStatus: nasiya.accountingReconstructionStatus,
    schedules: nasiya.schedules.map((schedule) => ({
      id: schedule.id,
      monthNumber: schedule.monthNumber,
      contractExpectedAmount: schedule.contractExpectedAmount.toString(),
      contractPaidAmount: schedule.contractPaidAmount.toString(),
      contractRemainingAmount: schedule.contractRemainingAmount.toString(),
      contractInterestWaivedAmount: schedule.contractInterestWaivedAmount.toString(),
      contractPrincipalAmount: schedule.contractPrincipalAmount.toString(),
      contractMarginAmount: schedule.contractMarginAmount.toString(),
      contractInterestAmount: schedule.contractInterestAmount.toString(),
      contractPrincipalPaidAmount: schedule.contractPrincipalPaidAmount.toString(),
      contractMarginPaidAmount: schedule.contractMarginPaidAmount.toString(),
      contractInterestPaidAmount: schedule.contractInterestPaidAmount.toString(),
    })),
  }
}

function currentLedgerFor(nasiya: SettlementNasiya) {
  return reconcileNasiyaLedger({
    status: nasiya.status,
    contractCurrency: nasiya.contractCurrency,
    contractFinalAmount: nasiya.contractFinalAmount.toString(),
    contractPaidAmount: nasiya.contractPaidAmount.toString(),
    contractInterestWaivedAmount: nasiya.contractInterestWaivedAmount.toString(),
    contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
    schedules: nasiya.schedules.map((schedule) => ({
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
    allocations: nasiya.paymentAllocations.map((allocation) => ({
      nasiyaScheduleId: allocation.nasiyaScheduleId,
      contractCurrency: allocation.contractCurrency,
      contractAmount: allocation.contractAmount.toString(),
    })),
  })
}

function assertSettlementCandidate(nasiya: SettlementNasiya) {
  if (nasiya.schedules.length > MAX_SETTLEMENT_SCHEDULES || nasiya.months > MAX_SETTLEMENT_SCHEDULES) {
    throw { status: 409, message: "Nasiya jadvali tasdiqlangan chegaradan oshgan; avval tekshiruv kerak" }
  }
  if (nasiya.paymentAllocations.length > MAX_LEDGER_ALLOCATIONS) {
    throw { status: 409, message: "Nasiya to‘lov ledgeri tasdiqlangan chegaradan oshgan; avval tekshiruv kerak" }
  }
  if (nasiya.status === 'CANCELLED' || nasiya.deletedAt || nasiya.returnedAt) {
    throw { status: 404, message: 'Nasiya topilmadi' }
  }
  if (nasiya.resolutionState !== 'ACTIVE') {
    throw { status: 409, message: "Arxivlangan nasiya avval qayta ochilishi kerak" }
  }
  if (nasiya.settlement) throw { status: 409, message: 'Bu nasiya allaqachon yopilgan' }
  const ledger = currentLedgerFor(nasiya)
  if (ledger.health === 'QUARANTINED') {
    throw { status: 409, message: "Nasiya hisob-kitobida tekshiruv talab qilinadigan tafovut bor" }
  }
  if (ledger.status === 'COMPLETED' || ledger.remaining.minorUnits === 0) {
    throw { status: 409, message: 'Bu nasiya yakunlangan' }
  }
  return ledger
}

function serializedSettlement(settlement: StoredSettlement, duplicate: boolean) {
  const currency = settlement.contractCurrency
  const payment = settlement.payment
  const paid = createMoneyDto(currency, settlement.nasiya.contractPaidAmount.toString())
  const waived = createMoneyDto(currency, settlement.nasiya.contractInterestWaivedAmount.toString())
  return {
    settlement: {
      id: settlement.id,
      mode: settlement.mode,
      contractCurrency: currency,
      remainingBefore: createMoneyDto(currency, settlement.contractRemainingBefore.toString()),
      cashReceived: createMoneyDto(currency, settlement.contractCashReceivedAmount.toString()),
      interestWaived: createMoneyDto(currency, settlement.contractInterestWaivedAmount.toString()),
      remainingAfter: createMoneyDto(currency, settlement.contractRemainingAfter.toString()),
      cashReceivedUzs: createMoneyDto('UZS', settlement.cashReceivedAmountUzs.toString()),
      interestWaivedUzs: createMoneyDto('UZS', settlement.interestWaivedAmountUzs.toString()),
      settledAt: settlement.settledAt.toISOString(),
      reason: settlement.reason,
      actorId: settlement.actorId,
      actorType: settlement.actorType,
    },
    receipt: payment
      ? {
          input: createMoneyDto(
            payment.paymentInputCurrency ?? 'UZS',
            (payment.paymentInputAmount ?? payment.amount).toString(),
          ),
          recordedUzs: createMoneyDto('UZS', payment.amount.toString()),
          applied: createMoneyDto(
            currency,
            (payment.appliedAmountInContractCurrency ?? settlement.contractCashReceivedAmount).toString(),
          ),
          paymentMethod: payment.paymentMethod,
          paymentBreakdown: payment.paymentBreakdown,
          paidAt: payment.paidAt.toISOString(),
          paymentFxQuote: payment.paymentExchangeRate == null
            ? null
            : createFxQuoteDto({
                rate: payment.paymentExchangeRate.toString(),
                source: payment.paymentExchangeRateSource ?? 'RECORDED_FROZEN',
                effectiveAt: payment.paymentExchangeRateEffectiveAt?.toISOString() ?? null,
                fetchedAt: payment.paymentExchangeRateFetchedAt?.toISOString() ?? null,
                freshness: 'FROZEN',
              }),
        }
      : null,
    ledger: {
      paid,
      waived,
      fulfilled: addMoneyDto(paid, waived),
      remaining: createMoneyDto(currency, settlement.nasiya.contractRemainingAmount.toString()),
      status: settlement.nasiya.status,
    },
    allocations: settlement.allocations.map((allocation) => ({
      scheduleId: allocation.nasiyaScheduleId,
      sequence: allocation.sequence,
      remainingBefore: createMoneyDto(currency, allocation.contractRemainingBefore.toString()),
      cash: createMoneyDto(currency, allocation.contractCashAmount.toString()),
      interestWaived: createMoneyDto(currency, allocation.contractInterestWaivedAmount.toString()),
      remainingAfter: createMoneyDto(currency, allocation.contractRemainingAfter.toString()),
      cashUzs: createMoneyDto('UZS', allocation.cashAmountUzs.toString()),
      interestWaivedUzs: createMoneyDto('UZS', allocation.interestWaivedAmountUzs.toString()),
    })),
    duplicate,
  }
}

function quoteMatchesExpected(
  quote: ReturnType<typeof calculateNasiyaSettlement>,
  expected: {
    currency: CurrencyCode
    remaining: number
    cash: number
    waived: number
  },
) {
  return quote.contractCurrency === expected.currency &&
    quote.remainingBefore.minorUnits === expected.remaining &&
    quote.cashToReceive.minorUnits === expected.cash &&
    quote.interestToWaive.minorUnits === expected.waived
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const startedAt = performance.now()
  try {
    const guarded = await requireShopPermissionAndFeature('NASIYA_PAYMENT_RECEIVE', 'NASIYA')
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const resolved = await resolveActiveShopId(session, req.nextUrl.searchParams.get('shopId') ?? undefined)
    if (!resolved.ok) return resolved.response
    const { id: nasiyaId } = await ctx.params
    const nasiya = await prisma.nasiya.findFirst({
      where: { id: nasiyaId, shopId: resolved.shopId, deletedAt: null },
      include: settlementNasiyaInclude,
    })
    if (!nasiya) return notFound('Nasiya topilmadi')
    const ledger = assertSettlementCandidate(nasiya)
    const full = calculateNasiyaSettlement(settlementInput(nasiya, 'FULL_WITH_PROFIT'))
    const waive = calculateNasiyaSettlement(settlementInput(nasiya, 'WAIVE_REMAINING_PROFIT'))
    return ok({
      ledger: { paid: ledger.paid, waived: ledger.waived, remaining: ledger.remaining, status: ledger.status, health: ledger.health },
      quotes: { full, waive },
    }, 'Nasiya yopish summasi yangilandi')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const typed = error as { status: number; message: string }
      if (typed.status === 404) return notFound(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    logger.error('[GET /api/nasiya/[id]/settlement]', { event: 'api.route_error', error })
    return serverError()
  } finally {
    recordRequestTiming('settlement-quote', performance.now() - startedAt)
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const startedAt = performance.now()
  const timings: Record<string, number> = {}
  let measuredShopId: string | null = null
  try {
    const authStartedAt = performance.now()
    const guarded = await requireShopPermissionAndFeature('NASIYA_PAYMENT_RECEIVE', 'NASIYA')
    timings.authenticationPermissions = performance.now() - authStartedAt
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = settleNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const message = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(message)
    }
    if (
      parsed.data.mode === 'WAIVE_REMAINING_PROFIT' &&
      session.user.role !== 'SUPER_ADMIN' &&
      (!guarded.principal || !principalHasPermission(guarded.principal, 'NASIYA_PROFIT_WAIVE'))
    ) {
      return forbidden("Nasiya foydasidan kechish uchun alohida ruxsat kerak")
    }
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return badRequest('Yaroqli Idempotency-Key sarlavhasi kiritilishi shart')
    }

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    measuredShopId = shopId

    const rateStartedAt = performance.now()
    const rate = await checkRateLimitDistributed(
      rateLimitKey('nasiya-settlement', shopId, session.user.id),
      { windowMs: 60_000, max: 12 },
    )
    timings.rateLimiter = performance.now() - rateStartedAt
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const initialStartedAt = performance.now()
    const [currencyContext, contractLookup] = await Promise.all([
      getShopCurrencyContext(shopId),
      prisma.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null },
        select: { contractCurrency: true, contractExchangeRateAtCreation: true },
      }),
    ])
    timings.initialDatabaseReads = performance.now() - initialStartedAt
    if (!contractLookup) return notFound('Nasiya topilmadi')

    const inputCurrency = (parsed.data.inputCurrency ?? currencyContext.currency) as CurrencyCode
    const currentFxQuote = currencyContext.fxQuote ?? null
    if (inputCurrency !== contractLookup.contractCurrency && fxQuoteRate(currentFxQuote) == null) {
      return badRequest("Turli valyutadagi yopish uchun joriy USD kursi mavjud emas")
    }
    const creationFallbackQuote = contractLookup.contractExchangeRateAtCreation == null
      ? null
      : createFxQuoteDto({
          rate: contractLookup.contractExchangeRateAtCreation.toString(),
          source: 'CONTRACT_CREATION_FALLBACK',
          freshness: 'FALLBACK',
        })
    const reportingFxQuote: FxQuoteDto | null = contractLookup.contractCurrency === 'USD'
      ? (fxQuoteRate(currentFxQuote) != null ? currentFxQuote : creationFallbackQuote)
      : currentFxQuote
    if (contractLookup.contractCurrency === 'USD' && fxQuoteRate(reportingFxQuote) == null) {
      return badRequest("USD nasiya uchun muzlatilgan UZS kursi mavjud emas")
    }

    const effectivePaymentMethod = parsed.data.paymentBreakdown
      ? representativePaymentMethod(parsed.data.paymentBreakdown)
      : parsed.data.paymentMethod
    const commandHash = createHash('sha256').update(JSON.stringify({
      shopId,
      nasiyaId,
      actorId: session.user.id,
      mode: parsed.data.mode,
      date: parsed.data.date.toISOString(),
      reason: parsed.data.reason ?? null,
      inputCurrency,
      paymentMethod: effectivePaymentMethod ?? null,
      paymentBreakdown: canonicalPaymentBreakdown(parsed.data.paymentBreakdown, inputCurrency),
      expectedContractCurrency: parsed.data.expectedContractCurrency,
      expectedRemainingMinorUnits: parsed.data.expectedRemainingMinorUnits,
      expectedCashMinorUnits: parsed.data.expectedCashMinorUnits,
      expectedWaivedMinorUnits: parsed.data.expectedWaivedMinorUnits,
    })).digest('hex')

    const run = () => prisma.$transaction(async (tx) => {
      const replay = await tx.nasiyaSettlement.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
        select: {
          id: true,
          nasiyaId: true,
          actorId: true,
          commandHash: true,
        },
      })
      if (replay) {
        if (replay.nasiyaId !== nasiyaId || replay.actorId !== session.user.id || replay.commandHash !== commandHash) {
          throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan nasiya yopish amali uchun ishlatilgan" }
        }
        return { settlementId: replay.id, duplicate: true }
      }

      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
      if (session.user.role === 'SHOP_ADMIN') {
        const livePrincipal = await getLiveShopPrincipalForMutation(tx, { shopId, actorId: session.user.id })
        const allowed = livePrincipal &&
          principalHasFeature(livePrincipal, 'NASIYA') &&
          principalHasPermission(livePrincipal, 'NASIYA_PAYMENT_RECEIVE') &&
          (parsed.data.mode !== 'WAIVE_REMAINING_PROFIT' || principalHasPermission(livePrincipal, 'NASIYA_PROFIT_WAIVE'))
        if (!allowed) throw { status: 403, message: "Bu nasiya yopish amali uchun ruxsat berilmagan" }
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Nasiya"
        WHERE "id" = ${nasiyaId} AND "shopId" = ${shopId}
        FOR UPDATE
      `)
      const nasiya = await loadSettlementNasiyaForMutation(tx, { nasiyaId, shopId })
      if (!nasiya) throw { status: 404, message: 'Nasiya topilmadi' }
      const currentLedger = assertSettlementCandidate(nasiya)
      const quote = calculateNasiyaSettlement(settlementInput(nasiya, parsed.data.mode))
      if (parsed.data.mode === 'WAIVE_REMAINING_PROFIT' && !quote.waiverEligible) {
        throw { status: 409, message: quote.waiverIneligibilityReasons[0] ?? "Foydadan kechib yopish mumkin emas" }
      }
      if (!quoteMatchesExpected(quote, {
        currency: parsed.data.expectedContractCurrency,
        remaining: parsed.data.expectedRemainingMinorUnits,
        cash: parsed.data.expectedCashMinorUnits,
        waived: parsed.data.expectedWaivedMinorUnits,
      })) {
        throw {
          status: 409,
          message: "Qolgan summa o'zgargan. Yangilangan hisobni ko'rib, qayta tasdiqlang",
          quote,
        }
      }

      const inputMoney = convertMoneyDto(quote.cashToReceive, inputCurrency, currentFxQuote)
      const cashUzsMoney = convertMoneyDto(quote.cashToReceive, 'UZS', reportingFxQuote)
      const waiverUzsMoney = convertMoneyDto(quote.interestToWaive, 'UZS', reportingFxQuote)
      // The immutable settlement receipt freezes event-time UZS. The old
      // parent/schedule UZS fields are a different compatibility ledger that
      // must remain on the contract's creation-rate basis, just like a normal
      // final payment snap. Keeping both avoids FX movement corrupting legacy
      // expected = paid + waived identities.
      const legacyWaiverUzsMoney = convertMoneyDto(
        quote.interestToWaive,
        'UZS',
        nasiya.contractCurrency === 'USD' ? creationFallbackQuote : null,
      )
      if (!inputMoney || !cashUzsMoney || !waiverUzsMoney || !legacyWaiverUzsMoney) {
        throw { status: 400, message: "Yopish summasi uchun valyuta kursi mavjud emas" }
      }
      const inputAmount = moneyDtoToAmount(inputMoney)
      const cashUzs = moneyDtoToAmount(cashUzsMoney)
      const waiverUzs = moneyDtoToAmount(waiverUzsMoney)
      const legacyWaiverUzs = moneyDtoToAmount(legacyWaiverUzsMoney)
      if (quote.cashToReceive.minorUnits > 0 && !effectivePaymentMethod) {
        throw { status: 400, message: "To'lov usuli tanlanishi shart" }
      }
      if (parsed.data.paymentBreakdown) {
        const breakdownError = validatePaymentBreakdown(parsed.data.paymentBreakdown, inputAmount, inputCurrency)
        if (breakdownError) {
          throw { status: 409, message: `Joriy kurs bo'yicha ${breakdownError.toLowerCase()}` }
        }
      }

      const activeQuotes = quote.schedules.filter((row) => row.remainingBefore.minorUnits > 0)
      const cashQuotes = activeQuotes.filter((row) => row.cash.minorUnits > 0)
      const waiverQuotes = activeQuotes.filter((row) => row.interestWaived.minorUnits > 0)
      const cashUzsAllocations = cashQuotes.length > 0
        ? allocateUzsAcrossContractAmounts(cashUzs, cashQuotes.map((row) => settlementMoneyAmount(row.cash)))
        : []
      const waiverUzsAllocations = waiverQuotes.length > 0
        ? allocateUzsAcrossContractAmounts(waiverUzs, waiverQuotes.map((row) => settlementMoneyAmount(row.interestWaived)))
        : []
      const legacyWaiverUzsAllocations = waiverQuotes.length > 0
        ? allocateUzsAcrossContractAmounts(legacyWaiverUzs, waiverQuotes.map((row) => settlementMoneyAmount(row.interestWaived)))
        : []
      const cashUzsBySchedule = new Map(cashQuotes.map((row, index) => [row.scheduleId, cashUzsAllocations[index]]))
      const waiverUzsBySchedule = new Map(waiverQuotes.map((row, index) => [row.scheduleId, waiverUzsAllocations[index]]))
      const legacyWaiverUzsBySchedule = new Map(waiverQuotes.map((row, index) => [row.scheduleId, legacyWaiverUzsAllocations[index]]))
      const scheduleById = new Map(nasiya.schedules.map((schedule) => [schedule.id, schedule]))
      const legacyParentWaivedAfter = Number(nasiya.interestWaivedAmount) + legacyWaiverUzs
      if (
        !Number.isSafeInteger(legacyParentWaivedAfter) ||
        legacyParentWaivedAfter < 0 ||
        legacyParentWaivedAfter > Number(nasiya.interestAmount)
      ) {
        throw { status: 409, message: "Nasiya UZS foyda yozuvi shartnoma kursi bilan mos emas; avval tekshiruv kerak" }
      }

      for (const row of activeQuotes) {
        const schedule = scheduleById.get(row.scheduleId)
        if (!schedule) throw { status: 409, message: "Nasiya jadvali o'zgargan" }
        const cashContract = settlementMoneyAmount(row.cash)
        const waivedContract = settlementMoneyAmount(row.interestWaived)
        const waivedLegacy = legacyWaiverUzsBySchedule.get(row.scheduleId) ?? 0
        const legacyWaivedAfter = Number(schedule.interestWaivedAmount) + waivedLegacy
        const legacyExpected = Number(schedule.expectedAmount)
        if (
          !Number.isSafeInteger(legacyWaivedAfter) ||
          legacyWaivedAfter < 0 ||
          legacyWaivedAfter > legacyExpected
        ) {
          throw { status: 409, message: "Nasiya jadvali UZS foyda yozuvi shartnoma kursi bilan mos emas; avval tekshiruv kerak" }
        }
        const updated = await tx.nasiyaSchedule.updateMany({
          where: {
            id: schedule.id,
            nasiyaId,
            shopId,
            contractPaidAmount: schedule.contractPaidAmount,
            contractInterestWaivedAmount: schedule.contractInterestWaivedAmount,
            contractRemainingAmount: schedule.contractRemainingAmount,
          },
          data: {
            // Every settlement closes the native row. Snap its legacy paid
            // mirror to the frozen expected amount less only the creation-rate
            // waiver; event-time cash remains on the payment/allocation receipt.
            paidAmount: legacyExpected - legacyWaivedAfter,
            interestWaivedAmount: legacyWaivedAfter,
            status: row.status,
            paidAt: cashContract > 0 ? parsed.data.date : schedule.paidAt,
            paymentMethod: cashContract > 0 ? effectivePaymentMethod : schedule.paymentMethod,
            note: parsed.data.reason ?? schedule.note,
            contractPaidAmount: Number(schedule.contractPaidAmount) + cashContract,
            contractInterestWaivedAmount: Number(schedule.contractInterestWaivedAmount) + waivedContract,
            contractRemainingAmount: 0,
            ...(row.paidComponentsAfter
              ? {
                  contractPrincipalPaidAmount: row.paidComponentsAfter.principal,
                  contractMarginPaidAmount: row.paidComponentsAfter.margin,
                  contractInterestPaidAmount: row.paidComponentsAfter.interest,
                }
              : {}),
          },
        })
        if (updated.count !== 1) throw { status: 409, message: "Nasiya jadvali bir vaqtda yangilangan, qayta urinib ko'ring" }
      }

      let paymentId: string | null = null
      const paymentAllocationRows: Prisma.NasiyaPaymentAllocationCreateManyInput[] = []
      if (quote.cashToReceive.minorUnits > 0) {
        const payment = await tx.nasiyaPayment.create({
          data: {
            nasiyaId,
            nasiyaScheduleId: null,
            shopId,
            amount: cashUzs,
            paymentMethod: effectivePaymentMethod,
            paymentBreakdown: parsed.data.paymentBreakdown ?? undefined,
            paidAt: parsed.data.date,
            note: parsed.data.reason,
            idempotencyKey: `settlement:${idempotencyKey}`,
            createdBy: session.user.id,
            paymentInputAmount: inputAmount,
            paymentInputCurrency: inputCurrency,
            appliedAmountInContractCurrency: settlementMoneyAmount(quote.cashToReceive),
            paymentExchangeRate: fxQuoteRate(currentFxQuote),
            paymentExchangeRateSource: fxQuoteRate(currentFxQuote) != null
              ? currentFxQuote?.source
              : inputCurrency === 'USD' && nasiya.contractCurrency === 'USD'
                ? 'UNAVAILABLE_SAME_CURRENCY'
                : null,
            paymentExchangeRateEffectiveAt: currentFxQuote?.effectiveAt ? new Date(currentFxQuote.effectiveAt) : null,
            paymentExchangeRateFetchedAt: currentFxQuote?.fetchedAt ? new Date(currentFxQuote.fetchedAt) : null,
          },
        })
        paymentId = payment.id

        for (const row of cashQuotes) {
          if (!row.cashComponents) {
            if (nasiya.accountingReconstructionStatus === 'COMPLETE') {
              throw { status: 409, message: "Nasiya foyda tarkibi to'lov dalillari bilan mos emas" }
            }
            continue
          }
          const amountUzs = cashUzsBySchedule.get(row.scheduleId) ?? 0
          const reporting = splitUzsReportingAmount({
            amountUzs,
            contractAmount: settlementMoneyAmount(row.cash),
            contractComponents: row.cashComponents,
          })
          paymentAllocationRows.push({
            shopId,
            nasiyaId,
            nasiyaPaymentId: payment.id,
            nasiyaScheduleId: row.scheduleId,
            sequence: paymentAllocationRows.length + 1,
            contractCurrency: nasiya.contractCurrency,
            contractAmount: settlementMoneyAmount(row.cash),
            contractPrincipalAmount: row.cashComponents.principal,
            contractMarginAmount: row.cashComponents.margin,
            contractInterestAmount: row.cashComponents.interest,
            amountUzs,
            principalAmountUzs: reporting.principal,
            marginAmountUzs: reporting.margin,
            interestAmountUzs: reporting.interest,
          })
        }
        if (paymentAllocationRows.length > 0) {
          await tx.nasiyaPaymentAllocation.createMany({ data: paymentAllocationRows })
        }
      }

      const paidAfter = addMoneyDto(currentLedger.paid, quote.cashToReceive)
      const waivedAfter = addMoneyDto(currentLedger.waived, quote.interestToWaive)
      const updatedSchedules = await tx.nasiyaSchedule.findMany({
        where: { nasiyaId, shopId },
        orderBy: { monthNumber: 'asc' },
        take: MAX_SETTLEMENT_SCHEDULES + 1,
      })
      const updatedAllocations = nasiya.accountingReconstructionStatus === 'COMPLETE'
        ? await tx.nasiyaPaymentAllocation.findMany({
            where: { nasiyaId, shopId },
            select: { nasiyaScheduleId: true, contractCurrency: true, contractAmount: true },
            take: MAX_LEDGER_ALLOCATIONS + MAX_SETTLEMENT_SCHEDULES + 1,
          })
        : []
      if (updatedAllocations.length > MAX_LEDGER_ALLOCATIONS + MAX_SETTLEMENT_SCHEDULES) {
        throw { status: 409, message: "Nasiya to'lov ledgeri yopish chegarasidan oshgan; avval tekshiruv kerak" }
      }
      const postLedger = reconcileNasiyaLedger({
        status: 'COMPLETED',
        contractCurrency: nasiya.contractCurrency,
        contractFinalAmount: nasiya.contractFinalAmount.toString(),
        contractPaidAmount: moneyDtoToAmount(paidAfter),
        contractInterestWaivedAmount: moneyDtoToAmount(waivedAfter),
        contractRemainingAmount: 0,
        schedules: updatedSchedules.map((schedule) => ({
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
        allocations: updatedAllocations.map((allocation) => ({
          nasiyaScheduleId: allocation.nasiyaScheduleId,
          contractCurrency: allocation.contractCurrency,
          contractAmount: allocation.contractAmount.toString(),
        })),
      }, parsed.data.date)
      if (postLedger.health !== 'HEALTHY' || postLedger.status !== 'COMPLETED') {
        throw { status: 409, message: "Nasiya yopilgandan keyin ledger mos kelmadi; amal bekor qilindi" }
      }

      const reportingRate = fxQuoteRate(reportingFxQuote)
      const settlement = await tx.nasiyaSettlement.create({
        data: {
          shopId,
          nasiyaId,
          nasiyaPaymentId: paymentId,
          mode: parsed.data.mode,
          contractCurrency: nasiya.contractCurrency,
          contractRemainingBefore: settlementMoneyAmount(quote.remainingBefore),
          contractCashReceivedAmount: settlementMoneyAmount(quote.cashToReceive),
          contractInterestWaivedAmount: settlementMoneyAmount(quote.interestToWaive),
          contractRemainingAfter: 0,
          cashReceivedAmountUzs: cashUzs,
          interestWaivedAmountUzs: waiverUzs,
          frozenUsdUzsRate: reportingRate,
          frozenUsdUzsRateSource: reportingFxQuote?.source,
          frozenUsdUzsRateEffectiveAt: reportingFxQuote?.effectiveAt ? new Date(reportingFxQuote.effectiveAt) : null,
          frozenUsdUzsRateFetchedAt: reportingFxQuote?.fetchedAt ? new Date(reportingFxQuote.fetchedAt) : null,
          settledAt: parsed.data.date,
          reason: parsed.data.reason,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          idempotencyKey,
          commandHash,
        },
      })
      await tx.nasiyaSettlementAllocation.createMany({
        data: activeQuotes.map((row, index) => ({
          shopId,
          nasiyaId,
          nasiyaSettlementId: settlement.id,
          nasiyaScheduleId: row.scheduleId,
          sequence: index + 1,
          contractCurrency: nasiya.contractCurrency,
          contractRemainingBefore: settlementMoneyAmount(row.remainingBefore),
          contractCashAmount: settlementMoneyAmount(row.cash),
          contractInterestWaivedAmount: settlementMoneyAmount(row.interestWaived),
          contractRemainingAfter: 0,
          cashAmountUzs: cashUzsBySchedule.get(row.scheduleId) ?? 0,
          interestWaivedAmountUzs: waiverUzsBySchedule.get(row.scheduleId) ?? 0,
        })),
      })

      await tx.nasiya.update({
        where: { id: nasiyaId },
        data: {
          remainingAmount: 0,
          interestWaivedAmount: legacyParentWaivedAfter,
          contractPaidAmount: moneyDtoToAmount(paidAfter),
          contractInterestWaivedAmount: moneyDtoToAmount(waivedAfter),
          contractRemainingAmount: 0,
          status: 'COMPLETED',
          reminderEnabled: false,
          earlyReminderEnabled: false,
        },
      })

      const scheduleIds = nasiya.schedules.map((schedule) => schedule.id)
      const cancelledAt = new Date()
      await tx.notification.updateMany({
        where: {
          shopId,
          type: { in: ['REMINDER', 'OVERDUE', 'EARLY_REMINDER'] },
          status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
          OR: [
            { relatedType: 'Nasiya', relatedId: nasiyaId },
            { relatedType: 'NasiyaSchedule', relatedId: { in: scheduleIds } },
          ],
        },
        data: {
          status: 'CANCELLED',
          cancelledAt,
          nextAttemptAt: null,
          lastError: 'Cancelled: nasiya settled',
        },
      })

      const recipients = await resolveTelegramRecipients(tx, {
        shopId,
        audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
      })
      const message = nasiyaSettlementCompletedMessage({
        shopName: nasiya.shop.name,
        customerName: nasiya.customer.name,
        customerPhone: nasiya.customer.phone,
        device: presentDeviceSpecs(nasiya.device),
        mode: parsed.data.mode,
        cashReceived: settlementMoneyAmount(quote.cashToReceive),
        interestWaived: settlementMoneyAmount(quote.interestToWaive),
        contractCurrency: nasiya.contractCurrency,
        reason: parsed.data.reason,
        adminName: session.user.name,
        currency: currencyContext,
      })
      const notificationRows = [
        ...telegramNotificationRows(recipients, {
          type: 'NASIYA_COMPLETED',
          message,
          scheduledAt: cancelledAt,
          relatedId: nasiyaId,
          relatedType: 'Nasiya',
          dedupeKey: (recipient) => `NASIYA_SETTLEMENT:${settlement.id}:${recipient.id}`,
        }),
        ...telegramUnavailableMarkerRows(recipients, {
          type: 'NASIYA_COMPLETED',
          dedupeScope: settlement.id,
          cancelledAt,
        }),
      ]
      if (notificationRows.length > 0) await tx.notification.createMany({ data: notificationRows })

      const audit = currentBusinessLogContext()
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: parsed.data.mode === 'FULL_WITH_PROFIT'
            ? 'NASIYA_SETTLED_FULL_WITH_PROFIT'
            : 'NASIYA_SETTLED_PROFIT_WAIVED',
          targetType: 'Nasiya',
          targetId: nasiyaId,
          oldValue: {
            contractCurrency: nasiya.contractCurrency,
            remainingAmount: settlementMoneyAmount(quote.remainingBefore),
          },
          newValue: {
            settlementId: settlement.id,
            mode: parsed.data.mode,
            cashReceived: settlementMoneyAmount(quote.cashToReceive),
            interestWaived: settlementMoneyAmount(quote.interestToWaive),
            remainingAmount: 0,
            inputCurrency,
            inputAmount,
            paymentMethod: effectivePaymentMethod ?? null,
            paymentBreakdown: parsed.data.paymentBreakdown ?? null,
            settledAt: parsed.data.date.toISOString(),
          },
          note: parsed.data.reason,
          requestId: audit.requestId,
          ipAddress: audit.ipAddress,
        },
      })

      return { settlementId: settlement.id, duplicate: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    const transactionStartedAt = performance.now()
    let transactionResult: Awaited<ReturnType<typeof run>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        transactionResult = await run()
        break
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 2) continue
        throw error
      }
    }
    timings.serializableTransaction = performance.now() - transactionStartedAt
    if (!transactionResult) return serverError()

    const receiptStartedAt = performance.now()
    const stored = await prisma.nasiyaSettlement.findUniqueOrThrow({
      where: { id: transactionResult.settlementId },
      include: storedSettlementInclude,
    })
    const result = serializedSettlement(stored, transactionResult.duplicate)
    timings.receiptRead = performance.now() - receiptStartedAt

    if (!result.duplicate) invalidateShopNasiyaSettlementMutation(shopId)
    after(() => flushQueuedTelegramWork().catch((error) => logger.warn('notification flush failed', {
      event: 'notification.flush_failed',
      error,
    })))

    const durationMs = performance.now() - startedAt
    for (const [phase, duration] of Object.entries(timings)) recordRequestTiming(`settlement-${phase}`, duration)
    if (process.env.PERFORMANCE_TIMING_LOGS === 'true' || durationMs >= 800) {
      logger.info('Nasiya settlement performance timing', {
        event: 'performance.nasiya_settlement',
        shopId: measuredShopId,
        durationMs: Math.round(durationMs),
        phasesMs: Object.fromEntries(Object.entries(timings).map(([phase, value]) => [phase, Math.round(value)])),
        status: result.duplicate ? 'idempotent_replay' : 'confirmed',
      })
    }
    return ok(result, result.duplicate ? 'Nasiya avval yopilgan' : 'Nasiya muvaffaqiyatli yopildi')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const typed = error as { status: number; message: string }
      if (typed.status === 400) return badRequest(typed.message)
      if (typed.status === 403) return forbidden(typed.message)
      if (typed.status === 404) return notFound(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict("Idempotency-Key bo'yicha nasiya yopish amali allaqachon yozilgan")
    }
    logger.error('[POST /api/nasiya/[id]/settlement]', {
      event: 'api.route_error',
      shopId: measuredShopId,
      error,
    })
    return serverError()
  }
}
