import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import {
  computeCustomerTrustRating,
  computeCustomerTrustRatingFromFactors,
  type CustomerNasiyaInput,
} from '@/lib/nasiya-customer-trust'
import { getCustomerTrustFactorsForList } from '@/lib/server/customer-trust-queries'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification",
      "ReturnRefundAllocation", "DeviceReturn", "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule",
      "Nasiya", "SupplierPayable", "SalePayment", "Sale", "Customer", "Device", "Supplier",
      "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('bounded customer trust aggregate', () => {
  it('matches the established pure policy without hydrating mature-customer history', async () => {
    const now = new Date('2026-07-13T12:00:00.000Z')
    const owner = await prisma.superAdmin.create({
      data: { name: 'Trust owner', login: 'trust-query-owner', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Trust query shop',
        ownerName: 'Trust owner',
        ownerPhone: '+998901010101',
        shopNumber: 'trust-query',
        address: 'Disposable integration database',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: owner.id,
      },
    })
    const [matureCustomer, newCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shop.id,
          name: 'Mature customer',
          phone: '+998901010102',
          normalizedPhone: '998901010102',
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shop.id,
          name: 'New customer',
          phone: '+998901010103',
          normalizedPhone: '998901010103',
        },
      }),
    ])

    async function createContract(input: {
      suffix: string
      status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
      final: number
      paid: number
      remaining: number
    }) {
      const device = await prisma.device.create({
        data: {
          shopId: shop.id,
          model: `Trust phone ${input.suffix}`,
          purchasePrice: 50,
          purchaseInputAmount: 50,
          purchaseAmountUzsSnapshot: 50,
          imei: `TRUST-QUERY-${input.suffix}`,
          status: 'SOLD_NASIYA',
          addedBy: owner.id,
        },
      })
      return prisma.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: matureCustomer.id,
          totalAmount: input.final,
          downPayment: 0,
          baseRemainingAmount: input.final,
          interestAmount: 0,
          finalNasiyaAmount: input.final,
          remainingAmount: input.remaining,
          months: 1,
          monthlyPayment: input.final,
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          status: input.status,
          contractCurrency: 'UZS',
          contractTotalAmount: input.final,
          contractBaseRemainingAmount: input.final,
          contractFinalAmount: input.final,
          contractMonthlyPayment: input.final,
          contractPaidAmount: input.paid,
          contractRemainingAmount: input.remaining,
          createdBy: owner.id,
        },
      })
    }

    const completed = await createContract({
      suffix: 'COMPLETED',
      status: 'COMPLETED',
      final: 300,
      paid: 300,
      remaining: 0,
    })
    const active = await createContract({
      suffix: 'ACTIVE',
      status: 'ACTIVE',
      final: 200,
      paid: 0,
      remaining: 200,
    })
    const cancelled = await createContract({
      suffix: 'CANCELLED',
      status: 'CANCELLED',
      final: 100,
      paid: 0,
      remaining: 100,
    })

    const completedSchedules = [
      {
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        paidAt: new Date('2026-06-30T00:00:00.000Z'),
      },
      {
        dueDate: new Date('2026-07-02T00:00:00.000Z'),
        paidAt: new Date('2026-07-03T00:00:00.000Z'),
      },
      {
        dueDate: new Date('2026-07-03T00:00:00.000Z'),
        paidAt: new Date('2026-07-06T00:00:00.000Z'),
      },
    ]
    for (const [index, schedule] of completedSchedules.entries()) {
      await prisma.nasiyaSchedule.create({
        data: {
          nasiyaId: completed.id,
          shopId: shop.id,
          monthNumber: index + 1,
          dueDate: schedule.dueDate,
          expectedAmount: 100,
          paidAmount: 100,
          paidAt: schedule.paidAt,
          status: 'PAID',
          contractCurrency: 'UZS',
          contractExpectedAmount: 100,
          contractPaidAmount: 100,
          contractRemainingAmount: 0,
        },
      })
    }
    await prisma.nasiyaSchedule.createMany({
      data: [
        {
          nasiyaId: active.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-10T00:00:00.000Z'),
          expectedAmount: 100,
          status: 'PENDING',
          contractCurrency: 'UZS',
          contractExpectedAmount: 100,
          contractRemainingAmount: 100,
        },
        {
          nasiyaId: active.id,
          shopId: shop.id,
          monthNumber: 2,
          dueDate: new Date('2026-07-11T00:00:00.000Z'),
          delayedUntil: new Date('2026-07-20T00:00:00.000Z'),
          expectedAmount: 100,
          status: 'DEFERRED',
          contractCurrency: 'UZS',
          contractExpectedAmount: 100,
          contractRemainingAmount: 100,
        },
        {
          nasiyaId: cancelled.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          expectedAmount: 100,
          paidAmount: 100,
          paidAt: new Date('2026-07-10T00:00:00.000Z'),
          status: 'PAID',
          contractCurrency: 'UZS',
          contractExpectedAmount: 100,
          contractPaidAmount: 100,
          contractRemainingAmount: 0,
        },
      ],
    })

    const nested: CustomerNasiyaInput[] = [
      {
        status: 'COMPLETED',
        contractCurrency: 'UZS',
        schedules: completedSchedules.map((schedule) => ({
          status: 'PAID',
          dueDate: schedule.dueDate,
          delayedUntil: null,
          expectedAmount: 100,
          paidAmount: 100,
          paidAt: schedule.paidAt,
        })),
      },
      {
        status: 'ACTIVE',
        contractCurrency: 'UZS',
        schedules: [
          {
            status: 'PENDING',
            dueDate: new Date('2026-07-10T00:00:00.000Z'),
            delayedUntil: null,
            expectedAmount: 100,
            paidAmount: 0,
            paidAt: null,
          },
          {
            status: 'DEFERRED',
            dueDate: new Date('2026-07-11T00:00:00.000Z'),
            delayedUntil: new Date('2026-07-20T00:00:00.000Z'),
            expectedAmount: 100,
            paidAmount: 0,
            paidAt: null,
          },
        ],
      },
      {
        status: 'CANCELLED',
        contractCurrency: 'UZS',
        schedules: [{
          status: 'PAID',
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          delayedUntil: null,
          expectedAmount: 100,
          paidAmount: 100,
          paidAt: new Date('2026-07-10T00:00:00.000Z'),
        }],
      },
    ]

    const factorsByCustomer = await getCustomerTrustFactorsForList({
      shopId: shop.id,
      customerIds: [matureCustomer.id, newCustomer.id],
      now,
    })
    const expected = computeCustomerTrustRating(nested, now)
    const actualFactors = factorsByCustomer.get(matureCustomer.id)
    expect(actualFactors).toEqual(expected.factors)
    expect(computeCustomerTrustRatingFromFactors(actualFactors!)).toEqual(expected)

    const newFactors = factorsByCustomer.get(newCustomer.id)
    expect(newFactors).toMatchObject({ totalNasiyaCount: 0, paidInstallmentCount: 0 })
    expect(computeCustomerTrustRatingFromFactors(newFactors!).tier).toBe('NEW')
  })
})
