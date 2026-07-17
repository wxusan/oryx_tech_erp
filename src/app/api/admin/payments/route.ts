/**
 * GET /api/admin/payments?skip=0&take=25
 *
 * Paginated ShopPayment history and database-wide period summaries for the
 * super admin. Summaries deliberately aggregate over the full table, never
 * over the current page or a capped list of parent shops.
 */

import type { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { badRequest, ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { tashkentMonthRange, tashkentMonthRangeFromKey } from '@/lib/timezone'
import { adminReportingContext, summarizeShopPaymentGroups } from '@/lib/admin-money'
import { getSuperAdminCurrencyContext } from '@/lib/server/currency'
import { accountingReconstructionLabel, currencyLabel, paymentMethodLabel } from '@/lib/presentation-labels'

const DEFAULT_TAKE = 25
const MAX_TAKE = 100
const MAX_EXPORT_ROWS = 10_000
const PLATFORM_REVENUE_REPORT_WINDOW_ID = 'platform'

function csvCell(value: unknown) {
  const raw = value == null ? '' : String(value)
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum?: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const integer = Math.trunc(parsed)
  return Math.min(Math.max(integer, minimum), maximum ?? Number.MAX_SAFE_INTEGER)
}

function previousMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`
}

function startsAtOrAfter(periodStart: Date, revenueStart: Date | null) {
  return revenueStart && revenueStart > periodStart ? revenueStart : periodStart
}

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    if (req.nextUrl.searchParams.get('format') === 'csv') {
      const where: Prisma.ShopPaymentWhereInput = { deletedAt: null }
      const total = await prisma.shopPayment.count({ where })
      if (total > MAX_EXPORT_ROWS) return badRequest(`Eksport ${MAX_EXPORT_ROWS} ta yozuv bilan cheklangan`)
      const rows = await prisma.shopPayment.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          amount: true,
          currency: true,
          exchangeRateAtPayment: true,
          amountUzsSnapshot: true,
          amountUsdSnapshot: true,
          currencyReconstructionStatus: true,
          months: true,
          paymentMethod: true,
          paidAt: true,
          shop: { select: { name: true } },
          recordedBy: { select: { name: true, login: true } },
        },
      })
      const headers = [
        'id', 'shop', 'originalAmount', 'originalCurrency', 'exchangeRateAtPayment',
        'historicalDisplayUzs', 'historicalDisplayUsd', 'reconstructionStatus',
        'months', 'paymentMethod', 'paidAt', 'recordedBy', 'recordedByLogin',
      ]
      const lines = [headers, ...rows.map((row) => [
        row.id,
        row.shop.name,
        row.amount.toString(),
        currencyLabel(row.currency),
        row.exchangeRateAtPayment?.toString() ?? '',
        row.amountUzsSnapshot?.toString() ?? '',
        row.amountUsdSnapshot?.toString() ?? '',
        accountingReconstructionLabel(row.currencyReconstructionStatus),
        row.months,
        paymentMethodLabel(row.paymentMethod),
        row.paidAt.toISOString(),
        row.recordedBy.name,
        row.recordedBy.login,
      ])].map((row) => row.map(csvCell).join(',')).join('\r\n')
      return new Response(`\uFEFF${lines}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="admin-shop-payments.csv"',
          'Cache-Control': 'private, no-store',
        },
      })
    }

    const skip = boundedInteger(req.nextUrl.searchParams.get('skip'), 0, 0)
    const take = boundedInteger(req.nextUrl.searchParams.get('take'), DEFAULT_TAKE, 1, MAX_TAKE)
    const now = new Date()
    const currentMonth = tashkentMonthRange(now)
    const previousMonth = tashkentMonthRangeFromKey(previousMonthKey(currentMonth.monthKey), now)
    const currentYear = Number(currentMonth.monthKey.slice(0, 4))
    const currentYearStart = tashkentMonthRangeFromKey(`${currentYear}-01`, now).start
    const nextYearStart = tashkentMonthRangeFromKey(`${currentYear + 1}-01`, now).start
    const revenueWindow = await prisma.platformRevenueReportWindow.findUnique({
      where: { id: PLATFORM_REVENUE_REPORT_WINDOW_ID },
      select: { subscriptionRevenueStartsAt: true },
    })
    const subscriptionRevenueStartsAt = revenueWindow?.subscriptionRevenueStartsAt ?? null
    const baseWhere: Prisma.ShopPaymentWhereInput = { deletedAt: null }

    const groupSum = (where: Prisma.ShopPaymentWhereInput) => prisma.shopPayment.groupBy({
      by: ['currency'],
      where,
      _sum: { amount: true, amountUzsSnapshot: true, amountUsdSnapshot: true },
      _count: { id: true, amountUzsSnapshot: true, amountUsdSnapshot: true },
    })

    const [rows, total, currentMonthResult, previousMonthResult, currentYearResult, currency] = await Promise.all([
      prisma.shopPayment.findMany({
        where: baseWhere,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          shopId: true,
          amount: true,
          currency: true,
          exchangeRateAtPayment: true,
          amountUzsSnapshot: true,
          amountUsdSnapshot: true,
          currencyReconstructionStatus: true,
          months: true,
          paymentMethod: true,
          paidAt: true,
          recordedBy: { select: { id: true, name: true, login: true } },
          shop: { select: { name: true, subscriptionDue: true } },
        },
      }),
      prisma.shopPayment.count({ where: baseWhere }),
      groupSum({ ...baseWhere, paidAt: { gte: startsAtOrAfter(currentMonth.start, subscriptionRevenueStartsAt), lt: currentMonth.end } }),
      groupSum({ ...baseWhere, paidAt: { gte: startsAtOrAfter(previousMonth.start, subscriptionRevenueStartsAt), lt: previousMonth.end } }),
      groupSum({ ...baseWhere, paidAt: { gte: startsAtOrAfter(currentYearStart, subscriptionRevenueStartsAt), lt: nextYearStart } }),
      getSuperAdminCurrencyContext(guarded.session.user.id),
    ])

    return ok({
      reporting: adminReportingContext(currency),
      items: rows.map((row) => ({
        id: row.id,
        shopId: row.shopId,
        shop: row.shop.name,
        amount: Number(row.amount),
        currency: row.currency,
        exchangeRateAtPayment: row.exchangeRateAtPayment === null ? null : Number(row.exchangeRateAtPayment),
        amountUzsSnapshot: row.amountUzsSnapshot === null ? null : Number(row.amountUzsSnapshot),
        amountUsdSnapshot: row.amountUsdSnapshot === null ? null : Number(row.amountUsdSnapshot),
        currencyReconstructionStatus: row.currencyReconstructionStatus,
        months: row.months,
        paymentMethod: row.paymentMethod,
        paidAt: row.paidAt,
        nextPaymentDate: row.shop.subscriptionDue,
        recordedBy: row.recordedBy,
      })),
      total,
      skip,
      take,
      summary: {
        currentMonth: summarizeShopPaymentGroups(currentMonthResult),
        previousMonth: summarizeShopPaymentGroups(previousMonthResult),
        currentYear: summarizeShopPaymentGroups(currentYearResult),
        currentYearNumber: currentYear,
      },
    }, "Do'kon to'lovlari")
  } catch (err) {
    logger.error('[GET /api/admin/payments]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
