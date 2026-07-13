import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { Session } from 'next-auth'
import { readChangeEventBatch } from '@/lib/server/change-events'
import { transitionNasiyaToOverdue } from '@/lib/server/overdue-transition'
import { findShopNasiyaIdsByDerivedStatus } from '@/lib/server/shop-lists'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "DeviceReturn",
      "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedShop(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: {
      name: `Owner ${suffix}`,
      login: `owner_${suffix}`,
      passwordHash: 'integration-only',
    },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Shop ${suffix}`,
      ownerName: `Owner ${suffix}`,
      ownerPhone: `+99890000${suffix.padStart(4, '0')}`,
      shopNumber: suffix,
      address: 'Integration test',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  return { owner, shop }
}

function session(input: { id: string; role: 'SHOP_ADMIN' | 'SUPER_ADMIN'; shopId: string | null }): Session {
  return {
    user: {
      id: input.id,
      name: 'Integration actor',
      role: input.role,
      shopId: input.shopId,
      sessionVersion: 1,
      sessionId: 'integration-session',
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

beforeEach(resetBusinessData)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('migration-managed active-only uniqueness', () => {
  it('normalizes direct writes and rejects every primary/secondary collision permutation', async () => {
    const { shop } = await seedShop('imei_matrix')
    const cases = [
      ['PRIMARY', 'PRIMARY'],
      ['PRIMARY', 'SECONDARY'],
      ['SECONDARY', 'PRIMARY'],
      ['SECONDARY', 'SECONDARY'],
    ] as const

    for (const [index, [existingSlot, attemptedSlot]] of cases.entries()) {
      const value = `35123456002${String(index).padStart(4, '0')}`
      const existingDevice = await prisma.device.create({
        data: { shopId: shop.id, model: `Existing ${index}`, purchasePrice: 100, imei: `LEGACY-A-${index}`, addedBy: 'integration' },
      })
      const attemptedDevice = await prisma.device.create({
        data: { shopId: shop.id, model: `Attempt ${index}`, purchasePrice: 100, imei: `LEGACY-B-${index}`, addedBy: 'integration' },
      })
      const normalized = await prisma.deviceImei.create({
        data: {
          shopId: shop.id,
          deviceId: existingDevice.id,
          slot: existingSlot,
          value: value.replace(/(\d{3})(\d{3})$/, '$1-$2'),
          normalizedValue: null,
        },
      })
      expect(normalized.normalizedValue).toBe(value)

      await expect(prisma.deviceImei.create({
        data: {
          shopId: shop.id,
          deviceId: attemptedDevice.id,
          slot: attemptedSlot,
          value,
          normalizedValue: null,
        },
      })).rejects.toMatchObject({ code: 'P2002' })
    }
  })

  it('enforces IMEI uniqueness across primary/secondary slots and releases it on device soft-delete', async () => {
    const firstShop = await seedShop('imei_slots_a')
    const secondShop = await seedShop('imei_slots_b')
    const first = await prisma.device.create({
      data: {
        shopId: firstShop.shop.id,
        model: 'Dual SIM A',
        purchasePrice: 100,
        imei: '351234560012345',
        addedBy: 'integration',
        imeis: { create: [
          { slot: 'PRIMARY', value: '351234560012345', normalizedValue: '351234560012345' },
          { slot: 'SECONDARY', value: '351234560012346', normalizedValue: '351234560012346' },
        ] },
      },
    })
    const second = await prisma.device.create({
      data: { shopId: firstShop.shop.id, model: 'Dual SIM B', purchasePrice: 100, imei: '351234560012347', addedBy: 'integration' },
    })

    await expect(prisma.deviceImei.create({ data: {
      shopId: firstShop.shop.id,
      deviceId: second.id,
      slot: 'SECONDARY',
      value: '351234560012345',
      normalizedValue: '351234560012345',
    } })).rejects.toMatchObject({ code: 'P2002' })

    const otherShopDevice = await prisma.device.create({
      data: { shopId: secondShop.shop.id, model: 'Other tenant', purchasePrice: 100, imei: '351234560012345', addedBy: 'integration' },
    })
    await expect(prisma.deviceImei.create({ data: {
      shopId: firstShop.shop.id,
      deviceId: otherShopDevice.id,
      slot: 'PRIMARY',
      value: '351234560012348',
      normalizedValue: '351234560012348',
    } })).rejects.toMatchObject({ code: 'P2003' })

    await prisma.device.update({ where: { id: first.id }, data: { deletedAt: new Date() } })
    expect(await prisma.deviceImei.count({ where: { deviceId: first.id, deletedAt: null } })).toBe(0)
    const reused = await prisma.deviceImei.create({ data: {
      shopId: firstShop.shop.id,
      deviceId: second.id,
      slot: 'SECONDARY',
      value: '351234560012345',
      normalizedValue: '351234560012345',
    } })
    expect(reused.normalizedValue).toBe('351234560012345')
  })

  it('rejects a duplicate active IMEI per shop and permits reuse after soft delete', async () => {
    const { shop } = await seedShop('imei')
    const first = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Phone A',
        purchasePrice: 1_000_000,
        imei: '123456789012345',
        addedBy: 'integration',
      },
    })

    await expect(
      prisma.device.create({
        data: {
          shopId: shop.id,
          model: 'Phone B',
          purchasePrice: 1_000_000,
          imei: first.imei,
          addedBy: 'integration',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.device.update({ where: { id: first.id }, data: { deletedAt: new Date() } })
    const reused = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Phone C',
        purchasePrice: 1_000_000,
        imei: first.imei,
        addedBy: 'integration',
      },
    })
    expect(reused.imei).toBe(first.imei)
  })

  it('rejects a duplicate active normalized phone per shop and permits reuse after soft delete', async () => {
    const { shop } = await seedShop('phone')
    const first = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Customer A', phone: '+998901234567', normalizedPhone: '998901234567' },
    })

    await expect(
      prisma.customer.create({
        data: { shopId: shop.id, name: 'Customer B', phone: '90 123 45 67', normalizedPhone: '998901234567' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.customer.update({ where: { id: first.id }, data: { deletedAt: new Date() } })
    const reused = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Customer C', phone: '+998901234567', normalizedPhone: '998901234567' },
    })
    expect(reused.normalizedPhone).toBe('998901234567')
  })

  it('rejects a child record whose parent belongs to another shop', async () => {
    const first = await seedShop('tenant_fk_a')
    const second = await seedShop('tenant_fk_b')
    const device = await prisma.device.create({
      data: { shopId: first.shop.id, model: 'Tenant A phone', purchasePrice: 100, imei: '744444444444444', addedBy: first.owner.id },
    })
    const otherCustomer = await prisma.customer.create({
      data: { shopId: second.shop.id, name: 'Tenant B customer', phone: '+998901212121', normalizedPhone: '998901212121' },
    })

    await expect(prisma.sale.create({
      data: {
        shopId: first.shop.id,
        deviceId: device.id,
        customerId: otherCustomer.id,
        salePrice: 200,
        amountPaid: 200,
        remainingAmount: 0,
        contractSalePrice: 200,
        contractAmountPaid: 200,
        contractRemainingAmount: 0,
        paymentMethod: 'CASH',
        createdBy: first.owner.id,
      },
    })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('stores a frozen native refund amount and exchange-rate snapshot', async () => {
    const { owner, shop } = await seedShop('refund_snapshot')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Refund customer', phone: '+998907777777', normalizedPhone: '998907777777' },
    })
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Refund phone', purchasePrice: 100, imei: '755555555555555', addedBy: owner.id, status: 'SOLD_CASH' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 6_250_000,
        amountPaid: 6_250_000,
        remainingAmount: 0,
        contractCurrency: 'USD',
        contractExchangeRateAtCreation: 12_500,
        contractSalePrice: 500,
        contractAmountPaid: 500,
        contractRemainingAmount: 0,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })
    const payment = await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: sale.id,
        amount: 6_250_000,
        paymentMethod: 'CASH',
        paymentInputAmount: 500,
        paymentInputCurrency: 'USD',
        paymentExchangeRate: 12_500,
        appliedAmountInContractCurrency: 500,
        createdBy: owner.id,
      },
    })
    const returned = await prisma.$transaction(async (tx) => {
      const returnRow = await tx.deviceReturn.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          saleId: sale.id,
          idempotencyKey: 'integration-refund-snapshot',
          ledgerVersion: 2,
          refundAmount: 6_250_000,
          refundInputAmount: 500,
          refundInputCurrency: 'USD',
          refundExchangeRateAtCreation: 12_500,
          refundMethod: 'CASH',
          contractCurrency: 'USD',
          contractAmount: 500,
          contractReceiptsAtReturn: 500,
          contractRefundAmount: 500,
          contractRetainedAmount: 0,
          contractCancelledDebt: 0,
          revenueReversalAmountUzs: 6_250_000,
          inventoryCostRecoveryUzs: 100,
          note: 'Integration refund',
          createdBy: owner.id,
        },
      })
      await tx.returnRefundAllocation.create({
        data: {
          shopId: shop.id,
          deviceReturnId: returnRow.id,
          salePaymentId: payment.id,
          sourcePaymentMethod: 'CASH',
          refundMethod: 'CASH',
          contractCurrency: 'USD',
          contractAmount: 500,
          amountUzs: 6_250_000,
        },
      })
      return returnRow
    })
    expect(returned).toMatchObject({
      refundInputCurrency: 'USD',
    })
    expect(Number(returned.refundInputAmount)).toBe(500)
    expect(Number(returned.refundExchangeRateAtCreation)).toBe(12_500)
    expect(Number(returned.refundAmount)).toBe(6_250_000)
  })
})

describe('database idempotency constraints', () => {
  it('allows only one sale payment for a shop/idempotency key', async () => {
    const { shop } = await seedShop('idem')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Customer', phone: '+998901111111', normalizedPhone: '998901111111' },
    })
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Phone', purchasePrice: 500_000, imei: '999999999999999', addedBy: 'integration', status: 'SOLD_DEBT' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000_000,
        amountPaid: 100_000,
        remainingAmount: 900_000,
        contractSalePrice: 1_000_000,
        contractAmountPaid: 100_000,
        contractRemainingAmount: 900_000,
        paymentMethod: 'CASH',
        paidFully: false,
        createdBy: 'integration',
      },
    })

    const data: Prisma.SalePaymentUncheckedCreateInput = {
      saleId: sale.id,
      shopId: shop.id,
      amount: 100_000,
      paymentMethod: 'CASH',
      idempotencyKey: 'integration-idempotency-key',
      createdBy: 'integration',
    }
    await prisma.salePayment.create({ data })
    await expect(prisma.salePayment.create({ data })).rejects.toMatchObject({ code: 'P2002' })
    expect(await prisma.salePayment.count({ where: { shopId: shop.id } })).toBe(1)
  })
})

describe('transactional incremental change events', () => {
  it('commits a business write, audit log, and scoped event atomically', async () => {
    const { owner, shop } = await seedShop('sync_atomic')
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: { shopId: shop.id, model: 'Sync phone', purchasePrice: 100, imei: '111111111111111', addedBy: owner.id },
      })
      await tx.log.create({
        data: {
          shopId: shop.id,
          actorId: owner.id,
          actorType: 'SUPER_ADMIN',
          action: 'CREATE',
          targetType: 'Device',
          targetId: row.id,
        },
      })
      return row
    })

    const event = await prisma.changeEvent.findFirst({ where: { scopeType: 'SHOP', scopeId: shop.id } })
    expect(event).toMatchObject({
      domain: 'devices',
      entityType: 'Device',
      entityId: created.id,
      operation: 'created',
    })
  })

  it('rolls back both the audit log and generated event when the business transaction fails', async () => {
    const { owner, shop } = await seedShop('sync_rollback')
    await expect(prisma.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: { shopId: shop.id, model: 'Rollback phone', purchasePrice: 100, imei: '222222222222222', addedBy: owner.id },
      })
      await tx.log.create({
        data: {
          shopId: shop.id,
          actorId: owner.id,
          actorType: 'SUPER_ADMIN',
          action: 'CREATE',
          targetType: 'Device',
          targetId: row.id,
        },
      })
      throw new Error('intentional rollback')
    })).rejects.toThrow('intentional rollback')

    expect(await prisma.device.count({ where: { shopId: shop.id } })).toBe(0)
    expect(await prisma.log.count({ where: { shopId: shop.id } })).toBe(0)
    expect(await prisma.changeEvent.count({ where: { scopeType: 'SHOP', scopeId: shop.id } })).toBe(0)
  })

  it('keeps shop cursors isolated and emits deletion tombstones in sequence order', async () => {
    const first = await seedShop('sync_scope_a')
    const second = await seedShop('sync_scope_b')
    await prisma.log.create({
      data: {
        shopId: first.shop.id,
        actorId: first.owner.id,
        actorType: 'SUPER_ADMIN',
        action: 'UPDATE',
        targetType: 'Device',
        targetId: 'device-a',
      },
    })
    await prisma.log.create({
      data: {
        shopId: second.shop.id,
        actorId: second.owner.id,
        actorType: 'SUPER_ADMIN',
        action: 'DELETE',
        targetType: 'Device',
        targetId: 'device-b',
      },
    })

    const firstEvents = await prisma.changeEvent.findMany({
      where: { scopeType: 'SHOP', scopeId: first.shop.id },
      orderBy: { sequence: 'asc' },
    })
    const secondEvents = await prisma.changeEvent.findMany({
      where: { scopeType: 'SHOP', scopeId: second.shop.id },
      orderBy: { sequence: 'asc' },
    })
    expect(firstEvents.map((event) => event.entityId)).toEqual(['device-a'])
    expect(secondEvents.map((event) => event.entityId)).toEqual(['device-b'])
    expect(secondEvents[0]?.operation).toBe('deleted')
    expect(firstEvents[0]!.sequence < secondEvents[0]!.sequence).toBe(true)
  })

  it('assigns unique monotonic cursors to concurrent committed mutations', async () => {
    const { owner, shop } = await seedShop('sync_concurrent')
    await Promise.all(Array.from({ length: 12 }, (_, index) => prisma.log.create({
      data: {
        shopId: shop.id,
        actorId: owner.id,
        actorType: 'SUPER_ADMIN',
        action: index % 2 === 0 ? 'CREATE' : 'UPDATE',
        targetType: 'Device',
        targetId: `concurrent-device-${index}`,
      },
    })))

    const events = await prisma.changeEvent.findMany({
      where: { scopeType: 'SHOP', scopeId: shop.id },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, entityId: true },
    })
    expect(events).toHaveLength(12)
    expect(new Set(events.map((event) => event.sequence.toString())).size).toBe(12)
    expect(events.every((event, index) => index === 0 || event.sequence > events[index - 1]!.sequence)).toBe(true)
    expect(new Set(events.map((event) => event.entityId)).size).toBe(12)
  })

  it('reads only the authenticated shop scope and paginates with hasMore', async () => {
    const first = await seedShop('sync_read_a')
    const second = await seedShop('sync_read_b')
    await Promise.all([
      ...Array.from({ length: 3 }, (_, index) => prisma.log.create({
        data: {
          shopId: first.shop.id,
          actorId: first.owner.id,
          actorType: 'SUPER_ADMIN',
          action: 'UPDATE',
          targetType: 'Device',
          targetId: `allowed-${index}`,
        },
      })),
      prisma.log.create({
        data: {
          shopId: second.shop.id,
          actorId: second.owner.id,
          actorType: 'SUPER_ADMIN',
          action: 'UPDATE',
          targetType: 'Device',
          targetId: 'forbidden-shop-device',
        },
      }),
    ])

    const actor = session({ id: first.owner.id, role: 'SHOP_ADMIN', shopId: first.shop.id })
    const firstBatch = await readChangeEventBatch({ session: actor, cursor: BigInt(0), limit: 2 })
    expect(firstBatch.hasMore).toBe(true)
    expect(firstBatch.databaseQueryCount).toBe(2)
    expect(firstBatch.events).toHaveLength(2)
    expect(firstBatch.events.every((event) => event.entityId.startsWith('allowed-'))).toBe(true)

    const secondBatch = await readChangeEventBatch({
      session: actor,
      cursor: BigInt(firstBatch.nextCursor),
      limit: 2,
    })
    expect(secondBatch.hasMore).toBe(false)
    expect(secondBatch.events).toHaveLength(1)
    expect(secondBatch.events[0]?.entityId).toMatch(/^allowed-/)
  })

  it('isolates per-admin events and reports an expired cursor gap', async () => {
    const first = await seedShop('sync_admin_a')
    const second = await seedShop('sync_admin_b')
    await prisma.log.createMany({
      data: [
        { actorId: first.owner.id, actorType: 'SUPER_ADMIN', action: 'UPDATE', targetType: 'SuperAdmin', targetId: first.owner.id },
        { actorId: second.owner.id, actorType: 'SUPER_ADMIN', action: 'UPDATE', targetType: 'SuperAdmin', targetId: second.owner.id },
      ],
    })
    const own = await readChangeEventBatch({
      session: session({ id: first.owner.id, role: 'SUPER_ADMIN', shopId: null }),
      cursor: BigInt(0),
    })
    expect(own.events.map((event) => event.entityId)).toEqual([first.owner.id])

    await Promise.all(Array.from({ length: 4 }, (_, index) => prisma.log.create({
      data: {
        shopId: first.shop.id,
        actorId: first.owner.id,
        actorType: 'SUPER_ADMIN',
        action: 'UPDATE',
        targetType: 'Device',
        targetId: `gap-${index}`,
      },
    })))
    const shopEvents = await prisma.changeEvent.findMany({
      where: { scopeType: 'SHOP', scopeId: first.shop.id },
      orderBy: { sequence: 'asc' },
      select: { sequence: true },
    })
    const oldCursor = shopEvents[0]!.sequence
    // Keep lower global events for other scopes. Gap detection must compare
    // against this shop's oldest retained cursor, not the global sequence.
    await prisma.changeEvent.deleteMany({
      where: {
        scopeType: 'SHOP',
        scopeId: first.shop.id,
        sequence: { lte: shopEvents[2]!.sequence },
      },
    })

    const reset = await readChangeEventBatch({
      session: session({ id: first.owner.id, role: 'SHOP_ADMIN', shopId: first.shop.id }),
      cursor: oldCursor,
    })
    expect(reset.resetRequired).toBe(true)
    expect(reset.databaseQueryCount).toBe(3)
    expect(reset.events).toEqual([])
  })

  it('emits an event when cron transitions a nasiya to overdue', async () => {
    const { owner, shop } = await seedShop('sync_cron')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Cron Customer', phone: '+998909999999', normalizedPhone: '998909999999' },
    })
    const device = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Cron Phone',
        purchasePrice: 500_000,
        imei: '333333333333333',
        addedBy: owner.id,
        status: 'SOLD_NASIYA',
      },
    })
    const nasiya = await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_000_000,
        downPayment: 100_000,
        baseRemainingAmount: 900_000,
        interestAmount: 0,
        finalNasiyaAmount: 900_000,
        remainingAmount: 900_000,
        months: 3,
        monthlyPayment: 300_000,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        contractTotalAmount: 1_000_000,
        contractDownPayment: 100_000,
        contractBaseRemainingAmount: 900_000,
        contractInterestAmount: 0,
        contractFinalAmount: 900_000,
        contractMonthlyPayment: 300_000,
        contractRemainingAmount: 900_000,
        createdBy: owner.id,
      },
    })
    await prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-01-10T00:00:00.000Z'),
        expectedAmount: 300_000,
        contractExpectedAmount: 300_000,
        contractRemainingAmount: 300_000,
      },
    })

    const scheduleId = (await prisma.nasiyaSchedule.findFirstOrThrow({ where: { nasiyaId: nasiya.id } })).id
    expect(await transitionNasiyaToOverdue({
      scheduleId,
      nasiyaId: nasiya.id,
      shopId: shop.id,
      overdueBefore: new Date('2026-01-10T00:00:00.000Z'),
    })).toBe(false)
    expect(await prisma.nasiya.findUnique({ where: { id: nasiya.id }, select: { status: true } }))
      .toEqual({ status: 'ACTIVE' })

    expect(await transitionNasiyaToOverdue({
      scheduleId,
      nasiyaId: nasiya.id,
      shopId: shop.id,
      overdueBefore: new Date('2026-01-11T00:00:00.000Z'),
    })).toBe(true)
    expect(await prisma.nasiya.findUnique({ where: { id: nasiya.id }, select: { status: true } }))
      .toEqual({ status: 'OVERDUE' })
    expect(await prisma.changeEvent.findFirst({
      where: { scopeType: 'SHOP', scopeId: shop.id, entityType: 'Nasiya', entityId: nasiya.id },
    })).toMatchObject({ operation: 'updated', mutationKind: 'nasiya.overdue' })
  })
})

describe('bounded derived nasiya status projection', () => {
  it('pages active, overdue, and completed contracts in PostgreSQL at the Tashkent boundary', async () => {
    const { owner, shop } = await seedShop('derived_status')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Status customer', phone: '+998908181818', normalizedPhone: '998908181818' },
    })

    async function createContract(
      index: number,
      dueDate: Date,
      paid: number,
      scheduleStatus: 'PENDING' | 'PAID' | 'CANCELLED' = paid === 100 ? 'PAID' : 'PENDING',
    ) {
      const device = await prisma.device.create({
        data: { shopId: shop.id, model: `Status phone ${index}`, purchasePrice: 50, imei: `76666666666666${index}`, addedBy: owner.id, status: 'SOLD_NASIYA' },
      })
      const remaining = 100 - paid
      const nasiya = await prisma.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          totalAmount: 100,
          downPayment: 0,
          baseRemainingAmount: 100,
          finalNasiyaAmount: 100,
          remainingAmount: remaining,
          months: 1,
          monthlyPayment: 100,
          startDate: dueDate,
          contractCurrency: 'UZS',
          contractTotalAmount: 100,
          contractBaseRemainingAmount: 100,
          contractFinalAmount: 100,
          contractMonthlyPayment: 100,
          contractPaidAmount: paid,
          contractRemainingAmount: remaining,
          status: paid === 100 ? 'COMPLETED' : 'ACTIVE',
          createdBy: owner.id,
        },
      })
      await prisma.nasiyaSchedule.create({
        data: {
          nasiyaId: nasiya.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate,
          expectedAmount: 100,
          paidAmount: paid,
          contractCurrency: 'UZS',
          contractExpectedAmount: 100,
          contractPaidAmount: paid,
          contractRemainingAmount: remaining,
          status: scheduleStatus,
        },
      })
      return nasiya.id
    }

    const today = await createContract(1, new Date('2026-07-12T00:00:00.000Z'), 0)
    const overdue = await createContract(2, new Date('2026-07-11T00:00:00.000Z'), 0)
    const completed = await createContract(3, new Date('2026-07-11T00:00:00.000Z'), 100)
    const cancelledSchedule = await createContract(4, new Date('2026-07-01T00:00:00.000Z'), 0, 'CANCELLED')
    const now = new Date('2026-07-12T12:00:00.000Z')

    await expect(findShopNasiyaIdsByDerivedStatus({ shopId: shop.id, status: 'ACTIVE', skip: 0, take: 25, now }))
      .resolves.toMatchObject({ ids: [today], total: 1 })
    await expect(findShopNasiyaIdsByDerivedStatus({ shopId: shop.id, status: 'OVERDUE', skip: 0, take: 25, now }))
      .resolves.toMatchObject({ ids: [overdue], total: 1 })
    const completedPage = await findShopNasiyaIdsByDerivedStatus({
      shopId: shop.id,
      status: 'COMPLETED',
      skip: 0,
      take: 25,
      now,
    })
    expect(completedPage.total).toBe(2)
    expect(new Set(completedPage.ids)).toEqual(new Set([completed, cancelledSchedule]))
  })
})
