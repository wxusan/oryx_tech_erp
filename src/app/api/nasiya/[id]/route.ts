/**
 * GET   /api/nasiya/[id] — get a single nasiya with full details
 * PATCH /api/nasiya/[id] — edit SAFE nasiya fields only (note).
 *
 * Financial terms (finalNasiyaAmount, remainingAmount, paidAmount, schedule
 * amounts, interestPercent, downPayment, months) are NOT editable here — they
 * would rewrite money/payment history. Correcting those requires a dedicated
 * correction flow (future work). Reminder toggling lives in ./reminder.
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN
 */

import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireShopAnyPermission } from '@/lib/api-auth'
import { ok, badRequest, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { phoneSchema } from '@/lib/validations'
import { computeNasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { computeCustomerTrustRating, isValidTrustTier, type CustomerNasiyaInput } from '@/lib/nasiya-customer-trust'
import { logger } from '@/lib/logger'
import { principalHasPermission } from '@/lib/server/shop-access'

type RouteContext = { params: Promise<{ id: string }> }

const forbiddenMoneyFields = [
  'totalAmount',
  'downPayment',
  'baseRemainingAmount',
  'interestPercent',
  'interestAmount',
  'finalNasiyaAmount',
  'remainingAmount',
  'months',
  'monthlyPayment',
] as const

const updateNasiyaSchema = z.object({
  customerName: z.string().trim().min(2, "Mijoz ismi kamida 2 ta harfdan iborat bo'lishi kerak").max(100).optional(),
  customerPhone: phoneSchema.optional(),
  // A submitted blank is an intentional clear. Persist null rather than a
  // misleading empty-string comment, while an omitted field still means
  // "leave this value unchanged".
  note: z.string().trim().max(1000, "Izoh 1000 belgidan oshmasligi kerak").optional().transform((value) => value === undefined ? undefined : value || null),
  importNote: z.string().trim().max(1000, "Import izohi 1000 belgidan oshmasligi kerak").optional().transform((value) => value === undefined ? undefined : value || null),
  reminderEnabled: z.boolean().optional(),
  // Retained for API compatibility with older clients. It is ordinary edit
  // context, never a mandatory reason for a financial correction.
  reason: z.string().trim().max(1000, "Sabab 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
})

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission([
      'NASIYA_VIEW',
      'NASIYA_CREATE',
      'NASIYA_EDIT',
      'NASIYA_PAYMENT_RECEIVE',
      'NASIYA_DEFER',
      'NASIYA_REMINDER_MANAGE',
      'NASIYA_CANCEL',
      'NASIYA_ARCHIVE',
      'NASIYA_WRITE_OFF',
      'NASIYA_REOPEN',
    ])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeResolutionData = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && ['NASIYA_ARCHIVE', 'NASIYA_WRITE_OFF', 'NASIYA_REOPEN'].some((permission) => (
          principalHasPermission(guarded.principal!, permission as 'NASIYA_ARCHIVE' | 'NASIYA_WRITE_OFF' | 'NASIYA_REOPEN')
        )),
      )
    const includeProfileData = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && [
          'NASIYA_VIEW',
          'NASIYA_EDIT',
          'NASIYA_REMINDER_MANAGE',
          'NASIYA_ARCHIVE',
          'NASIYA_WRITE_OFF',
          'NASIYA_REOPEN',
        ].some((permission) => principalHasPermission(
          guarded.principal!,
          permission as 'NASIYA_VIEW' | 'NASIYA_EDIT' | 'NASIYA_REMINDER_MANAGE' |
            'NASIYA_ARCHIVE' | 'NASIYA_WRITE_OFF' | 'NASIYA_REOPEN',
        )),
      )
    const includePaymentHistory = includeProfileData || session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasPermission(guarded.principal, 'NASIYA_PAYMENT_RECEIVE'),
    )
    const includeCustomerTrust = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && principalHasPermission(guarded.principal, 'NASIYA_VIEW'),
      )
    const canViewPassportPhoto = session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasPermission(guarded.principal, 'CUSTOMER_PASSPORT_PHOTO_VIEW'),
    )

    const { id: nasiyaId } = await ctx.params

    const nasiya = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: {
        id: true,
        shopId: true,
        totalAmount: true,
        downPayment: true,
        baseRemainingAmount: true,
        interestPercent: true,
        interestAmount: true,
        finalNasiyaAmount: true,
        remainingAmount: true,
        // Native contract-currency ledger — the actual source of truth for
        // debt/schedule math. See docs/currency-accounting-model.md.
        contractCurrency: true,
        contractTotalAmount: true,
        contractDownPayment: true,
        contractInterestAmount: true,
        contractFinalAmount: true,
        contractMonthlyPayment: true,
        contractRemainingAmount: true,
        contractPaidAmount: true,
        status: true,
        resolutionState: true,
        resolutionUpdatedAt: true,
        ...(includeProfileData ? {
          reminderEnabled: true,
          note: true,
          isImported: true,
          importSource: true,
          importedAt: true,
          originalSaleDate: true,
          originalTotalAmount: true,
          alreadyPaidBeforeImport: true,
          remainingAtImport: true,
          importNote: true,
        } : {}),
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(canViewPassportPhoto ? { passportPhotoUrl: true } : {}),
            ...(includeCustomerTrust ? { trustOverride: true } : {}),
          },
        },
        device: {
          select: {
            id: true,
            model: true,
          },
        },
        schedules: {
          orderBy: { monthNumber: 'asc' },
          select: {
            id: true,
            monthNumber: true,
            dueDate: true,
            delayedUntil: true,
            expectedAmount: true,
            paidAmount: true,
            status: true,
            paidAt: true,
            contractExpectedAmount: true,
            contractPaidAmount: true,
          },
        },
        ...(includePaymentHistory ? { payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            paymentBreakdown: true,
            paidAt: true,
            note: true,
            nasiyaScheduleId: true,
            paymentInputAmount: true,
            paymentInputCurrency: true,
            paymentExchangeRate: true,
            appliedAmountInContractCurrency: true,
          },
        } } : {}),
      },
    })

    if (!nasiya) return notFound('Nasiya topilmadi')

    // Resolution events contain write-off/archive amounts and immutable
    // financial/audit context. Staff may operate active Nasiyas but must not
    // receive this owner-only ledger payload even through a direct URL.
    const resolutionEvents = includeResolutionData
      ? await prisma.nasiyaResolutionEvent.findMany({
          where: { shopId: nasiya.shopId, nasiyaId: nasiya.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            eventType: true,
            previousState: true,
            newState: true,
            contractCurrency: true,
            nativeRemainingAmount: true,
            frozenUzsAmount: true,
            frozenUsdUzsRate: true,
            reason: true,
            actorId: true,
            actorType: true,
            reversesEventId: true,
            createdAt: true,
          },
        })
      : []

    const scheduleInputs = nasiya.schedules.map((s) => ({
      status: s.status,
      dueDate: s.dueDate,
      delayedUntil: s.delayedUntil,
      expectedAmount: Number(s.expectedAmount),
      paidAmount: Number(s.paidAmount),
      contractExpectedAmount: Number(s.contractExpectedAmount),
      contractPaidAmount: Number(s.contractPaidAmount),
    }))
    // Same contract-authoritative derivation the nasiya list uses. The legacy
    // UZS schedule mirror can diverge when exchange rates move, so it must
    // never decide this badge or whether a final payment remains possible.
    const derived = deriveContractNasiyaStatus({
      status: nasiya.status,
      contractCurrency: nasiya.contractCurrency,
      contractFinalAmount: Number(nasiya.contractFinalAmount),
      contractRemainingAmount: Number(nasiya.contractRemainingAmount),
      schedules: scheduleInputs,
    })

    // Reason text must respect the shop's selected display currency, not
    // hardcode UZS — see docs/nasiya-payment-scoring.md. The score itself
    // must read the deal's own contract-currency amounts (never the legacy
    // UZS snapshot) — see docs/currency-accounting-model.md.
    const paymentScore = includeProfileData
      ? computeNasiyaPaymentScore(
          {
            schedules: nasiya.schedules.map((s) => ({
              status: s.status,
              dueDate: s.dueDate,
              delayedUntil: s.delayedUntil,
              expectedAmount: Number(s.contractExpectedAmount),
              paidAmount: Number(s.contractPaidAmount),
              paidAt: s.paidAt,
            })),
          },
          new Date(),
          await getShopCurrencyContext(nasiya.shopId),
          nasiya.contractCurrency,
        )
      : null

    // Item 12 — customer trust rating, aggregated across ALL of this
    // customer's nasiyas in this shop (not just this one deal).
    const customerNasiyas = includeCustomerTrust
      ? await prisma.nasiya.findMany({
          where: { customerId: nasiya.customer.id, shopId: nasiya.shopId, deletedAt: null },
          select: {
            status: true,
            resolutionState: true,
            contractCurrency: true,
            schedules: {
              select: {
                status: true,
                dueDate: true,
                delayedUntil: true,
                contractExpectedAmount: true,
                contractPaidAmount: true,
                paidAt: true,
              },
            },
          },
        })
      : []
    const customerTrustInputs: CustomerNasiyaInput[] = customerNasiyas.map((n) => ({
      status: n.status,
      resolutionState: n.resolutionState,
      contractCurrency: n.contractCurrency,
      schedules: n.schedules.map((s) => ({
        status: s.status,
        dueDate: s.dueDate,
        delayedUntil: s.delayedUntil,
        expectedAmount: Number(s.contractExpectedAmount),
        paidAmount: Number(s.contractPaidAmount),
        paidAt: s.paidAt,
      })),
    }))
    const trustOverrideValue = 'trustOverride' in nasiya.customer ? nasiya.customer.trustOverride : null
    const trustOverride = isValidTrustTier(trustOverrideValue) ? trustOverrideValue : null
    const customerTrust = includeCustomerTrust
      ? computeCustomerTrustRating(customerTrustInputs, new Date(), trustOverride)
      : null
    const passportPhotoUrl = 'passportPhotoUrl' in nasiya.customer ? nasiya.customer.passportPhotoUrl : null
    const customer = {
      id: nasiya.customer.id,
      name: nasiya.customer.name,
      phone: nasiya.customer.phone,
      ...(canViewPassportPhoto ? { hasPassportPhoto: Boolean(passportPhotoUrl) } : {}),
    }

    return ok(
      {
        ...nasiya,
        customer,
        displayStatus: derived.displayStatus,
        isOverdue: derived.isOverdue,
        overdueAmount: derived.overdueAmount,
        ...(paymentScore ? { paymentScore } : {}),
        ...(customerTrust ? { customerTrust } : {}),
        ...(includeResolutionData
          ? {
              resolutionEvents: resolutionEvents.map((event) => ({
                ...event,
                nativeRemainingAmount: Number(event.nativeRemainingAmount),
                frozenUzsAmount: Number(event.frozenUzsAmount),
                frozenUsdUzsRate: Number(event.frozenUsdUzsRate),
              })),
            }
          : {}),
      },
      "Nasiya ma'lumotlari",
    )
  } catch (err) {
    logger.error('[GET /api/nasiya/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission(['NASIYA_EDIT', 'NASIYA_REMINDER_MANAGE'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    if (body && typeof body === 'object') {
      const forbidden = forbiddenMoneyFields.find((field) => field in body)
      if (forbidden) {
        return badRequest("Pul summalari to'lovlar va hisobotlarga bog'langan. Ularni tuzatish uchun alohida tasdiqlangan moliyaviy tuzatish amali kerak.")
      }
    }
    const parsed = updateNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const hasOrdinaryEdit = parsed.data.customerName !== undefined || parsed.data.customerPhone !== undefined ||
      parsed.data.note !== undefined || parsed.data.importNote !== undefined || parsed.data.reason !== undefined
    if (
      session.user.role !== 'SUPER_ADMIN' &&
      ((hasOrdinaryEdit && (!guarded.principal || !principalHasPermission(guarded.principal, 'NASIYA_EDIT'))) ||
        (parsed.data.reminderEnabled !== undefined && (!guarded.principal || !principalHasPermission(guarded.principal, 'NASIYA_REMINDER_MANAGE'))))
    ) {
      return forbidden("So'rovdagi barcha nasiya o'zgarishlari uchun alohida ruxsat kerak")
    }
    if (
      parsed.data.customerName === undefined &&
      parsed.data.customerPhone === undefined &&
      parsed.data.note === undefined &&
      parsed.data.importNote === undefined &&
      parsed.data.reminderEnabled === undefined
    ) {
      return badRequest("O'zgartirish uchun ma'lumot kiritilmadi")
    }

    const existing = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        note: true,
        importNote: true,
        reminderEnabled: true,
        customer: { select: { name: true, phone: true, normalizedPhone: true } },
      },
    })
    if (!existing) return notFound('Nasiya topilmadi')

    const updated = await prisma.$transaction(async (tx) => {
      const customerUpdate = {
        ...(parsed.data.customerName !== undefined ? { name: parsed.data.customerName } : {}),
        ...(parsed.data.customerPhone !== undefined
          ? { phone: parsed.data.customerPhone, normalizedPhone: normalizePhone(parsed.data.customerPhone) }
          : {}),
      }
      if (Object.keys(customerUpdate).length > 0) {
        await tx.customer.update({ where: { id: existing.customerId }, data: customerUpdate })
      }
      const nasiyaUpdate = {
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(parsed.data.importNote !== undefined ? { importNote: parsed.data.importNote } : {}),
        ...(parsed.data.reminderEnabled !== undefined ? { reminderEnabled: parsed.data.reminderEnabled } : {}),
      }
      const nasiya = await tx.nasiya.update({
        where: { id: existing.id },
        data: nasiyaUpdate,
        select: {
          id: true,
          note: true,
          importNote: true,
          reminderEnabled: true,
          customer: { select: { name: true, phone: true } },
        },
      })
      await tx.log.create({
        data: {
          shopId: existing.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Nasiya',
          targetId: existing.id,
          oldValue: {
            customerName: existing.customer.name,
            customerPhone: existing.customer.phone,
            note: existing.note,
            importNote: existing.importNote,
            reminderEnabled: existing.reminderEnabled,
          },
          newValue: { ...nasiyaUpdate, ...customerUpdate, auditReason: parsed.data.reason ?? parsed.data.note },
          note: parsed.data.reason ?? parsed.data.note,
        },
      })
      return nasiya
    })

    invalidateShopNasiyaMutation(existing.shopId)

    return ok(updated, "Nasiya ma'lumotlari yangilandi")
  } catch (err) {
    logger.error('[PATCH /api/nasiya/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
