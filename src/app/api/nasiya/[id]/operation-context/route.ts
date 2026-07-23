import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireShopPermissionAndFeature } from '@/lib/api-auth'
import { badRequest, notFound, ok, serverError } from '@/lib/api-helpers'
import { createMoneyDto } from '@/lib/currency'
import { reconcileNasiyaLedger } from '@/lib/nasiya-ledger'
import type { NasiyaOperationContext } from '@/lib/nasiya-operation-context'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * A dialog needs authoritative schedule balances, not the expensive detail
 * response. This route deliberately avoids payments, resolution history,
 * customer trust, audit logs, currency lookups, and passport state.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const intent = req.nextUrl.searchParams.get('intent')
    const guarded = await requireShopPermissionAndFeature(
      intent === 'defer' ? 'NASIYA_DEFER' : 'NASIYA_PAYMENT_RECEIVE',
      'NASIYA',
    )
    if (!guarded.ok) return guarded.response
    if (intent !== 'payment' && intent !== 'defer') {
      return badRequest("Amal turi 'payment' yoki 'defer' bo'lishi kerak")
    }

    const { id } = await ctx.params
    const shopId = guarded.session.user.role === 'SHOP_ADMIN'
      ? guarded.session.user.shopId
      : req.nextUrl.searchParams.get('shopId')

    // Super-admin operational actions must name their target tenant; shop
    // members are always bound to their session tenant.
    if (!shopId) return badRequest("Do'kon ma'lumotlari topilmadi")

    const nasiya = await prisma.nasiya.findFirst({
      where: {
        id,
        shopId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        shop: { status: 'ACTIVE', deletedAt: null },
      },
      select: {
        id: true,
        contractCurrency: true,
        contractFinalAmount: true,
        contractPaidAmount: true,
        contractInterestWaivedAmount: true,
        contractRemainingAmount: true,
        accountingReconstructionStatus: true,
        status: true,
        customer: { select: { name: true } },
        device: { select: { model: true } },
        schedules: {
          orderBy: { monthNumber: 'asc' },
          select: {
            id: true,
            monthNumber: true,
            dueDate: true,
            delayedUntil: true,
            status: true,
            expectedAmount: true,
            paidAmount: true,
            contractCurrency: true,
            contractExpectedAmount: true,
            contractPaidAmount: true,
            contractInterestWaivedAmount: true,
            contractRemainingAmount: true,
            interestWaivedAmount: true,
          },
        },
        paymentAllocations: {
          select: {
            nasiyaScheduleId: true,
            contractCurrency: true,
            contractAmount: true,
          },
        },
      },
    })
    if (!nasiya) return notFound('Nasiya topilmadi')

    const ledger = reconcileNasiyaLedger({
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
    const reconciledSchedules = new Map(ledger.schedules.map((schedule) => [schedule.id, schedule]))
    const data: NasiyaOperationContext = {
      id: nasiya.id,
      customer: nasiya.customer,
      device: nasiya.device,
      contractCurrency: nasiya.contractCurrency,
      ledger: {
        paid: ledger.paid,
        waived: ledger.waived,
        remaining: ledger.remaining,
        status: ledger.status,
        health: ledger.health,
      },
      schedules: nasiya.schedules.map((schedule) => {
        const reconciled = reconciledSchedules.get(schedule.id)
        return {
          id: schedule.id,
          monthNumber: schedule.monthNumber,
          dueDate: schedule.dueDate.toISOString(),
          delayedUntil: schedule.delayedUntil?.toISOString() ?? null,
          status: schedule.status,
          expected: reconciled?.expected ?? createMoneyDto(nasiya.contractCurrency, 0),
          paid: reconciled?.paid ?? createMoneyDto(nasiya.contractCurrency, 0),
          waived: reconciled?.waived ?? createMoneyDto(nasiya.contractCurrency, 0),
          remaining: reconciled?.remaining ?? createMoneyDto(nasiya.contractCurrency, 0),
          legacyExpected: createMoneyDto('UZS', schedule.expectedAmount.toString()),
          legacyPaid: createMoneyDto('UZS', schedule.paidAmount.toString()),
          legacyWaived: createMoneyDto('UZS', schedule.interestWaivedAmount.toString()),
        }
      }),
    }
    const response = ok(data, 'Nasiya amaliyot ma’lumotlari')
    // The browser owns this short-lived React Query cache. Do not permit a
    // CDN, proxy, or another user/session to retain this tenant-scoped DTO.
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return response
  } catch (error) {
    logger.error('[GET /api/nasiya/[id]/operation-context]', { event: 'api.route_error', error })
    return serverError()
  }
}
