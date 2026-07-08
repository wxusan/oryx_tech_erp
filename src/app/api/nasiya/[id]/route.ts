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

import { NextRequest, after } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireApiSession } from '@/lib/api-auth'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { computeNasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { deriveNasiyaOverdue } from '@/lib/nasiya-utils'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { logger } from '@/lib/logger'

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
  customerPhone: z.string().trim().min(9, "Telefon raqam kamida 9 ta raqam bo'lishi kerak").max(20).optional(),
  note: z.string().trim().max(1000, "Izoh 1000 belgidan oshmasligi kerak").optional(),
  importNote: z.string().trim().max(1000, "Import izohi 1000 belgidan oshmasligi kerak").optional(),
  reminderEnabled: z.boolean().optional(),
  reason: z.string().trim().min(5, "Tahrirlash sababi kamida 5 ta belgidan iborat bo'lishi kerak").max(1000).optional(),
})

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

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
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            // Included so the nasiya profile page can render the passport photo.
            // Access is already shop-scoped (this nasiya is fetched only for its
            // owning shop) and the signed URL is separately per-shop authorized.
            passportPhotoUrl: true,
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
        payments: {
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
        },
      },
    })

    if (!nasiya) return notFound('Nasiya topilmadi')

    const scheduleInputs = nasiya.schedules.map((s) => ({
      status: s.status,
      dueDate: s.dueDate,
      delayedUntil: s.delayedUntil,
      expectedAmount: Number(s.expectedAmount),
      paidAmount: Number(s.paidAmount),
    }))
    // Same derivation the nasiyalar list uses (src/lib/server/shop-lists.ts) —
    // a single source of truth so the detail page's badge/buttons/score can
    // never disagree with the list. This also self-heals a nasiya whose
    // schedules are effectively fully paid (within COMPLETION_ROUNDING_TOLERANCE_UZS)
    // but whose stored `status` hasn't been flipped to COMPLETED yet.
    const derived = deriveNasiyaOverdue({ status: nasiya.status, schedules: scheduleInputs })

    // Reason text must respect the shop's selected display currency, not
    // hardcode UZS — see docs/nasiya-payment-scoring.md. The score itself
    // must read the deal's own contract-currency amounts (never the legacy
    // UZS snapshot) — see docs/currency-accounting-model.md.
    const currency = await getShopCurrencyContext(nasiya.shopId)
    const paymentScore = computeNasiyaPaymentScore(
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
      currency,
      nasiya.contractCurrency,
    )

    // Best-effort self-heal: persist the COMPLETED status now that we know
    // it's true, so the raw DB column stops disagreeing with the derived
    // display (dashboard active-nasiya counts read the raw column directly).
    // Never blocks the response; a failure here just means the next payment
    // attempt (which re-derives the same way) tries again.
    if (derived.displayStatus === 'COMPLETED' && nasiya.status !== 'COMPLETED') {
      after(() =>
        prisma.nasiya
          .updateMany({
            where: { id: nasiya.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
            data: { remainingAmount: 0, status: 'COMPLETED' },
          })
          .catch((e) => logger.warn('nasiya completion self-heal failed', { event: 'nasiya.self_heal_failed', error: e }))
      )
    }

    return ok(
      {
        ...nasiya,
        displayStatus: derived.displayStatus,
        isOverdue: derived.isOverdue,
        overdueAmount: derived.overdueAmount,
        paymentScore,
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
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    if (body && typeof body === 'object') {
      const forbidden = forbiddenMoneyFields.find((field) => field in body)
      if (forbidden) {
        return badRequest("Pul summalari to'lovlar va hisobotlarga bog'langan. Ularni tuzatish uchun alohida adjustment kerak.")
      }
    }
    const parsed = updateNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
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
