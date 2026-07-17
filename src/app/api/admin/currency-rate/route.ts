import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { badRequest, created, ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { MIN_USD_UZS_RATE, MAX_USD_UZS_RATE } from '@/lib/server/currency'

const manualRateSchema = z.object({
  rate: z.number().finite().min(MIN_USD_UZS_RATE, `USD kursi kamida ${MIN_USD_UZS_RATE} bo'lishi kerak`).max(
    MAX_USD_UZS_RATE,
    `USD kursi ${MAX_USD_UZS_RATE} dan oshmasligi kerak`,
  ),
  note: z.string().trim().max(500, 'Izoh 500 belgidan oshmasligi kerak').optional(),
})

function latestRate(source?: 'CBU' | 'MANUAL') {
  return prisma.currencyRate.findFirst({
    where: { baseCurrency: 'USD', quoteCurrency: 'UZS', ...(source ? { source } : {}) },
    orderBy: { fetchedAt: 'desc' },
    select: {
      id: true,
      rate: true,
      source: true,
      fetchedAt: true,
      effectiveDate: true,
      createdAt: true,
    },
  })
}

export async function GET() {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const [latest, latestCbu, latestManual] = await Promise.all([
      latestRate(),
      latestRate('CBU'),
      latestRate('MANUAL'),
    ])

    return ok({ latest, latestCbu, latestManual })
  } catch (err) {
    logger.error('[GET /api/admin/currency-rate]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const body: unknown = await req.json()
    const parsed = manualRateSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const rate = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdRate = await tx.currencyRate.create({
        data: {
          baseCurrency: 'USD',
          quoteCurrency: 'UZS',
          rate: parsed.data.rate,
          source: 'MANUAL',
          fetchedAt: new Date(),
          effectiveDate: new Date(),
        },
      })

      await tx.log.create({
        data: {
          shopId: null,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'UPDATE',
          targetType: 'CurrencyRate',
          targetId: createdRate.id,
          newValue: {
            baseCurrency: 'USD',
            quoteCurrency: 'UZS',
            rate: parsed.data.rate,
            source: 'MANUAL',
          },
          note: parsed.data.note || 'Qo‘lda kiritilgan USD/UZS zaxira kursi yangilandi',
        },
      })

      return createdRate
    })

    return created(rate, 'Qo‘lda kiritilgan USD kursi saqlandi.')
  } catch (err) {
    logger.error('[POST /api/admin/currency-rate]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
