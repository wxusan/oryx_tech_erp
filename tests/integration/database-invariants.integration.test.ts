import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { Session } from 'next-auth'
import { readChangeEventBatch } from '@/lib/server/change-events'
import { transitionNasiyaToOverdue } from '@/lib/server/overdue-transition'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ChangeEvent", "OpsEvent", "Log", "Notification", "DeviceReturn",
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
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

beforeEach(resetBusinessData)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('migration-managed active-only uniqueness', () => {
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
    await prisma.changeEvent.deleteMany({ where: { sequence: { lte: shopEvents[2]!.sequence } } })

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
        remainingAmount: 900_000,
        months: 3,
        monthlyPayment: 300_000,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
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

    expect(await transitionNasiyaToOverdue({
      scheduleId: (await prisma.nasiyaSchedule.findFirstOrThrow({ where: { nasiyaId: nasiya.id } })).id,
      nasiyaId: nasiya.id,
      shopId: shop.id,
    })).toBe(true)
    expect(await prisma.nasiya.findUnique({ where: { id: nasiya.id }, select: { status: true } }))
      .toEqual({ status: 'OVERDUE' })
    expect(await prisma.changeEvent.findFirst({
      where: { scopeType: 'SHOP', scopeId: shop.id, entityType: 'Nasiya', entityId: nasiya.id },
    })).toMatchObject({ operation: 'updated', mutationKind: 'nasiya.overdue' })
  })
})
