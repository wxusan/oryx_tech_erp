/**
 * GET /api/admin/payments?skip=0&take=25
 *
 * Paginated ShopPayment history and database-wide period summaries for the
 * super admin. Summaries deliberately aggregate over the full table, never
 * over the current page or a capped list of parent shops.
 */

import type { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { tashkentMonthRange, tashkentMonthRangeFromKey } from '@/lib/timezone'

const DEFAULT_TAKE = 25
const MAX_TAKE = 100

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

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const skip = boundedInteger(req.nextUrl.searchParams.get('skip'), 0, 0)
    const take = boundedInteger(req.nextUrl.searchParams.get('take'), DEFAULT_TAKE, 1, MAX_TAKE)
    const now = new Date()
    const currentMonth = tashkentMonthRange(now)
    const previousMonth = tashkentMonthRangeFromKey(previousMonthKey(currentMonth.monthKey), now)
    const currentYear = Number(currentMonth.monthKey.slice(0, 4))
    const currentYearStart = tashkentMonthRangeFromKey(`${currentYear}-01`, now).start
    const nextYearStart = tashkentMonthRangeFromKey(`${currentYear + 1}-01`, now).start
    const baseWhere: Prisma.ShopPaymentWhereInput = { deletedAt: null }

    const [rows, total, currentMonthResult, previousMonthResult, currentYearResult] = await Promise.all([
      prisma.shopPayment.findMany({
        where: baseWhere,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          shopId: true,
          amount: true,
          months: true,
          paymentMethod: true,
          paidAt: true,
          recordedBy: { select: { id: true, name: true, login: true } },
          shop: { select: { name: true, subscriptionDue: true } },
        },
      }),
      prisma.shopPayment.count({ where: baseWhere }),
      prisma.shopPayment.aggregate({
        where: { ...baseWhere, paidAt: { gte: currentMonth.start, lt: currentMonth.end } },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.shopPayment.aggregate({
        where: { ...baseWhere, paidAt: { gte: previousMonth.start, lt: previousMonth.end } },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.shopPayment.aggregate({
        where: { ...baseWhere, paidAt: { gte: currentYearStart, lt: nextYearStart } },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ])

    const summarize = (result: typeof currentMonthResult) => ({
      amount: Number(result._sum.amount ?? 0),
      count: result._count.id,
    })

    return ok({
      items: rows.map((row) => ({
        id: row.id,
        shopId: row.shopId,
        shop: row.shop.name,
        amount: Number(row.amount),
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
        currentMonth: summarize(currentMonthResult),
        previousMonth: summarize(previousMonthResult),
        currentYear: summarize(currentYearResult),
        currentYearNumber: currentYear,
      },
    }, "Do'kon to'lovlari")
  } catch (err) {
    logger.error('[GET /api/admin/payments]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
