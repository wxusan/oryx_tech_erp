import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { badRequest, conflict, created, ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  isOperationalUsdUzsRate,
  MIN_USD_UZS_RATE,
  MAX_USD_UZS_RATE,
} from '@/lib/server/currency'

const manualRateSchema = z.object({
  rate: z.number().finite().min(MIN_USD_UZS_RATE, `USD kursi kamida ${MIN_USD_UZS_RATE} bo'lishi kerak`).max(
    MAX_USD_UZS_RATE,
    `USD kursi ${MAX_USD_UZS_RATE} dan oshmasligi kerak`,
  ).refine(
    isOperationalUsdUzsRate,
    "USD kursi ko'pi bilan 4 kasr xonali bo'lishi kerak",
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
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }
    const providerReference = `MANUAL:${createHash('sha256')
      .update(`${session.user.id}:${idempotencyKey}`)
      .digest('hex')}`
    const replay = await prisma.currencyRate.findFirst({
      where: { source: 'MANUAL', providerReference },
    })
    if (replay) {
      if (replay.recordedById !== session.user.id || Number(replay.rate) !== parsed.data.rate) {
        return conflict("Idempotency-Key boshqa yoki o'zgartirilgan kurs uchun ishlatilgan")
      }
      return ok(replay, 'Qo‘lda kiritilgan USD kursi allaqachon saqlangan.')
    }

    let rate
    try {
      rate = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const createdRate = await tx.currencyRate.create({
          data: {
            baseCurrency: 'USD',
            quoteCurrency: 'UZS',
            rate: parsed.data.rate,
            source: 'MANUAL',
            fetchedAt: new Date(),
            effectiveDate: new Date(),
            providerReference,
            recordedById: session.user.id,
            recordedByType: 'SUPER_ADMIN',
            evidenceVersion: 2,
            evidenceStatus: 'CAPTURED',
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
              providerReference,
            },
            note: parsed.data.note || 'Qo‘lda kiritilgan USD/UZS zaxira kursi yangilandi',
          },
        })

        return createdRate
      })
    } catch (transactionError) {
      if (transactionError instanceof Prisma.PrismaClientKnownRequestError && transactionError.code === 'P2002') {
        const committed = await prisma.currencyRate.findFirst({
          where: { source: 'MANUAL', providerReference },
        })
        if (committed && committed.recordedById === session.user.id && Number(committed.rate) === parsed.data.rate) {
          return ok(committed, 'Qo‘lda kiritilgan USD kursi allaqachon saqlangan.')
        }
      }
      throw transactionError
    }

    return created(rate, 'Qo‘lda kiritilgan USD kursi saqlandi.')
  } catch (err) {
    logger.error('[POST /api/admin/currency-rate]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
