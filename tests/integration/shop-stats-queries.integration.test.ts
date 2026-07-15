import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import {
  getCurrentOverdueSummary,
  getNasiyaWriteOffAggregate,
  getShopAccrualAggregate,
  getShopObligationAggregate,
  getUpcomingScheduleIds,
} from '@/lib/server/shop-stats-queries'
import { computeShopStatsFromRows } from '@/lib/shop-stats-formulas'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "ReturnRefundAllocation", "DeviceReturn",
      "NasiyaResolutionEvent", "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "DeviceImei", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function seedMixedCurrencyObligations() {
  const owner = await prisma.superAdmin.create({
    data: { name: 'Stats owner', login: 'stats-owner', passwordHash: 'integration-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: 'Stats shop',
      ownerName: 'Stats owner',
      ownerPhone: '+998901112233',
      shopNumber: 'STATS-1',
      address: 'Disposable database',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  const customer = await prisma.customer.create({
    data: { shopId: shop.id, name: 'Stats customer', phone: '+998909998877', normalizedPhone: '998909998877' },
  })

  async function device(suffix: string, purchasePrice: number, status: 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA') {
    return prisma.device.create({
      data: {
        shopId: shop.id,
        model: `Stats device ${suffix}`,
        imei: `STATS-${suffix}`,
        purchasePrice,
        purchaseInputAmount: purchasePrice,
        purchaseAmountUzsSnapshot: purchasePrice,
        status,
        addedBy: owner.id,
      },
    })
  }

  const cashDevice = await device('cash', 600, 'SOLD_CASH')
  await prisma.sale.create({
    data: {
      shopId: shop.id,
      deviceId: cashDevice.id,
      customerId: customer.id,
      salePrice: 1_000,
      amountPaid: 1_000,
      remainingAmount: 0,
      contractSalePrice: 1_000,
      contractAmountPaid: 1_000,
      contractRemainingAmount: 0,
      paymentMethod: 'CASH',
      paidFully: true,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      createdBy: owner.id,
    },
  })

  const debtDevice = await device('usd-sale', 2_000_000, 'SOLD_DEBT')
  const debtSale = await prisma.sale.create({
    data: {
      shopId: shop.id,
      deviceId: debtDevice.id,
      customerId: customer.id,
      salePrice: 6_250_000,
      amountPaid: 1_250_000,
      remainingAmount: 5_000_000,
      contractCurrency: 'USD',
      contractExchangeRateAtCreation: 12_500,
      contractSalePrice: 500,
      contractAmountPaid: 100,
      contractRemainingAmount: 400,
      paymentMethod: 'CASH',
      paidFully: false,
      dueDate: new Date('2026-07-10T00:00:00.000Z'),
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
      createdBy: owner.id,
    },
  })

  const uzsDevice = await device('uzs-nasiya', 300, 'SOLD_NASIYA')
  const uzsNasiya = await prisma.nasiya.create({
    data: {
      shopId: shop.id,
      deviceId: uzsDevice.id,
      customerId: customer.id,
      totalAmount: 900,
      downPayment: 0,
      baseRemainingAmount: 900,
      interestAmount: 0,
      finalNasiyaAmount: 900,
      remainingAmount: 900,
      months: 2,
      monthlyPayment: 450,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      status: 'OVERDUE',
      contractTotalAmount: 900,
      contractDownPayment: 0,
      contractBaseRemainingAmount: 900,
      contractInterestAmount: 0,
      contractFinalAmount: 900,
      contractMonthlyPayment: 450,
      contractRemainingAmount: 900,
      createdAt: new Date('2026-07-04T00:00:00.000Z'),
      createdBy: owner.id,
    },
  })
  const uzsSchedules = await Promise.all([
    prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: uzsNasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-08T00:00:00.000Z'),
        expectedAmount: 450,
        contractExpectedAmount: 450,
        contractRemainingAmount: 450,
        status: 'OVERDUE',
      },
    }),
    prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: uzsNasiya.id,
        shopId: shop.id,
        monthNumber: 2,
        dueDate: new Date('2026-07-09T00:00:00.000Z'),
        expectedAmount: 450,
        contractExpectedAmount: 450,
        contractRemainingAmount: 450,
        status: 'OVERDUE',
      },
    }),
  ])

  const usdDevice = await device('usd-nasiya', 400_000, 'SOLD_NASIYA')
  const usdNasiya = await prisma.nasiya.create({
    data: {
      shopId: shop.id,
      deviceId: usdDevice.id,
      customerId: customer.id,
      totalAmount: 1_250_000,
      downPayment: 0,
      baseRemainingAmount: 1_250_000,
      interestAmount: 0,
      finalNasiyaAmount: 1_250_000,
      remainingAmount: 1_250_000,
      months: 1,
      monthlyPayment: 1_250_000,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      status: 'OVERDUE',
      contractCurrency: 'USD',
      contractExchangeRateAtCreation: 12_500,
      contractTotalAmount: 100,
      contractDownPayment: 0,
      contractBaseRemainingAmount: 100,
      contractInterestAmount: 0,
      contractFinalAmount: 100,
      contractMonthlyPayment: 100,
      contractRemainingAmount: 100,
      createdAt: new Date('2026-07-05T00:00:00.000Z'),
      createdBy: owner.id,
    },
  })
  const usdSchedule = await prisma.nasiyaSchedule.create({
    data: {
      nasiyaId: usdNasiya.id,
      shopId: shop.id,
      monthNumber: 1,
      dueDate: new Date('2026-07-12T00:00:00.000Z'),
      expectedAmount: 1_250_000,
      contractCurrency: 'USD',
      contractExpectedAmount: 100,
      contractRemainingAmount: 100,
      status: 'OVERDUE',
    },
  })

  return { owner, shop, customer, debtSale, uzsNasiya, usdNasiya, uzsSchedules, usdSchedule }
}

describe('set-based shop statistics', () => {
  it('preserves accrual totals and native debt partitions without loading every obligation row', async () => {
    const { shop } = await seedMixedCurrencyObligations()
    const monthStart = new Date('2026-06-30T19:00:00.000Z')
    const monthEnd = new Date('2026-07-31T19:00:00.000Z')
    const todayStart = new Date('2026-07-12T19:00:00.000Z')

    await expect(getShopAccrualAggregate({ shopId: shop.id, monthStart, monthEnd, adminId: null }))
      .resolves.toEqual({
        saleCount: 2,
        saleRevenueUzs: 6_251_000,
        saleDeviceCostUzs: 2_000_600,
        nasiyaRevenueUzs: 1_250_900,
        nasiyaInterestUzs: 0,
        nasiyaDeviceCostUzs: 400_300,
      })

    await expect(getShopObligationAggregate({ shopId: shop.id, monthStart, monthEnd, todayStart }))
      .resolves.toEqual({
        expectedUzs: 900,
        expectedUsd: 500,
        overdueUzs: 900,
        overdueUsd: 500,
        overdueCount: 4,
        falseCompletedCount: 0,
      })
  })

  it('counts overdue Nasiya by deal for the banner while retaining schedule-level dashboard count', async () => {
    const { shop, uzsSchedules, usdSchedule } = await seedMixedCurrencyObligations()
    const todayStart = new Date('2026-07-12T19:00:00.000Z')

    await expect(getCurrentOverdueSummary({ shopId: shop.id, todayStart })).resolves.toEqual({
      overdueNativeUzs: 900,
      overdueNativeUsd: 500,
      overdueDealCount: 3,
      singleDeal: null,
    })
    await expect(getUpcomingScheduleIds(shop.id, 5)).resolves.toEqual([
      uzsSchedules[0].id,
      uzsSchedules[1].id,
      usdSchedule.id,
    ])
  })

  it('excludes archived and written-off balances from financial totals and work queues, while reporting write-off events separately', async () => {
    const { owner, shop, customer } = await seedMixedCurrencyObligations()
    const specialScheduleIds: string[] = []
    const contracts: Array<{ id: string; state: 'ARCHIVED' | 'WRITTEN_OFF' }> = []
    for (const state of ['ARCHIVED', 'WRITTEN_OFF'] as const) {
      const device = await prisma.device.create({
        data: {
          shopId: shop.id,
          model: `${state} phone`,
          imei: `STATS-${state}`,
          purchasePrice: 500,
          status: 'SOLD_NASIYA',
          addedBy: owner.id,
        },
      })
      const nasiya = await prisma.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          totalAmount: 1_000,
          downPayment: 0,
          baseRemainingAmount: 1_000,
          finalNasiyaAmount: 1_000,
          remainingAmount: 1_000,
          months: 1,
          monthlyPayment: 1_000,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          status: 'OVERDUE',
          resolutionState: state,
          resolutionUpdatedAt: new Date('2026-07-10T00:00:00.000Z'),
          contractTotalAmount: 1_000,
          contractBaseRemainingAmount: 1_000,
          contractFinalAmount: 1_000,
          contractMonthlyPayment: 1_000,
          contractRemainingAmount: 1_000,
          createdBy: owner.id,
        },
      })
      const schedule = await prisma.nasiyaSchedule.create({
        data: {
          shopId: shop.id,
          nasiyaId: nasiya.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          expectedAmount: 1_000,
          contractExpectedAmount: 1_000,
          contractRemainingAmount: 1_000,
          status: 'OVERDUE',
        },
      })
      specialScheduleIds.push(schedule.id)
      contracts.push({ id: nasiya.id, state })
    }
    const writtenOff = contracts.find((contract) => contract.state === 'WRITTEN_OFF')!
    await prisma.nasiyaResolutionEvent.create({
      data: {
        shopId: shop.id,
        nasiyaId: writtenOff.id,
        eventType: 'WRITE_OFF',
        previousState: 'ACTIVE',
        newState: 'WRITTEN_OFF',
        contractCurrency: 'UZS',
        nativeRemainingAmount: 1_000,
        frozenUzsAmount: 1_000,
        frozenUsdUzsRate: 1,
        reason: 'Stats write-off evidence',
        actorId: owner.id,
        actorType: 'SUPER_ADMIN',
        idempotencyKey: 'stats-writeoff-evidence',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    })

    const monthStart = new Date('2026-06-30T19:00:00.000Z')
    const monthEnd = new Date('2026-07-31T19:00:00.000Z')
    const todayStart = new Date('2026-07-12T19:00:00.000Z')
    await expect(getShopObligationAggregate({ shopId: shop.id, monthStart, monthEnd, todayStart }))
      .resolves.toMatchObject({ expectedUzs: 900, overdueUzs: 900, overdueCount: 4 })
    const queue = await getUpcomingScheduleIds(shop.id, 20)
    expect(queue).not.toEqual(expect.arrayContaining(specialScheduleIds))
    await expect(getCurrentOverdueSummary({ shopId: shop.id, todayStart }))
      .resolves.toMatchObject({ overdueNativeUzs: 900, overdueDealCount: 3 })
    await expect(getNasiyaWriteOffAggregate({ shopId: shop.id, monthStart, monthEnd }))
      .resolves.toEqual({ nativeUzs: 1_000, nativeUsd: 0, frozenUzs: 1_000, writeOffCount: 1, reopenCount: 0 })
  })

  it('excludes cancelled and returned Nasiya obligations from totals, overdue banners, and previews', async () => {
    const { owner, shop, customer } = await seedMixedCurrencyObligations()
    const excludedScheduleIds: string[] = []

    for (const [suffix, state] of [
      ['cancelled', { status: 'CANCELLED' as const, returnedAt: null }],
      ['returned', { status: 'ACTIVE' as const, returnedAt: new Date('2026-07-11T00:00:00.000Z') }],
    ] as const) {
      const device = await prisma.device.create({
        data: {
          shopId: shop.id,
          model: `Excluded ${suffix}`,
          imei: `EXCLUDED-${suffix}`,
          purchasePrice: 400,
          purchaseInputAmount: 400,
          purchaseAmountUzsSnapshot: 400,
          status: 'SOLD_NASIYA',
          addedBy: owner.id,
        },
      })
      const nasiya = await prisma.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          totalAmount: 1_000,
          downPayment: 0,
          baseRemainingAmount: 1_000,
          finalNasiyaAmount: 1_000,
          remainingAmount: 1_000,
          months: 1,
          monthlyPayment: 1_000,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          status: state.status,
          contractTotalAmount: 1_000,
          contractBaseRemainingAmount: 1_000,
          contractFinalAmount: 1_000,
          contractMonthlyPayment: 1_000,
          contractRemainingAmount: 1_000,
          returnedAt: state.returnedAt,
          returnedBy: state.returnedAt ? owner.id : null,
          createdBy: owner.id,
        },
      })
      const schedule = await prisma.nasiyaSchedule.create({
        data: {
          nasiyaId: nasiya.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          expectedAmount: 1_000,
          contractExpectedAmount: 1_000,
          contractRemainingAmount: 1_000,
          status: 'OVERDUE',
        },
      })
      excludedScheduleIds.push(schedule.id)
    }

    const monthStart = new Date('2026-06-30T19:00:00.000Z')
    const monthEnd = new Date('2026-07-31T19:00:00.000Z')
    const todayStart = new Date('2026-07-12T19:00:00.000Z')
    const obligation = await getShopObligationAggregate({ shopId: shop.id, monthStart, monthEnd, todayStart })
    const overdue = await getCurrentOverdueSummary({ shopId: shop.id, todayStart })
    const upcoming = await getUpcomingScheduleIds(shop.id, 20)

    expect(obligation).toMatchObject({ expectedUzs: 900, expectedUsd: 500, overdueUzs: 900, overdueUsd: 500, overdueCount: 4 })
    expect(overdue).toMatchObject({ overdueNativeUzs: 900, overdueNativeUsd: 500, overdueDealCount: 3 })
    expect(upcoming).not.toEqual(expect.arrayContaining(excludedScheduleIds))
  })

  it('matches the pure policy at USD-cent, delayed, cancelled-schedule, and native-vs-legacy boundaries', async () => {
    const owner = await prisma.superAdmin.create({
      data: { name: 'Boundary owner', login: 'stats-boundary-owner', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Boundary shop',
        ownerName: 'Boundary owner',
        ownerPhone: '+998903030301',
        shopNumber: 'STATS-BOUNDARY',
        address: 'Disposable database',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: owner.id,
      },
    })
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: 'Boundary customer',
        phone: '+998903030302',
        normalizedPhone: '998903030302',
      },
    })
    const createDevice = (suffix: string, status: 'SOLD_DEBT' | 'SOLD_NASIYA') =>
      prisma.device.create({
        data: {
          shopId: shop.id,
          model: `Boundary ${suffix}`,
          imei: `STATS-BOUNDARY-${suffix}`,
          purchasePrice: 1,
          purchaseInputAmount: 1,
          purchaseAmountUzsSnapshot: 1,
          status,
          addedBy: owner.id,
        },
      })

    const saleDevice = await createDevice('USD-SALE', 'SOLD_DEBT')
    await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: saleDevice.id,
        customerId: customer.id,
        salePrice: 250,
        amountPaid: 250,
        remainingAmount: 0,
        contractCurrency: 'USD',
        contractExchangeRateAtCreation: 12_500,
        contractSalePrice: 0.02,
        contractAmountPaid: 0.01,
        contractRemainingAmount: 0.01,
        paymentMethod: 'CASH',
        paidFully: false,
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    async function createNasiya(input: {
      suffix: string
      currency: 'UZS' | 'USD'
      amount: number
      exchangeRate?: number
    }) {
      const device = await createDevice(input.suffix, 'SOLD_NASIYA')
      return prisma.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          totalAmount: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          downPayment: 0,
          baseRemainingAmount: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          finalNasiyaAmount: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          remainingAmount: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          months: 1,
          monthlyPayment: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          contractCurrency: input.currency,
          contractExchangeRateAtCreation: input.exchangeRate,
          contractTotalAmount: input.amount,
          contractBaseRemainingAmount: input.amount,
          contractFinalAmount: input.amount,
          contractMonthlyPayment: input.amount,
          contractRemainingAmount: input.amount,
          createdBy: owner.id,
        },
      })
    }

    const usdNasiya = await createNasiya({
      suffix: 'USD-CENT',
      currency: 'USD',
      amount: 0.01,
      exchangeRate: 12_500,
    })
    const usdSchedule = await prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: usdNasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        expectedAmount: 125,
        contractCurrency: 'USD',
        contractExpectedAmount: 0.01,
        contractRemainingAmount: 0.01,
        status: 'OVERDUE',
      },
    })
    const delayedNasiya = await createNasiya({ suffix: 'UZS-DELAYED', currency: 'UZS', amount: 1 })
    const delayedSchedule = await prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: delayedNasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        delayedUntil: new Date('2026-07-20T00:00:00.000Z'),
        expectedAmount: 1,
        contractExpectedAmount: 1,
        contractRemainingAmount: 1,
        status: 'DEFERRED',
      },
    })
    const cancelledScheduleNasiya = await createNasiya({
      suffix: 'CANCELLED-SCHEDULE',
      currency: 'UZS',
      amount: 100,
    })
    await prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: cancelledScheduleNasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        expectedAmount: 100,
        contractExpectedAmount: 100,
        contractRemainingAmount: 100,
        status: 'CANCELLED',
      },
    })
    await createNasiya({ suffix: 'NO-SCHEDULE', currency: 'UZS', amount: 100 })

    const now = new Date('2026-07-13T12:00:00.000Z')
    const todayStart = new Date('2026-07-12T19:00:00.000Z')
    const monthStart = new Date('2026-06-30T19:00:00.000Z')
    const monthEnd = new Date('2026-07-31T19:00:00.000Z')
    const aggregate = await getShopObligationAggregate({ shopId: shop.id, monthStart, monthEnd, todayStart })
    expect(aggregate).toEqual({
      expectedUzs: 1,
      expectedUsd: 0.02,
      overdueUzs: 0,
      overdueUsd: 0.02,
      overdueCount: 2,
      falseCompletedCount: 0,
    })

    const pure = computeShopStatsFromRows({
      now,
      monthStart,
      monthEnd,
      usdUzsRate: 12_500,
      totalDevices: 0,
      cashSalesThisMonth: [],
      saleReceivedSum: 0,
      nasiyaSoldThisMonth: [],
      nasiyaReceivedSum: 0,
      activeNasiyalar: 0,
      nasiyaSchedulesForStats: [
        {
          dueDate: usdSchedule.dueDate,
          delayedUntil: usdSchedule.delayedUntil,
          expectedAmount: usdSchedule.expectedAmount,
          paidAmount: usdSchedule.paidAmount,
          contractExpectedAmount: usdSchedule.contractExpectedAmount,
          contractPaidAmount: usdSchedule.contractPaidAmount,
          nasiya: { contractCurrency: 'USD' },
        },
        {
          dueDate: delayedSchedule.dueDate,
          delayedUntil: delayedSchedule.delayedUntil,
          expectedAmount: delayedSchedule.expectedAmount,
          paidAmount: delayedSchedule.paidAmount,
          contractExpectedAmount: delayedSchedule.contractExpectedAmount,
          contractPaidAmount: delayedSchedule.contractPaidAmount,
          nasiya: { contractCurrency: 'UZS' },
        },
      ],
      unpaidSales: [{
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        remainingAmount: 0,
        contractCurrency: 'USD',
        contractRemainingAmount: 0.01,
      }],
      inventoryPurchaseCostSum: 0,
      returnRefundSum: 0,
      returnsThisMonth: 0,
      recentActivity: [],
      upcomingPayments: [],
    })
    expect(pure).toMatchObject({
      expectedThisMonthUzs: aggregate.expectedUzs,
      expectedThisMonthUsd: aggregate.expectedUsd,
      overdueMoneyUzs: aggregate.overdueUzs,
      overdueMoneyUsd: aggregate.overdueUsd,
      overdueCount: aggregate.overdueCount,
    })
  })
})
