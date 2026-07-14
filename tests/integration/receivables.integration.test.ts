import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { getReceivableCohortPage, getReceivableCohortSummaries } from '@/lib/server/shop-stats-queries'
import { getShopNasiyalarList } from '@/lib/server/shop-lists'

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

afterAll(async () => prisma.$disconnect())

describe('authoritative due-today and overdue receivable cohorts', () => {
  it('keeps midnight cohorts disjoint and uses the identical deals for summary and list', async () => {
    const actor = await prisma.superAdmin.create({ data: { name: 'Actor', login: 'receivable-actor', passwordHash: 'test' } })
    const shop = await prisma.shop.create({
      data: {
        name: 'Receivable shop',
        ownerName: actor.name,
        ownerPhone: '+998901111111',
        shopNumber: 'RECEIVABLES',
        address: 'Disposable',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: actor.id,
      },
    })
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({ data: { shopId: shop.id, name: 'Customer A', phone: '+998901000001', normalizedPhone: '998901000001' } }),
      prisma.customer.create({ data: { shopId: shop.id, name: 'Customer B', phone: '+998901000002', normalizedPhone: '998901000002' } }),
    ])
    let sequence = 0
    async function device(status: 'SOLD_DEBT' | 'SOLD_NASIYA') {
      sequence += 1
      return prisma.device.create({
        data: {
          shopId: shop.id,
          model: `Device ${sequence}`,
          imei: `RECEIVABLE-${sequence}`,
          purchasePrice: 1,
          purchaseInputAmount: 1,
          purchaseAmountUzsSnapshot: 1,
          status,
          addedBy: actor.id,
        },
      })
    }
    async function sale(input: { customerId: string; dueDate: Date; amount: number; currency?: 'UZS' | 'USD' }) {
      const item = await device('SOLD_DEBT')
      return prisma.sale.create({
        data: {
          shopId: shop.id,
          deviceId: item.id,
          customerId: input.customerId,
          salePrice: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          amountPaid: 0,
          remainingAmount: input.currency === 'USD' ? input.amount * 12_500 : input.amount,
          contractCurrency: input.currency ?? 'UZS',
          contractExchangeRateAtCreation: input.currency === 'USD' ? 12_500 : null,
          contractSalePrice: input.amount,
          contractAmountPaid: 0,
          contractRemainingAmount: input.amount,
          paymentMethod: 'CASH',
          paidFully: false,
          dueDate: input.dueDate,
          createdBy: actor.id,
        },
      })
    }

    // Tashkent 2026-07-13 is [2026-07-12 19:00Z, 2026-07-13 19:00Z).
    const todayStart = new Date('2026-07-12T19:00:00.000Z')
    const tomorrowStart = new Date('2026-07-13T19:00:00.000Z')
    await sale({ customerId: customerA.id, dueDate: new Date('2026-07-12T18:59:59.999Z'), amount: 100 })
    await sale({ customerId: customerA.id, dueDate: todayStart, amount: 50, currency: 'USD' })
    await sale({ customerId: customerB.id, dueDate: new Date('2026-07-13T18:59:59.999Z'), amount: 400 })
    await sale({ customerId: customerB.id, dueDate: tomorrowStart, amount: 777 })

    const nasiyaDevice = await device('SOLD_NASIYA')
    const nasiya = await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: nasiyaDevice.id,
        customerId: customerA.id,
        totalAmount: 500,
        downPayment: 0,
        baseRemainingAmount: 500,
        interestAmount: 0,
        finalNasiyaAmount: 500,
        remainingAmount: 500,
        months: 2,
        monthlyPayment: 250,
        startDate: todayStart,
        contractTotalAmount: 500,
        contractBaseRemainingAmount: 500,
        contractFinalAmount: 500,
        contractMonthlyPayment: 250,
        contractRemainingAmount: 500,
        createdBy: actor.id,
      },
    })
    await prisma.nasiyaSchedule.createMany({
      data: [
        {
          shopId: shop.id,
          nasiyaId: nasiya.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-12T18:59:59.999Z'),
          expectedAmount: 200,
          contractExpectedAmount: 200,
          contractRemainingAmount: 200,
          status: 'OVERDUE',
        },
        {
          shopId: shop.id,
          nasiyaId: nasiya.id,
          monthNumber: 2,
          dueDate: todayStart,
          expectedAmount: 300,
          contractExpectedAmount: 300,
          contractRemainingAmount: 300,
          status: 'PENDING',
        },
      ],
    })

    const archivedDevice = await device('SOLD_NASIYA')
    const archived = await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: archivedDevice.id,
        customerId: customerB.id,
        totalAmount: 999,
        downPayment: 0,
        baseRemainingAmount: 999,
        interestAmount: 0,
        finalNasiyaAmount: 999,
        remainingAmount: 999,
        months: 1,
        monthlyPayment: 999,
        startDate: todayStart,
        resolutionState: 'ARCHIVED',
        contractTotalAmount: 999,
        contractBaseRemainingAmount: 999,
        contractFinalAmount: 999,
        contractMonthlyPayment: 999,
        contractRemainingAmount: 999,
        createdBy: actor.id,
      },
    })
    await prisma.nasiyaSchedule.create({
      data: {
        shopId: shop.id,
        nasiyaId: archived.id,
        monthNumber: 1,
        dueDate: todayStart,
        expectedAmount: 999,
        contractExpectedAmount: 999,
        contractRemainingAmount: 999,
      },
    })

    const input = {
      shopId: shop.id,
      todayStart,
      tomorrowStart,
      includeCashSales: true,
      includeNasiya: true,
    }
    const summaries = await getReceivableCohortSummaries(input)
    // Each open Nasiya schedule is classified at the Tashkent boundary before
    // the contract work item is formed. The $300 due today must never be
    // counted as part of the $200 overdue obligation.
    expect(summaries.OVERDUE).toMatchObject({ nativeUzs: 300, nativeUsd: 0, dealCount: 2, customerCount: 1 })
    expect(summaries.OVERDUE.sources.nasiya).toMatchObject({ nativeUzs: 200, dealCount: 1, customerCount: 1 })
    expect(summaries.DUE_TODAY).toMatchObject({ nativeUzs: 700, nativeUsd: 50, dealCount: 3, customerCount: 2 })
    expect(summaries.DUE_TODAY.sources.nasiya).toMatchObject({ nativeUzs: 300, nativeUsd: 0, dealCount: 1, customerCount: 1 })

    const overdue = await getReceivableCohortPage({ ...input, cohort: 'OVERDUE', skip: 0, take: 100 })
    const dueToday = await getReceivableCohortPage({ ...input, cohort: 'DUE_TODAY', skip: 0, take: 100 })
    expect(overdue.total).toBe(summaries.OVERDUE.dealCount)
    expect(dueToday.total).toBe(summaries.DUE_TODAY.dealCount)
    expect(overdue.items.reduce((sum, item) => sum + (item.currency === 'UZS' ? item.outstanding : 0), 0)).toBe(300)
    expect(dueToday.items.filter((item) => item.currency === 'UZS').reduce((sum, item) => sum + item.outstanding, 0)).toBe(700)
    expect(dueToday.items.filter((item) => item.currency === 'USD').reduce((sum, item) => sum + item.outstanding, 0)).toBe(50)
    expect([...overdue.items, ...dueToday.items]).not.toContainEqual(expect.objectContaining({ outstanding: 777 }))
    expect([...overdue.items, ...dueToday.items]).not.toContainEqual(expect.objectContaining({ outstanding: 999 }))
    const overdueNasiya = overdue.items.find((item) => item.dealType === 'nasiya' && item.dealId === nasiya.id)
    const dueTodayNasiya = dueToday.items.find((item) => item.dealType === 'nasiya' && item.dealId === nasiya.id)
    expect(overdueNasiya).toMatchObject({ outstanding: 200, effectiveDue: new Date('2026-07-12T18:59:59.999Z') })
    expect(dueTodayNasiya).toMatchObject({ outstanding: 300, effectiveDue: todayStart })

    // The Nasiya destination tabs use the same schedule boundaries. The
    // contract is one work item in each distinct tab because it has distinct
    // overdue and due-today schedule obligations; neither schedule is placed
    // in the wrong cohort.
    const nasiyaOverdue = await getShopNasiyalarList(shop.id, {
      cohort: 'OVERDUE',
      skip: 0,
      take: 100,
      now: new Date('2026-07-13T12:00:00.000Z'),
    })
    const nasiyaDueToday = await getShopNasiyalarList(shop.id, {
      cohort: 'DUE_TODAY',
      skip: 0,
      take: 100,
      now: new Date('2026-07-13T12:00:00.000Z'),
    })
    const overdueNasiyaListItem = nasiyaOverdue.items.find((item) => item.id === nasiya.id)
    const dueTodayNasiyaListItem = nasiyaDueToday.items.find((item) => item.id === nasiya.id)
    expect(overdueNasiyaListItem).toMatchObject({
      collectionWorkItem: {
        cohort: 'OVERDUE',
        outstanding: 200,
        effectiveDue: '2026-07-12T18:59:59.999Z',
        preferredScheduleId: expect.any(String),
      },
    })
    expect(dueTodayNasiyaListItem).toMatchObject({
      collectionWorkItem: {
        cohort: 'DUE_TODAY',
        outstanding: 300,
        effectiveDue: todayStart.toISOString(),
        preferredScheduleId: expect.any(String),
      },
    })
  })
})
