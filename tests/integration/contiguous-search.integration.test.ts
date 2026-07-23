import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { buildOlibSotdimWhere } from '@/app/api/olib-sotdim/route'
import {
  buildIncomingDebtSearchWhere,
  buildOutgoingDebtSearchWhere,
  queryIncomingPayLaterDebts,
  queryOutgoingDebts,
} from '@/lib/server/debts'
import {
  buildShopNasiyalarWhere,
  findShopNasiyaIdsByCohort,
  findShopNasiyaIdsByDerivedStatus,
} from '@/lib/server/shop-lists'

vi.mock('@/lib/api-auth', () => ({}))

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 3 }) })

async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification",
      "ReturnRefundAllocation", "DeviceReturn", "NasiyaResolutionEvent", "NasiyaDeferral",
      "NasiyaPayment", "NasiyaSchedule", "Nasiya", "SupplierPayablePayment", "SupplierPayable",
      "OlibSotdimOperation", "SalePayment", "Sale", "Customer", "DeviceImei", "Device", "Supplier",
      "ShopAdmin", "ShopPayment", "CurrencyRate", "ShopPackageFeature", "ShopPackageVersion",
      "ShopMemberPermission", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function createShop(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: {
      name: `Search owner ${suffix}`,
      login: `search-owner-${suffix}`,
      passwordHash: 'test-only',
    },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Search shop ${suffix}`,
      ownerName: owner.name,
      ownerPhone: `+99890${suffix.padStart(7, '0').slice(-7)}`,
      shopNumber: `search-${suffix}`,
      address: 'Disposable integration database',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  return { owner, shop }
}

async function createCustomer(
  shopId: string,
  suffix: string,
  input: {
    name?: string
    phone?: string
    normalizedPhone?: string
    additionalPhones?: string[]
  } = {},
) {
  return prisma.customer.create({
    data: {
      shopId,
      name: input.name ?? `Search customer ${suffix}`,
      phone: input.phone ?? `+998 90 700 ${suffix.padStart(4, '0').slice(-2)} 00`,
      normalizedPhone: input.normalizedPhone ?? `99890700${suffix.padStart(4, '0').slice(-4)}`,
      additionalPhones: input.additionalPhones ?? [],
    },
  })
}

async function createDevice(
  shopId: string,
  actorId: string,
  suffix: string,
  input: {
    model?: string
    imei?: string
    note?: string
    secondaryImei?: string
    status?: 'SOLD_NASIYA' | 'SOLD_CASH' | 'SOLD_DEBT'
  } = {},
) {
  return prisma.device.create({
    data: {
      shopId,
      model: input.model ?? `Search device ${suffix}`,
      purchasePrice: 1_000,
      purchaseInputAmount: 1_000,
      purchaseAmountUzsSnapshot: 1_000,
      imei: input.imei ?? `3510000000${suffix.padStart(5, '0').slice(-5)}`,
      status: input.status ?? 'SOLD_NASIYA',
      addedBy: actorId,
      note: input.note,
      ...(input.secondaryImei
        ? {
            imeis: {
              create: [{
                slot: 'SECONDARY',
                value: input.secondaryImei,
                normalizedValue: input.secondaryImei.replace(/[\s-]/g, ''),
              }],
            },
          }
        : {}),
    },
  })
}

async function createOverdueNasiya(input: {
  shopId: string
  actorId: string
  suffix: string
  customerId: string
  deviceId: string
  note?: string
  deletedAt?: Date
}) {
  return prisma.$transaction(async (tx) => {
    const nasiya = await tx.nasiya.create({
      data: {
        shopId: input.shopId,
        deviceId: input.deviceId,
        customerId: input.customerId,
        totalAmount: 1_000,
        downPayment: 0,
        baseRemainingAmount: 1_000,
        finalNasiyaAmount: 1_000,
        remainingAmount: 1_000,
        months: 1,
        monthlyPayment: 1_000,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        contractTotalAmount: 1_000,
        contractBaseRemainingAmount: 1_000,
        contractFinalAmount: 1_000,
        contractMonthlyPayment: 1_000,
        contractRemainingAmount: 1_000,
        note: input.note,
        createdBy: input.actorId,
        deletedAt: input.deletedAt,
      },
    })
    await tx.nasiyaSchedule.create({
      data: {
        shopId: input.shopId,
        nasiyaId: nasiya.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-20T00:00:00.000Z'),
        expectedAmount: 1_000,
        contractExpectedAmount: 1_000,
        contractRemainingAmount: 1_000,
        status: 'OVERDUE',
      },
    })
    return nasiya
  })
}

async function createOlibPayable(input: {
  shopId: string
  actorId: string
  suffix: string
  customer?: {
    name?: string
    phone?: string
    normalizedPhone?: string
    additionalPhones?: string[]
  }
  device?: {
    model?: string
    imei?: string
    note?: string
    secondaryImei?: string
  }
  supplierName?: string
  supplierPhone?: string
  supplierNote?: string
}) {
  const customer = await createCustomer(input.shopId, input.suffix, input.customer)
  const device = await createDevice(input.shopId, input.actorId, input.suffix, {
    ...input.device,
    status: 'SOLD_DEBT',
  })
  const sale = await prisma.sale.create({
    data: {
      shopId: input.shopId,
      deviceId: device.id,
      customerId: customer.id,
      salePrice: 2_000,
      paymentMethod: 'CASH',
      paidFully: false,
      amountPaid: 500,
      remainingAmount: 1_500,
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      contractSalePrice: 2_000,
      contractAmountPaid: 500,
      contractRemainingAmount: 1_500,
      createdBy: input.actorId,
    },
  })
  const operation = await prisma.olibSotdimOperation.create({
    data: {
      shopId: input.shopId,
      deviceId: device.id,
      customerId: customer.id,
      dealType: 'SALE',
      saleId: sale.id,
      createdBy: input.actorId,
      creationIdempotencyKey: `search-operation-${input.suffix}`,
      creationCommandHash: `search-operation-hash-${input.suffix}`,
    },
  })
  const payable = await prisma.supplierPayable.create({
    data: {
      shopId: input.shopId,
      deviceId: device.id,
      saleId: sale.id,
      olibSotdimOperationId: operation.id,
      origin: 'OLIB_SOTDIM',
      supplierName: input.supplierName ?? `Supplier ${input.suffix}`,
      supplierPhone: input.supplierPhone ?? '+998 71 700 00 00',
      supplierNote: input.supplierNote,
      amount: 1_000,
      contractAmount: 1_000,
      remainingAmount: 1_000,
      contractRemainingAmount: 1_000,
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      createdBy: input.actorId,
    },
  })
  return { customer, device, sale, operation, payable }
}

describe('contiguous search parity in PostgreSQL list paths', () => {
  beforeEach(reset)
  afterAll(async () => prisma.$disconnect())

  it('keeps Prisma, derived-status SQL, and cohort SQL on identical 2446 semantics', async () => {
    const first = await createShop('301')
    const second = await createShop('302')
    const now = new Date('2026-07-23T08:00:00.000Z')
    const expectedIds: string[] = []

    const cases: Array<{
      suffix: string
      customer?: {
        name?: string
        phone?: string
        normalizedPhone?: string
        additionalPhones?: string[]
      }
      device?: {
        model?: string
        imei?: string
        note?: string
        secondaryImei?: string
      }
      nasiyaNote?: string
    }> = [
      {
        suffix: '31001',
        customer: {
          phone: '+998 90 124 46 78',
          normalizedPhone: '998901244678',
        },
      },
      {
        suffix: '31002',
        customer: {
          additionalPhones: ['+998 (95) 002-44-67', '+998 93 700 00 00'],
        },
      },
      {
        suffix: '31003',
        device: { imei: '35 912-2446-789012' },
      },
      {
        suffix: '31004',
        device: { secondaryImei: '86 001-2446-789012' },
      },
      {
        suffix: '31005',
        device: { model: 'Model 2446 Pro' },
      },
      {
        suffix: '31006',
        nasiyaNote: 'Shartnoma 2446 izohi',
      },
    ]

    for (const entry of cases) {
      const customer = await createCustomer(first.shop.id, entry.suffix, entry.customer)
      const device = await createDevice(first.shop.id, first.owner.id, entry.suffix, entry.device)
      const nasiya = await createOverdueNasiya({
        shopId: first.shop.id,
        actorId: first.owner.id,
        suffix: entry.suffix,
        customerId: customer.id,
        deviceId: device.id,
        note: entry.nasiyaNote,
      })
      expectedIds.push(nasiya.id)
    }

    for (const [suffix, name, model, note] of [
      ['32001', '2xx4xx4xx6', 'No match', 'No match'],
      ['32002', 'No match', '2464', 'No match'],
      ['32003', '24', '46', 'No match'],
    ] as const) {
      const customer = await createCustomer(first.shop.id, suffix, { name })
      const device = await createDevice(first.shop.id, first.owner.id, suffix, { model })
      await createOverdueNasiya({
        shopId: first.shop.id,
        actorId: first.owner.id,
        suffix,
        customerId: customer.id,
        deviceId: device.id,
        note,
      })
    }

    const mixedCustomer = await createCustomer(first.shop.id, '32004', {
      name: 'Mixed query decoy',
      phone: '+998 90 000 13 00',
      normalizedPhone: '998900001300',
    })
    const mixedDevice = await createDevice(first.shop.id, first.owner.id, '32004', { model: 'Samsung S24' })
    await createOverdueNasiya({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '32004',
      customerId: mixedCustomer.id,
      deviceId: mixedDevice.id,
    })

    const otherCustomer = await createCustomer(second.shop.id, '32005', {
      phone: '+998 90 124 46 79',
      normalizedPhone: '998901244679',
    })
    const otherDevice = await createDevice(second.shop.id, second.owner.id, '32005')
    await createOverdueNasiya({
      shopId: second.shop.id,
      actorId: second.owner.id,
      suffix: '32005',
      customerId: otherCustomer.id,
      deviceId: otherDevice.id,
    })

    const deletedCustomer = await createCustomer(first.shop.id, '32006', {
      phone: '+998 90 124 46 80',
      normalizedPhone: '998901244680',
    })
    const deletedDevice = await createDevice(first.shop.id, first.owner.id, '32006')
    await createOverdueNasiya({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '32006',
      customerId: deletedCustomer.id,
      deviceId: deletedDevice.id,
      deletedAt: new Date('2026-07-22T00:00:00.000Z'),
    })

    const prismaIds = (await prisma.nasiya.findMany({
      where: buildShopNasiyalarWhere(first.shop.id, { search: '2446' }),
      select: { id: true },
    })).map(({ id }) => id)
    const statusPage = await findShopNasiyaIdsByDerivedStatus({
      shopId: first.shop.id,
      status: 'OVERDUE',
      search: '2446',
      skip: 0,
      take: 100,
      now,
    })
    const cohortPage = await findShopNasiyaIdsByCohort({
      shopId: first.shop.id,
      cohort: 'OVERDUE',
      search: '2446',
      skip: 0,
      take: 100,
      now,
    })

    const expected = [...expectedIds].sort()
    expect(prismaIds.sort()).toEqual(expected)
    expect([...statusPage.ids].sort()).toEqual(expected)
    expect([...cohortPage.ids].sort()).toEqual(expected)
    expect(statusPage.total).toBe(expected.length)
    expect(cohortPage.total).toBe(expected.length)

    expect((await findShopNasiyaIdsByDerivedStatus({
      shopId: first.shop.id,
      status: 'OVERDUE',
      search: 'iPhone 13',
      skip: 0,
      take: 100,
      now,
    })).ids).toEqual([])

    const bounded = await findShopNasiyaIdsByCohort({
      shopId: first.shop.id,
      cohort: 'OVERDUE',
      search: '2446',
      skip: 0,
      take: 2,
      now,
    })
    expect(bounded.ids).toHaveLength(2)
    expect(bounded.total).toBe(expected.length)
  })

  it.each(['%', '_', '\\'])('treats raw-SQL wildcard-looking query %j literally', async (query) => {
    const actor = await createShop(`literal-${query.charCodeAt(0)}`)
    const literalCustomer = await createCustomer(actor.shop.id, '33001')
    const literalDevice = await createDevice(actor.shop.id, actor.owner.id, '33001')
    const literal = await createOverdueNasiya({
      shopId: actor.shop.id,
      actorId: actor.owner.id,
      suffix: '33001',
      customerId: literalCustomer.id,
      deviceId: literalDevice.id,
      note: `Literal ${query} marker`,
    })
    const plainCustomer = await createCustomer(actor.shop.id, '33002')
    const plainDevice = await createDevice(actor.shop.id, actor.owner.id, '33002')
    await createOverdueNasiya({
      shopId: actor.shop.id,
      actorId: actor.owner.id,
      suffix: '33002',
      customerId: plainCustomer.id,
      deviceId: plainDevice.id,
      note: 'Plain marker',
    })

    const now = new Date('2026-07-23T08:00:00.000Z')
    expect((await findShopNasiyaIdsByDerivedStatus({
      shopId: actor.shop.id,
      status: 'OVERDUE',
      search: query,
      skip: 0,
      take: 100,
      now,
    })).ids).toEqual([literal.id])
    expect((await findShopNasiyaIdsByCohort({
      shopId: actor.shop.id,
      cohort: 'OVERDUE',
      search: query,
      skip: 0,
      take: 100,
      now,
    })).ids).toEqual([literal.id])
  })

  it('covers Olib and both debt directions with tenant-safe secondary/additional evidence', async () => {
    const first = await createShop('401')
    const second = await createShop('402')
    const secondary = await createOlibPayable({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '41001',
      device: { secondaryImei: '86 001-2446-789012' },
    })
    const additional = await createOlibPayable({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '41002',
      customer: { additionalPhones: ['+998 (95) 002-44-67'] },
    })
    await createOlibPayable({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '41003',
      customer: { name: '2xx4xx4xx6' },
      device: { model: '2464' },
      supplierName: '24',
      supplierPhone: '46',
    })
    await createOlibPayable({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '41004',
      customer: {
        phone: '+998 90 000 13 00',
        normalizedPhone: '998900001300',
      },
      device: { model: 'Samsung S24' },
    })
    await createOlibPayable({
      shopId: second.shop.id,
      actorId: second.owner.id,
      suffix: '41005',
      device: { secondaryImei: '86 001-2446-789013' },
    })
    const deleted = await createOlibPayable({
      shopId: first.shop.id,
      actorId: first.owner.id,
      suffix: '41006',
      device: { secondaryImei: '86 001-2446-789014' },
    })
    await prisma.supplierPayable.update({
      where: { id: deleted.payable.id },
      data: { deletedAt: new Date(), deletedBy: 'integration', deleteNote: 'search scope' },
    })
    await prisma.sale.update({
      where: { id: deleted.sale.id },
      data: { deletedAt: new Date(), deletedBy: 'integration', deleteNote: 'search scope' },
    })

    const olibIds = (await prisma.supplierPayable.findMany({
      where: buildOlibSotdimWhere(first.shop.id, { search: '2446' }),
      select: { id: true },
    })).map(({ id }) => id).sort()
    expect(olibIds).toEqual([additional.payable.id, secondary.payable.id].sort())

    const outgoingIds = (await prisma.supplierPayable.findMany({
      where: {
        shopId: first.shop.id,
        deletedAt: null,
        status: { notIn: ['PAID', 'CANCELLED'] },
        contractRemainingAmount: { gt: 0 },
        ...buildOutgoingDebtSearchWhere('2446'),
      },
      select: { id: true },
    })).map(({ id }) => id)
    expect(outgoingIds).toEqual([secondary.payable.id])

    const incomingIds = (await prisma.sale.findMany({
      where: {
        shopId: first.shop.id,
        deletedAt: null,
        returnedAt: null,
        paidFully: false,
        contractRemainingAmount: { gt: 0 },
        ...buildIncomingDebtSearchWhere('2446'),
      },
      select: { id: true },
    })).map(({ id }) => id).sort()
    expect(incomingIds).toEqual([additional.sale.id, secondary.sale.id].sort())

    expect(await prisma.supplierPayable.count({
      where: buildOlibSotdimWhere(first.shop.id, { search: 'iPhone 13' }),
    })).toBe(0)
    expect(await prisma.supplierPayable.count({
      where: {
        shopId: first.shop.id,
        deletedAt: null,
        ...buildOutgoingDebtSearchWhere('iPhone 13'),
      },
    })).toBe(0)
    expect(await prisma.sale.count({
      where: {
        shopId: first.shop.id,
        deletedAt: null,
        ...buildIncomingDebtSearchWhere('iPhone 13'),
      },
    })).toBe(0)

    const outgoingPage = await queryOutgoingDebts(first.shop.id, {
      month: 'ALL',
      status: 'ALL',
      search: '2446',
      take: 100,
    })
    expect(outgoingPage.items).toHaveLength(1)
    expect(outgoingPage.items[0].id).toBe(secondary.payable.id)
    expect(outgoingPage.items[0].matchEvidence).toEqual([{
      field: 'SECONDARY_IMEI',
      displayText: '••••9012',
      mode: 'masked',
      highlightable: false,
    }])
    expect(JSON.stringify(outgoingPage)).not.toContain('86 001-2446-789012')

    const incomingPage = await queryIncomingPayLaterDebts(first.shop.id, {
      month: 'ALL',
      status: 'ALL',
      search: '2446',
      take: 100,
    })
    expect(incomingPage.items.map(({ id }) => id).sort()).toEqual([
      additional.sale.id,
      secondary.sale.id,
    ].sort())
    expect(incomingPage.items.find(({ id }) => id === additional.sale.id)?.matchEvidence).toEqual([{
      field: 'ADDITIONAL_PHONE',
    }])
    expect(incomingPage.items.length).toBeLessThanOrEqual(30)
  })
})
