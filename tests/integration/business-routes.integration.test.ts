import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { getCustomerProfileHistory, getCustomerProfileOverview } from '@/lib/server/customer-profile'
import { getShopMonthlyAccountingAggregate } from '@/lib/server/shop-stats-queries'
import { seedBuiltInStaffRoles } from '@/lib/server/shop-staff-roles'
import { getShopRangeReport } from '@/lib/server/shop-report-range'
import { resolveReportRange } from '@/lib/report-range'

const authState = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => authState.session),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})

vi.mock('@/lib/server/cache-tags', () => ({
  invalidateShopCustomerMutation: vi.fn(),
  invalidateShopDeviceMutation: vi.fn(),
  invalidateShopNasiyaMutation: vi.fn(),
  invalidateShopNasiyaSettlementMutation: vi.fn(),
  invalidateShopPaymentMutation: vi.fn(),
  invalidateShopSaleMutation: vi.fn(),
  invalidateShopReturnMutation: vi.fn(),
  invalidateShopSupplierPayableMutation: vi.fn(),
}))

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 6 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "DeviceReturn",
      "NasiyaResolutionEvent", "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedActor(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: { name: `Owner ${suffix}`, login: `owner_route_${suffix}`, passwordHash: 'audit-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Route shop ${suffix}`,
      ownerName: `Owner ${suffix}`,
      ownerPhone: `+99897${suffix.padStart(7, '0').slice(-7)}`,
      shopNumber: suffix,
      address: 'Disposable route audit',
      preferredCurrency: 'UZS',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  const admin = await prisma.shopAdmin.create({
    data: {
      shopId: shop.id,
      name: `Admin ${suffix}`,
      phone: `+99896${suffix.padStart(7, '0').slice(-7)}`,
      login: `admin_route_${suffix}`,
      passwordHash: 'audit-only',
    },
  })
  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      ownerAdminId: admin.id,
      ownershipStatus: 'RESOLVED',
      ownershipResolvedAt: new Date('2026-07-01T00:00:00.000Z'),
      ownershipResolvedById: owner.id,
    },
  })
  const packageVersion = await prisma.shopPackageVersion.create({
    data: {
      shopId: shop.id,
      effectiveOn: new Date('2026-01-01T00:00:00.000Z'),
      basePrice: 1_000,
      currency: 'UZS',
      discountAmount: 0,
      pricingNeedsReview: false,
      note: 'Disposable integration package',
      createdById: owner.id,
      features: {
        create: [
          'INVENTORY', 'CASH_SALES', 'NASIYA', 'OLIB_SOTDIM', 'CUSTOMER_CRM',
          'TELEGRAM', 'REMINDERS', 'REPORTS', 'IMPORTS', 'EXPORTS', 'STAFF_ACCESS',
        ].map((featureCode) => ({ featureCode, enabled: true, recurringPrice: 0 })),
      },
    },
  })
  const authSession = await prisma.authSession.create({
    data: {
      id: `route-session-${suffix}`,
      actorId: admin.id,
      actorType: 'SHOP_ADMIN',
      shopId: shop.id,
      sessionVersion: admin.sessionVersion,
      packageVersionId: packageVersion.id,
      policy: 'IDLE_10_MINUTES',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
  })
  return { owner, shop, admin, authSession, packageVersion }
}

function useShopAdmin(actor: Awaited<ReturnType<typeof seedActor>>) {
  authState.session = {
    user: {
      id: actor.admin.id,
      name: actor.admin.name,
      role: 'SHOP_ADMIN',
      shopId: actor.shop.id,
      sessionVersion: actor.admin.sessionVersion,
      sessionId: actor.authSession.id,
      sessionPolicy: actor.authSession.policy,
      packageVersionId: actor.authSession.packageVersionId,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

async function seedStaff(
  actor: Awaited<ReturnType<typeof seedActor>>,
  suffix: string,
  permissionCodes: string[],
) {
  const admin = await prisma.shopAdmin.create({
    data: {
      shopId: actor.shop.id,
      name: `Staff ${suffix}`,
      phone: `+99893${suffix.padStart(7, '0').slice(-7)}`,
      login: `staff_route_${suffix}`,
      passwordHash: 'audit-only',
    },
  })
  if (permissionCodes.length) {
    await prisma.shopMemberPermission.createMany({
      data: permissionCodes.map((permissionCode) => ({
        shopId: actor.shop.id,
        shopAdminId: admin.id,
        permissionCode,
        grantedById: actor.admin.id,
      })),
    })
  }
  const authSession = await prisma.authSession.create({
    data: {
      id: `staff-route-session-${suffix}`,
      actorId: admin.id,
      actorType: 'SHOP_ADMIN',
      shopId: actor.shop.id,
      sessionVersion: admin.sessionVersion,
      packageVersionId: actor.packageVersion.id,
      policy: 'IDLE_10_MINUTES',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
  })
  return { ...actor, admin, authSession }
}

async function deviceListRequest() {
  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/devices/route')
  return GET(new NextRequest('http://localhost/api/devices?paginated=1'))
}

async function createDeviceRequest(body: Record<string, unknown>, idempotencyKey: string) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/route')
  return POST(new NextRequest('http://localhost/api/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
  }))
}

async function shopStatsRequest() {
  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/stats/shop/route')
  return GET(new NextRequest('http://localhost/api/stats/shop'))
}

async function createStaffRequest(body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/shop/staff/route')
  return POST(new NextRequest('http://localhost/api/shop/staff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function staffListRequest() {
  const { GET } = await import('@/app/api/shop/staff/route')
  return GET()
}

async function updateStaffRequest(staffId: string, body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server')
  const { PATCH } = await import('@/app/api/shop/staff/[id]/route')
  return PATCH(new NextRequest(`http://localhost/api/shop/staff/${staffId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: staffId }) })
}

async function createStaffRoleRequest(body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/shop/staff/roles/route')
  return POST(new NextRequest('http://localhost/api/shop/staff/roles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function staffRoleListRequest() {
  const { GET } = await import('@/app/api/shop/staff/roles/route')
  return GET()
}

async function updateStaffRoleRequest(roleId: string, body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server')
  const { PATCH } = await import('@/app/api/shop/staff/roles/[roleId]/route')
  return PATCH(new NextRequest(`http://localhost/api/shop/staff/roles/${roleId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ roleId }) })
}

async function archiveStaffRoleRequest(roleId: string, body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server')
  const { DELETE } = await import('@/app/api/shop/staff/roles/[roleId]/route')
  return DELETE(new NextRequest(`http://localhost/api/shop/staff/roles/${roleId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ roleId }) })
}

async function useSuperAdmin(actor: Awaited<ReturnType<typeof seedActor>>) {
  const authSession = await prisma.authSession.create({
    data: {
      id: `super-route-session-${actor.owner.id}`,
      actorId: actor.owner.id,
      actorType: 'SUPER_ADMIN',
      sessionVersion: actor.owner.sessionVersion,
      policy: 'IDLE_10_MINUTES',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    },
  })
  authState.session = {
    user: {
      id: actor.owner.id,
      name: actor.owner.name,
      role: 'SUPER_ADMIN',
      shopId: null,
      sessionVersion: actor.owner.sessionVersion,
      sessionId: authSession.id,
      sessionPolicy: authSession.policy,
      packageVersionId: null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

async function seedNasiya(actor: Awaited<ReturnType<typeof seedActor>>, suffix: string, amount: number) {
  const customer = await prisma.customer.create({
    data: {
      shopId: actor.shop.id,
      name: `Route customer ${suffix}`,
      phone: `+99895${suffix.padStart(7, '0').slice(-7)}`,
      normalizedPhone: `99895${suffix.padStart(7, '0').slice(-7)}`,
    },
  })
  const device = await prisma.device.create({
    data: {
      shopId: actor.shop.id,
      model: `Route phone ${suffix}`,
      purchasePrice: amount / 2,
      purchaseInputAmount: amount / 2,
      purchaseAmountUzsSnapshot: amount / 2,
      imei: `ROUTE-NASIYA-${suffix}`,
      addedBy: actor.admin.id,
      status: 'SOLD_NASIYA',
    },
  })
  const { nasiya, schedule } = await prisma.$transaction(async (tx) => {
    const nasiya = await tx.nasiya.create({
    data: {
      shopId: actor.shop.id,
      deviceId: device.id,
      customerId: customer.id,
      totalAmount: amount,
      downPayment: 0,
      baseRemainingAmount: amount,
      finalNasiyaAmount: amount,
      remainingAmount: amount,
      months: 1,
      monthlyPayment: amount,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      contractCurrency: 'UZS',
      contractTotalAmount: amount,
      contractBaseRemainingAmount: amount,
      contractFinalAmount: amount,
      contractMonthlyPayment: amount,
      contractRemainingAmount: amount,
      contractPaidAmount: 0,
      createdBy: actor.admin.id,
    },
  })
    const schedule = await tx.nasiyaSchedule.create({
    data: {
      nasiyaId: nasiya.id,
      shopId: actor.shop.id,
      monthNumber: 1,
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      expectedAmount: amount,
      contractCurrency: 'UZS',
      contractExpectedAmount: amount,
      contractRemainingAmount: amount,
    },
  })
    return { nasiya, schedule }
  })
  return { customer, device, nasiya, schedule }
}

async function seedSettlementNasiya(
  actor: Awaited<ReturnType<typeof seedActor>>,
  suffix: string,
) {
  const customer = await prisma.customer.create({
    data: {
      shopId: actor.shop.id,
      name: `Settlement customer ${suffix}`,
      phone: `+99894${suffix.padStart(7, '0').slice(-7)}`,
      normalizedPhone: `99894${suffix.padStart(7, '0').slice(-7)}`,
    },
  })
  const device = await prisma.device.create({
    data: {
      shopId: actor.shop.id,
      model: `Settlement phone ${suffix}`,
      purchasePrice: 600,
      purchaseInputAmount: 600,
      purchaseAmountUzsSnapshot: 600,
      imei: `ROUTE-SETTLEMENT-${suffix}`,
      addedBy: actor.admin.id,
      status: 'SOLD_NASIYA',
    },
  })

  const result = await prisma.$transaction(async (tx) => {
    const nasiya = await tx.nasiya.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_000,
        downPayment: 0,
        baseRemainingAmount: 1_000,
        interestPercent: 20,
        interestAmount: 200,
        finalNasiyaAmount: 1_200,
        remainingAmount: 600,
        months: 2,
        monthlyPayment: 600,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        contractCurrency: 'UZS',
        contractTotalAmount: 1_000,
        contractDownPayment: 0,
        contractBaseRemainingAmount: 1_000,
        contractInterestAmount: 200,
        contractFinalAmount: 1_200,
        contractMonthlyPayment: 600,
        contractRemainingAmount: 600,
        contractPaidAmount: 600,
        contractCostBasisAmount: 600,
        contractMarginAmount: 400,
        contractDownPaymentPrincipalAmount: 0,
        contractDownPaymentMarginAmount: 0,
        accountingReconstructionStatus: 'COMPLETE',
        accountingReconstructedAt: new Date('2026-07-01T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })
    const paidSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        expectedAmount: 600,
        paidAmount: 600,
        status: 'PAID',
        paidAt: new Date('2026-07-01T08:00:00.000Z'),
        paymentMethod: 'CARD',
        contractCurrency: 'UZS',
        contractExpectedAmount: 600,
        contractPaidAmount: 600,
        contractRemainingAmount: 0,
        contractPrincipalAmount: 300,
        contractMarginAmount: 200,
        contractInterestAmount: 100,
        contractPrincipalPaidAmount: 300,
        contractMarginPaidAmount: 200,
        contractInterestPaidAmount: 100,
      },
    })
    const openSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 2,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        expectedAmount: 600,
        paidAmount: 0,
        status: 'PENDING',
        contractCurrency: 'UZS',
        contractExpectedAmount: 600,
        contractPaidAmount: 0,
        contractRemainingAmount: 600,
        contractPrincipalAmount: 300,
        contractMarginAmount: 200,
        contractInterestAmount: 100,
        contractPrincipalPaidAmount: 0,
        contractMarginPaidAmount: 0,
        contractInterestPaidAmount: 0,
      },
    })
    const priorPayment = await tx.nasiyaPayment.create({
      data: {
        nasiyaId: nasiya.id,
        nasiyaScheduleId: paidSchedule.id,
        shopId: actor.shop.id,
        amount: 600,
        paymentMethod: 'CARD',
        paidAt: new Date('2026-07-01T08:00:00.000Z'),
        note: 'Already paid first instalment',
        idempotencyKey: `settlement-seed-${suffix}`,
        paymentInputAmount: 600,
        paymentInputCurrency: 'UZS',
        appliedAmountInContractCurrency: 600,
        createdBy: actor.admin.id,
      },
    })
    await tx.nasiyaPaymentAllocation.create({
      data: {
        shopId: actor.shop.id,
        nasiyaId: nasiya.id,
        nasiyaPaymentId: priorPayment.id,
        nasiyaScheduleId: paidSchedule.id,
        sequence: 1,
        contractCurrency: 'UZS',
        contractAmount: 600,
        contractPrincipalAmount: 300,
        contractMarginAmount: 200,
        contractInterestAmount: 100,
        amountUzs: 600,
        principalAmountUzs: 300,
        marginAmountUzs: 200,
        interestAmountUzs: 100,
      },
    })
    return { nasiya, paidSchedule, openSchedule, priorPayment }
  })

  return { customer, device, ...result }
}

async function seedReturnableNasiya(
  actor: Awaited<ReturnType<typeof seedActor>>,
  suffix: string,
) {
  const customer = await prisma.customer.create({
    data: {
      shopId: actor.shop.id,
      name: `Returnable Nasiya customer ${suffix}`,
      phone: `+99892${suffix.padStart(7, '0').slice(-7)}`,
      normalizedPhone: `99892${suffix.padStart(7, '0').slice(-7)}`,
    },
  })
  const device = await prisma.device.create({
    data: {
      shopId: actor.shop.id,
      model: `Returnable Nasiya phone ${suffix}`,
      purchasePrice: 600,
      purchaseInputAmount: 600,
      purchaseAmountUzsSnapshot: 600,
      imei: `ROUTE-NASIYA-RETURN-${suffix}`,
      addedBy: actor.admin.id,
      status: 'SOLD_NASIYA',
    },
  })

  const result = await prisma.$transaction(async (tx) => {
    const nasiya = await tx.nasiya.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_000,
        downPayment: 100,
        baseRemainingAmount: 900,
        interestPercent: 11.11,
        interestAmount: 100,
        finalNasiyaAmount: 1_000,
        remainingAmount: 850,
        months: 3,
        monthlyPayment: 333,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        contractCurrency: 'UZS',
        contractTotalAmount: 1_000,
        contractDownPayment: 100,
        contractBaseRemainingAmount: 900,
        contractInterestAmount: 100,
        contractFinalAmount: 1_000,
        contractMonthlyPayment: 333,
        contractRemainingAmount: 850,
        contractPaidAmount: 150,
        contractCostBasisAmount: 600,
        contractMarginAmount: 400,
        contractDownPaymentPrincipalAmount: 100,
        contractDownPaymentMarginAmount: 0,
        accountingReconstructionStatus: 'COMPLETE',
        accountingReconstructedAt: new Date('2026-07-01T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })
    const paidSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        expectedAmount: 150,
        paidAmount: 150,
        status: 'PAID',
        paidAt: new Date('2026-07-15T08:00:00.000Z'),
        paymentMethod: 'CASH',
        contractCurrency: 'UZS',
        contractExpectedAmount: 150,
        contractPaidAmount: 150,
        contractRemainingAmount: 0,
        contractPrincipalAmount: 75,
        contractMarginAmount: 60,
        contractInterestAmount: 15,
        contractPrincipalPaidAmount: 75,
        contractMarginPaidAmount: 60,
        contractInterestPaidAmount: 15,
      },
    })
    const openSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 2,
        dueDate: new Date('2026-08-30T00:00:00.000Z'),
        expectedAmount: 350,
        status: 'PENDING',
        contractCurrency: 'UZS',
        contractExpectedAmount: 350,
        contractPaidAmount: 0,
        contractRemainingAmount: 350,
        contractPrincipalAmount: 175,
        contractMarginAmount: 140,
        contractInterestAmount: 35,
      },
    })
    const finalSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 3,
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        expectedAmount: 500,
        status: 'PENDING',
        contractCurrency: 'UZS',
        contractExpectedAmount: 500,
        contractPaidAmount: 0,
        contractRemainingAmount: 500,
        contractPrincipalAmount: 250,
        contractMarginAmount: 200,
        contractInterestAmount: 50,
      },
    })
    const downPayment = await tx.nasiyaPayment.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        amount: 100,
        paymentMethod: 'CASH',
        paidAt: new Date('2026-07-01T08:00:00.000Z'),
        note: 'Boshlang‘ich to‘lov',
        idempotencyKey: `return-down-payment-${suffix}`,
        paymentInputAmount: 100,
        paymentInputCurrency: 'UZS',
        appliedAmountInContractCurrency: 100,
        createdBy: actor.admin.id,
      },
    })
    const laterPayment = await tx.nasiyaPayment.create({
      data: {
        nasiyaId: nasiya.id,
        nasiyaScheduleId: paidSchedule.id,
        shopId: actor.shop.id,
        amount: 150,
        paymentMethod: 'CASH',
        paidAt: new Date('2026-07-15T08:00:00.000Z'),
        note: 'Birinchi oylik qisman to‘lov',
        idempotencyKey: `return-later-payment-${suffix}`,
        paymentInputAmount: 150,
        paymentInputCurrency: 'UZS',
        appliedAmountInContractCurrency: 150,
        createdBy: actor.admin.id,
      },
    })
    await tx.nasiyaPaymentAllocation.createMany({
      data: [
        {
          shopId: actor.shop.id,
          nasiyaId: nasiya.id,
          nasiyaPaymentId: downPayment.id,
          nasiyaScheduleId: null,
          sequence: 1,
          contractCurrency: 'UZS',
          contractAmount: 100,
          contractPrincipalAmount: 100,
          contractMarginAmount: 0,
          contractInterestAmount: 0,
          amountUzs: 100,
          principalAmountUzs: 100,
          marginAmountUzs: 0,
          interestAmountUzs: 0,
        },
        {
          shopId: actor.shop.id,
          nasiyaId: nasiya.id,
          nasiyaPaymentId: laterPayment.id,
          nasiyaScheduleId: paidSchedule.id,
          sequence: 1,
          contractCurrency: 'UZS',
          contractAmount: 150,
          contractPrincipalAmount: 75,
          contractMarginAmount: 60,
          contractInterestAmount: 15,
          amountUzs: 150,
          principalAmountUzs: 75,
          marginAmountUzs: 60,
          interestAmountUzs: 15,
        },
      ],
    })
    return { nasiya, paidSchedule, openSchedules: [openSchedule, finalSchedule], downPayment, laterPayment }
  })

  return { customer, device, ...result }
}

async function seedUsdSettlementNasiya(
  actor: Awaited<ReturnType<typeof seedActor>>,
  suffix: string,
) {
  const creationRate = 12_000
  const customer = await prisma.customer.create({
    data: {
      shopId: actor.shop.id,
      name: `USD settlement customer ${suffix}`,
      phone: `+99893${suffix.padStart(7, '0').slice(-7)}`,
      normalizedPhone: `99893${suffix.padStart(7, '0').slice(-7)}`,
    },
  })
  const device = await prisma.device.create({
    data: {
      shopId: actor.shop.id,
      model: `USD settlement phone ${suffix}`,
      purchasePrice: 720_000,
      purchaseCurrency: 'USD',
      purchaseInputAmount: 60,
      purchaseExchangeRateAtCreation: creationRate,
      purchaseAmountUzsSnapshot: 720_000,
      imei: `ROUTE-USD-SETTLEMENT-${suffix}`,
      addedBy: actor.admin.id,
      status: 'SOLD_NASIYA',
    },
  })

  const result = await prisma.$transaction(async (tx) => {
    const nasiya = await tx.nasiya.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_200_000,
        downPayment: 0,
        baseRemainingAmount: 1_200_000,
        interestPercent: 20,
        interestAmount: 240_000,
        finalNasiyaAmount: 1_440_000,
        remainingAmount: 720_000,
        months: 2,
        monthlyPayment: 720_000,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        creationCurrency: 'USD',
        creationExchangeRate: creationRate,
        contractCurrency: 'USD',
        contractExchangeRateAtCreation: creationRate,
        contractTotalAmount: 100,
        contractDownPayment: 0,
        contractBaseRemainingAmount: 100,
        contractInterestAmount: 20,
        contractFinalAmount: 120,
        contractMonthlyPayment: 60,
        contractRemainingAmount: 60,
        contractPaidAmount: 60,
        contractCostBasisAmount: 60,
        contractMarginAmount: 40,
        contractDownPaymentPrincipalAmount: 0,
        contractDownPaymentMarginAmount: 0,
        accountingReconstructionStatus: 'COMPLETE',
        accountingReconstructedAt: new Date('2026-07-01T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })
    const paidSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        expectedAmount: 720_000,
        paidAmount: 720_000,
        status: 'PAID',
        paidAt: new Date('2026-07-01T08:00:00.000Z'),
        paymentMethod: 'CARD',
        contractCurrency: 'USD',
        contractExpectedAmount: 60,
        contractPaidAmount: 60,
        contractRemainingAmount: 0,
        contractPrincipalAmount: 30,
        contractMarginAmount: 20,
        contractInterestAmount: 10,
        contractPrincipalPaidAmount: 30,
        contractMarginPaidAmount: 20,
        contractInterestPaidAmount: 10,
      },
    })
    const openSchedule = await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 2,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        expectedAmount: 720_000,
        paidAmount: 0,
        status: 'PENDING',
        contractCurrency: 'USD',
        contractExpectedAmount: 60,
        contractPaidAmount: 0,
        contractRemainingAmount: 60,
        contractPrincipalAmount: 30,
        contractMarginAmount: 20,
        contractInterestAmount: 10,
        contractPrincipalPaidAmount: 0,
        contractMarginPaidAmount: 0,
        contractInterestPaidAmount: 0,
      },
    })
    const priorPayment = await tx.nasiyaPayment.create({
      data: {
        nasiyaId: nasiya.id,
        nasiyaScheduleId: paidSchedule.id,
        shopId: actor.shop.id,
        amount: 720_000,
        paymentMethod: 'CARD',
        paidAt: new Date('2026-07-01T08:00:00.000Z'),
        note: 'Already paid first USD instalment',
        idempotencyKey: `usd-settlement-seed-${suffix}`,
        paymentInputAmount: 60,
        paymentInputCurrency: 'USD',
        paymentExchangeRate: creationRate,
        paymentExchangeRateSource: 'RECORDED_FROZEN',
        appliedAmountInContractCurrency: 60,
        createdBy: actor.admin.id,
      },
    })
    await tx.nasiyaPaymentAllocation.create({
      data: {
        shopId: actor.shop.id,
        nasiyaId: nasiya.id,
        nasiyaPaymentId: priorPayment.id,
        nasiyaScheduleId: paidSchedule.id,
        sequence: 1,
        contractCurrency: 'USD',
        contractAmount: 60,
        contractPrincipalAmount: 30,
        contractMarginAmount: 20,
        contractInterestAmount: 10,
        amountUzs: 720_000,
        principalAmountUzs: 360_000,
        marginAmountUzs: 240_000,
        interestAmountUzs: 120_000,
      },
    })
    return { nasiya, paidSchedule, openSchedule, priorPayment }
  })

  return { customer, device, ...result }
}

async function nasiyaPaymentRequest(input: {
  nasiyaId: string
  scheduleId: string
  amount: number
  key: string
  note?: string
  date?: string
  inputCurrency?: 'UZS' | 'USD'
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/nasiya/[id]/payment/route')
  const request = new NextRequest(`http://localhost/api/nasiya/${input.nasiyaId}/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      nasiyaScheduleId: input.scheduleId,
      amount: input.amount,
      paymentMethod: 'CASH',
      date: input.date ?? '2026-07-13T08:00:00.000Z',
      note: input.note ?? 'Audit payment reason',
      inputCurrency: input.inputCurrency ?? 'UZS',
    }),
  })
  return POST(request, { params: Promise.resolve({ id: input.nasiyaId }) })
}

async function nasiyaDetailRequest(nasiyaId: string) {
  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/nasiya/[id]/route')
  return GET(new NextRequest(`http://localhost/api/nasiya/${nasiyaId}`), {
    params: Promise.resolve({ id: nasiyaId }),
  })
}

async function nasiyaSettlementQuoteRequest(nasiyaId: string) {
  const { NextRequest } = await import('next/server')
  const { GET } = await import('@/app/api/nasiya/[id]/settlement/route')
  return GET(new NextRequest(`http://localhost/api/nasiya/${nasiyaId}/settlement`), {
    params: Promise.resolve({ id: nasiyaId }),
  })
}

async function nasiyaSettlementRequest(input: {
  nasiyaId: string
  mode: 'FULL_WITH_PROFIT' | 'WAIVE_REMAINING_PROFIT'
  expectedRemaining: number
  expectedCash: number
  expectedWaived: number
  key: string
  reason?: string
  inputCurrency?: 'UZS' | 'USD'
  expectedContractCurrency?: 'UZS' | 'USD'
  paymentMethod?: 'CASH' | 'CARD'
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/nasiya/[id]/settlement/route')
  return POST(new NextRequest(`http://localhost/api/nasiya/${input.nasiyaId}/settlement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      mode: input.mode,
      paymentMethod: input.paymentMethod ?? 'CASH',
      date: '2026-07-22T08:00:00.000Z',
      reason: input.reason,
      inputCurrency: input.inputCurrency ?? 'UZS',
      expectedContractCurrency: input.expectedContractCurrency ?? 'UZS',
      expectedRemainingMinorUnits: input.expectedRemaining,
      expectedCashMinorUnits: input.expectedCash,
      expectedWaivedMinorUnits: input.expectedWaived,
    }),
  }), { params: Promise.resolve({ id: input.nasiyaId }) })
}

async function nasiyaDeferRequest(input: {
  nasiyaId: string
  scheduleId: string
  newDueDate: string
  reason: string
  key: string
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/nasiya/[id]/defer/route')
  return POST(new NextRequest(`http://localhost/api/nasiya/${input.nasiyaId}/defer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      nasiyaScheduleId: input.scheduleId,
      newDueDate: input.newDueDate,
      reason: input.reason,
    }),
  }), { params: Promise.resolve({ id: input.nasiyaId }) })
}

async function nasiyaResolutionRequest(input: {
  nasiyaId: string
  action: 'ARCHIVE' | 'WRITE_OFF' | 'REOPEN'
  reason: string
  key: string
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/nasiya/[id]/resolution/route')
  return POST(new NextRequest(`http://localhost/api/nasiya/${input.nasiyaId}/resolution`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({ action: input.action, reason: input.reason }),
  }), { params: Promise.resolve({ id: input.nasiyaId }) })
}

async function salePaymentRequest(input: {
  saleId: string
  amount: number
  key: string
  note?: string
  paidAt?: string
  nextDueDate?: string
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/sales/[id]/payment/route')
  return POST(new NextRequest(`http://localhost/api/sales/${input.saleId}/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      amount: input.amount,
      paymentMethod: 'CASH',
      paidAt: input.paidAt,
      nextDueDate: input.nextDueDate,
      note: input.note ?? 'Sale payment reason',
      inputCurrency: 'UZS',
    }),
  }), { params: Promise.resolve({ id: input.saleId }) })
}

async function shopPaymentRequest(input: {
  shopId: string
  amount: number
  months: number
  key: string
  note?: string
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/shops/[id]/payment/route')
  return POST(new NextRequest(`http://localhost/api/shops/${input.shopId}/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      shopId: input.shopId,
      amount: input.amount,
      months: input.months,
      paymentMethod: 'CASH',
      note: input.note ?? 'Subscription payment',
    }),
  }), { params: Promise.resolve({ id: input.shopId }) })
}

async function returnDeviceRequest(input: {
  deviceId: string
  key: string
  refundAmount: number
  refundMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'
  note?: string
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/[id]/return/route')
  const request = new NextRequest(`http://localhost/api/devices/${input.deviceId}/return`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      refundAmount: input.refundAmount,
      refundMethod: input.refundMethod,
      inputCurrency: 'UZS',
      note: input.note ?? 'Qurilma qaytarildi',
    }),
  })
  return POST(request, { params: Promise.resolve({ id: input.deviceId }) })
}

async function returnNasiyaRequest(input: {
  nasiyaId: string
  key: string
  refundAmount: number
  expectedReceipts: number
  expectedRemaining: number
  refundMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'
  note?: string
  inputCurrency?: 'UZS' | 'USD'
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/nasiya/[id]/return/route')
  const request = new NextRequest(`http://localhost/api/nasiya/${input.nasiyaId}/return`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      refundAmount: input.refundAmount,
      refundMethod: input.refundMethod,
      inputCurrency: input.inputCurrency ?? 'UZS',
      expectedReceiptsMinorUnits: input.expectedReceipts,
      expectedRemainingMinorUnits: input.expectedRemaining,
      note: input.note ?? 'Mijozning holati sababli Nasiya qaytarildi',
    }),
  })
  return POST(request, { params: Promise.resolve({ id: input.nasiyaId }) })
}

async function supplierPayablePaymentRequest(payableId: string, note: string) {
  const { NextRequest } = await import('next/server')
  const { PATCH } = await import('@/app/api/olib-sotdim/[id]/pay/route')
  return PATCH(new NextRequest(`http://localhost/api/olib-sotdim/${payableId}/pay`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentMethod: 'CASH', paidAt: '2026-07-13T08:00:00.000Z', note }),
  }), { params: Promise.resolve({ id: payableId }) })
}

async function cashSaleRequest(deviceId: string, phone: string) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/[id]/sell/route')
  return POST(new NextRequest(`http://localhost/api/devices/${deviceId}/sell`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      customerName: 'Lifecycle customer',
      customerPhone: phone,
      salePrice: 2_000_000,
      paymentMethod: 'CASH',
      paidFully: true,
      inputCurrency: 'UZS',
    }),
  }), { params: Promise.resolve({ id: deviceId }) })
}

async function payLaterSaleRequest(input: {
  deviceId: string
  phone: string
  key: string
  salePrice: number
  inputCurrency: 'UZS' | 'USD'
}) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/[id]/sell/route')
  return POST(new NextRequest(`http://localhost/api/devices/${input.deviceId}/sell`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.key },
    body: JSON.stringify({
      deviceId: input.deviceId,
      customerName: 'Zero paid later customer',
      customerPhone: input.phone,
      salePrice: input.salePrice,
      paidFully: false,
      amountPaid: 0,
      dueDate: '2026-08-15T00:00:00.000Z',
      inputCurrency: input.inputCurrency,
    }),
  }), { params: Promise.resolve({ id: input.deviceId }) })
}

async function createNasiyaRequest(deviceId: string, phone: string, shopId: string) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/[id]/nasiya/route')
  return POST(new NextRequest(`http://localhost/api/devices/${deviceId}/nasiya`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      customerName: 'Lifecycle nasiya customer',
      customerPhone: phone,
      passportPhotoUrl: `shops/${shopId}/passports/integration.jpg`,
      totalAmount: 2_000_000,
      downPayment: 500_000,
      months: 2,
      interestPercent: 0,
      startDate: '2026-08-01T00:00:00.000Z',
      paymentMethod: 'CASH',
      inputCurrency: 'UZS',
    }),
  }), { params: Promise.resolve({ id: deviceId }) })
}

async function createMonthlyAccountingExampleRequest(
  deviceId: string,
  phone: string,
  shopId: string,
) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/[id]/nasiya/route')
  return POST(new NextRequest(`http://localhost/api/devices/${deviceId}/nasiya`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      customerName: 'Monthly accounting customer',
      customerPhone: phone,
      passportPhotoUrl: `shops/${shopId}/passports/monthly-accounting.jpg`,
      totalAmount: 1_000,
      downPayment: 200,
      months: 4,
      interestPercent: 20,
      startDate: '2026-07-01T00:00:00.000Z',
      paymentMethod: 'CASH',
      inputCurrency: 'USD',
    }),
  }), { params: Promise.resolve({ id: deviceId }) })
}

async function restockDeviceRequest(deviceId: string) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('@/app/api/devices/[id]/restock/route')
  return POST(new NextRequest(`http://localhost/api/devices/${deviceId}/restock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'Legacy qaytarilgan qurilmani qayta omborga olish' }),
  }), { params: Promise.resolve({ id: deviceId }) })
}

beforeEach(async () => {
  authState.session = null
  await resetBusinessData()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('real-PostgreSQL route evidence', () => {
  it('creates default-deny staff through the real endpoint with Telegram off', async () => {
    const actor = await seedActor('staff_defaults')
    useShopAdmin(actor)

    const response = await createStaffRequest({
      name: 'Default deny staff',
      phone: '+998901010101',
      login: 'staff_default_deny',
      password: 'safe-password',
      isActive: false,
    })

    expect(response.status).toBe(201)
    const member = await prisma.shopAdmin.findUniqueOrThrow({
      where: { login: 'staff_default_deny' },
      include: { permissions: true },
    })
    expect(member).toMatchObject({
      shopId: actor.shop.id,
      isActive: false,
      legacyFullAccess: false,
      telegramNotificationsEnabled: false,
      telegramId: null,
      telegramVerifiedAt: null,
    })
    expect(member.permissions).toEqual([])
    expect(await prisma.log.count({
      where: { shopId: actor.shop.id, action: 'STAFF_CREATE', targetId: member.id },
    })).toBe(1)
  })

  it('lets STAFF_CREATE create only a default-deny member and blocks delegated escalation', async () => {
    const actor = await seedActor('staff_delegated_create')
    const manager = await seedStaff(actor, 'delegated_create', ['STAFF_CREATE'])
    useShopAdmin(manager)

    const rosterResponse = await staffListRequest()
    expect(rosterResponse.status).toBe(200)
    expect((await rosterResponse.json()).data).toEqual([])

    const escalation = await createStaffRequest({
      name: 'Escalation attempt',
      phone: '+998901010102',
      login: 'staff_escalation_attempt',
      password: 'safe-password',
      permissionCodes: ['SALE_RETURN_REFUND'],
      telegramNotificationsEnabled: true,
    })
    expect(escalation.status).toBe(403)
    expect(await prisma.shopAdmin.count({ where: { login: 'staff_escalation_attempt' } })).toBe(0)

    const allowed = await createStaffRequest({
      name: 'Delegated new staff',
      phone: '+998901010103',
      login: 'staff_delegated_default',
      password: 'safe-password',
    })
    expect(allowed.status).toBe(201)
    const member = await prisma.shopAdmin.findUniqueOrThrow({
      where: { login: 'staff_delegated_default' },
      include: { permissions: true },
    })
    expect(member.telegramNotificationsEnabled).toBe(false)
    expect(member.permissions).toEqual([])
  })

  it('projects only fields needed by an exact staff-management capability', async () => {
    const actor = await seedActor('staff_projection')
    const target = await seedStaff(actor, 'projection_target', ['SALE_RETURN_REFUND'])
    const editor = await seedStaff(actor, 'profile_editor', ['STAFF_EDIT_PROFILE'])
    useShopAdmin(editor)

    const response = await staffListRequest()
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Array<Record<string, unknown>> }
    const projected = payload.data.find((member) => member.id === target.admin.id)
    expect(projected).toMatchObject({
      id: target.admin.id,
      name: target.admin.name,
      login: target.admin.login,
      phone: target.admin.phone,
      isActive: null,
      telegramId: null,
      telegramVerifiedAt: null,
      telegramNotificationsEnabled: null,
      logsViewEnabled: null,
      permissionVersion: null,
      permissionCodes: null,
    })
  })

  it('atomically replaces exact grants and revokes the target session', async () => {
    const actor = await seedActor('staff_permission_update')
    const target = await seedStaff(actor, 'permission_target', ['INVENTORY_VIEW'])
    useShopAdmin(actor)

    const response = await updateStaffRequest(target.admin.id, {
      permissionCodes: ['SALE_RETURN_REFUND'],
      logsViewEnabled: false,
      telegramNotificationsEnabled: true,
      note: 'Exact permission update integration proof',
    })
    expect(response.status).toBe(200)

    const [member, permissions, session] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: target.admin.id } }),
      prisma.shopMemberPermission.findMany({
        where: { shopAdminId: target.admin.id },
        select: { permissionCode: true },
      }),
      prisma.authSession.findUniqueOrThrow({ where: { id: target.authSession.id } }),
    ])
    expect(permissions).toEqual([{ permissionCode: 'SALE_RETURN_REFUND' }])
    expect(member.permissionVersion).toBe(target.admin.permissionVersion + 1)
    expect(member.sessionVersion).toBe(target.admin.sessionVersion + 1)
    expect(member.telegramNotificationsEnabled).toBe(true)
    expect(session.revokedAt).not.toBeNull()

    useShopAdmin(target)
    expect((await deviceListRequest()).status).toBe(401)
  })

  it('seeds built-ins, creates Shogirt, and assigns its exact materialized grants', async () => {
    const actor = await seedActor('staff_role_assign')
    await prisma.$transaction((tx) => seedBuiltInStaffRoles(tx, actor.shop.id))
    useShopAdmin(actor)

    const roleResponse = await createStaffRoleRequest({
      name: 'Shogirt',
      description: 'Usta nazoratidagi yordamchi',
      permissionCodes: ['INVENTORY_VIEW', 'DEVICE_CREATE'],
      logsViewEnabled: false,
    })
    expect(roleResponse.status).toBe(201)
    const rolePayload = await roleResponse.json() as { data: { id: string; version: number } }

    const createResponse = await createStaffRequest({
      name: 'Yangi shogirt',
      phone: '+998901010111',
      login: 'staff_shogirt_exact',
      password: 'safe-password',
      roleId: rolePayload.data.id,
    })
    expect(createResponse.status).toBe(201)

    const member = await prisma.shopAdmin.findUniqueOrThrow({
      where: { login: 'staff_shogirt_exact' },
      include: { permissions: { orderBy: { permissionCode: 'asc' } }, staffRole: true },
    })
    expect(member.staffRole).toMatchObject({ id: rolePayload.data.id, name: 'Shogirt', kind: 'CUSTOM' })
    expect(member.roleVersionApplied).toBe(1)
    expect(member.permissions.map((permission) => permission.permissionCode)).toEqual(['DEVICE_CREATE', 'INVENTORY_VIEW'])

    const listResponse = await staffRoleListRequest()
    expect(listResponse.status).toBe(200)
    const listPayload = await listResponse.json() as { data: Array<{ name: string; kind: string }> }
    expect(listPayload.data).toHaveLength(6)
    expect(listPayload.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Kassir', kind: 'BUILT_IN' }),
      expect.objectContaining({ name: 'Shogirt', kind: 'CUSTOM' }),
    ]))

    const builtIn = await prisma.shopStaffRole.findFirstOrThrow({
      where: { shopId: actor.shop.id, kind: 'BUILT_IN' },
    })
    expect((await updateStaffRoleRequest(builtIn.id, {
      version: builtIn.version,
      name: 'O‘zgartirishga urinish',
      note: 'Standart rol himoyasi',
    })).status).toBe(409)
  })

  it('propagates role permission edits, revokes assigned sessions, and keeps name-only edits live', async () => {
    const actor = await seedActor('staff_role_propagate')
    useShopAdmin(actor)
    const createRole = await createStaffRoleRequest({
      name: 'Yordamchi',
      permissionCodes: ['SALE_VIEW'],
    })
    const role = (await createRole.json() as { data: { id: string; version: number } }).data
    const target = await seedStaff(actor, 'role_propagation_target', [])

    expect((await updateStaffRequest(target.admin.id, {
      roleId: role.id,
      note: 'Yordamchi lavozimi biriktirildi',
    })).status).toBe(200)
    const assigned = await prisma.shopAdmin.findUniqueOrThrow({ where: { id: target.admin.id } })
    const freshSession = await prisma.authSession.create({
      data: {
        id: 'role-propagation-fresh-session',
        actorId: assigned.id,
        actorType: 'SHOP_ADMIN',
        shopId: actor.shop.id,
        sessionVersion: assigned.sessionVersion,
        packageVersionId: actor.packageVersion.id,
        policy: 'IDLE_10_MINUTES',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    })

    const permissionUpdate = await updateStaffRoleRequest(role.id, {
      version: 1,
      permissionCodes: ['INVENTORY_VIEW', 'DEVICE_CREATE'],
      logsViewEnabled: false,
      note: 'Lavozim vakolatlari yangilandi',
    })
    expect(permissionUpdate.status).toBe(200)
    const [afterPermissionUpdate, grants, revokedSession] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: target.admin.id } }),
      prisma.shopMemberPermission.findMany({
        where: { shopAdminId: target.admin.id },
        select: { permissionCode: true },
        orderBy: { permissionCode: 'asc' },
      }),
      prisma.authSession.findUniqueOrThrow({ where: { id: freshSession.id } }),
    ])
    expect(grants.map((grant) => grant.permissionCode)).toEqual(['DEVICE_CREATE', 'INVENTORY_VIEW'])
    expect(afterPermissionUpdate.permissionVersion).toBe(assigned.permissionVersion + 1)
    expect(afterPermissionUpdate.sessionVersion).toBe(assigned.sessionVersion + 1)
    expect(afterPermissionUpdate.roleVersionApplied).toBe(2)
    expect(revokedSession.revokedAt).not.toBeNull()

    const nameOnlySession = await prisma.authSession.create({
      data: {
        id: 'role-propagation-name-session',
        actorId: afterPermissionUpdate.id,
        actorType: 'SHOP_ADMIN',
        shopId: actor.shop.id,
        sessionVersion: afterPermissionUpdate.sessionVersion,
        packageVersionId: actor.packageVersion.id,
        policy: 'IDLE_10_MINUTES',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    })
    const nameUpdate = await updateStaffRoleRequest(role.id, {
      version: 2,
      name: 'Katta yordamchi',
      permissionCodes: ['INVENTORY_VIEW', 'DEVICE_CREATE'],
      logsViewEnabled: false,
      note: 'Lavozim nomi aniqlashtirildi',
    })
    expect(nameUpdate.status).toBe(200)
    const [afterNameUpdate, liveNameSession] = await Promise.all([
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: target.admin.id } }),
      prisma.authSession.findUniqueOrThrow({ where: { id: nameOnlySession.id } }),
    ])
    expect(afterNameUpdate.permissionVersion).toBe(afterPermissionUpdate.permissionVersion)
    expect(afterNameUpdate.sessionVersion).toBe(afterPermissionUpdate.sessionVersion)
    expect(afterNameUpdate.roleVersionApplied).toBe(3)
    expect(liveNameSession.revokedAt).toBeNull()
  })

  it('enforces tenant isolation, owner-only role CRUD, and delegated assignment limits', async () => {
    const actor = await seedActor('staff_role_owner')
    useShopAdmin(actor)
    const routineRoleResponse = await createStaffRoleRequest({ name: 'Sotuvchi', permissionCodes: ['SALE_VIEW'] })
    const restrictedRoleResponse = await createStaffRoleRequest({ name: 'Qaytaruvchi', permissionCodes: ['SALE_RETURN_REFUND'] })
    const routineRole = (await routineRoleResponse.json() as { data: { id: string } }).data
    const restrictedRole = (await restrictedRoleResponse.json() as { data: { id: string } }).data
    const manager = await seedStaff(actor, 'role_manager', ['STAFF_PERMISSION_MANAGE'])
    const target = await seedStaff(actor, 'role_manager_target', [])
    const sensitiveTarget = await seedStaff(actor, 'role_manager_sensitive_target', [])
    expect((await updateStaffRequest(sensitiveTarget.admin.id, {
      roleId: restrictedRole.id,
      note: 'Egasi cheklangan lavozimni biriktirdi',
    })).status).toBe(200)
    useShopAdmin(manager)

    expect((await createStaffRoleRequest({ name: 'Noqonuniy', permissionCodes: [] })).status).toBe(403)
    expect((await updateStaffRequest(target.admin.id, {
      roleId: routineRole.id,
      note: 'Oddiy lavozim biriktirildi',
    })).status).toBe(200)
    expect((await updateStaffRequest(target.admin.id, {
      roleId: restrictedRole.id,
      note: 'Cheklangan lavozimga urinish',
    })).status).toBe(403)
    expect((await updateStaffRequest(sensitiveTarget.admin.id, {
      roleId: routineRole.id,
      note: 'Cheklangan lavozimni almashtirishga urinish',
    })).status).toBe(403)

    const otherActor = await seedActor('staff_role_other_tenant')
    useShopAdmin(otherActor)
    expect((await updateStaffRoleRequest(routineRole.id, {
      version: 1,
      name: 'Begona tenant',
      note: 'Tenant chegarasi tekshiruvi',
    })).status).toBe(404)
    expect((await updateStaffRequest(target.admin.id, {
      roleId: routineRole.id,
      note: 'Begona xodimga urinish',
    })).status).toBe(404)
  })

  it('archives custom roles without stripping assigned grants or allowing new assignment', async () => {
    const actor = await seedActor('staff_role_archive')
    useShopAdmin(actor)
    const createdRole = await createStaffRoleRequest({ name: 'Vaqtinchalik', permissionCodes: ['CUSTOMER_VIEW'] })
    const role = (await createdRole.json() as { data: { id: string; version: number } }).data
    const target = await seedStaff(actor, 'role_archive_target', [])
    expect((await updateStaffRequest(target.admin.id, {
      roleId: role.id,
      note: 'Vaqtinchalik lavozim berildi',
    })).status).toBe(200)

    expect((await archiveStaffRoleRequest(role.id, {
      version: role.version,
      note: 'Lavozim endi ishlatilmaydi',
    })).status).toBe(200)
    const [archived, member, grants] = await Promise.all([
      prisma.shopStaffRole.findUniqueOrThrow({ where: { id: role.id } }),
      prisma.shopAdmin.findUniqueOrThrow({ where: { id: target.admin.id } }),
      prisma.shopMemberPermission.findMany({ where: { shopAdminId: target.admin.id } }),
    ])
    expect(archived.isArchived).toBe(true)
    expect(member.staffRoleId).toBe(role.id)
    expect(member.roleVersionApplied).toBe(archived.version)
    expect(grants.map((grant) => grant.permissionCode)).toEqual(['CUSTOMER_VIEW'])

    expect((await createStaffRequest({
      name: 'Arxiv rolga urinish',
      phone: '+998901010119',
      login: 'staff_archived_role_attempt',
      password: 'safe-password',
      roleId: role.id,
    })).status).toBe(400)
  })

  it('enforces live staff permissions on real routes while preserving allowed inventory access', async () => {
    const actor = await seedActor('staff_matrix')
    const staff = await seedStaff(actor, 'staff_matrix', ['INVENTORY_VIEW'])
    useShopAdmin(staff)

    expect((await deviceListRequest()).status).toBe(200)
    expect((await shopStatsRequest()).status).toBe(403)

    await prisma.shopMemberPermission.deleteMany({ where: { shopAdminId: staff.admin.id } })
    await prisma.shopAdmin.update({ where: { id: staff.admin.id }, data: { permissionVersion: { increment: 1 } } })
    expect((await deviceListRequest()).status).toBe(403)
  })

  it('returns a payment-only Nasiya projection without trust, passport, reminder, or import context', async () => {
    const actor = await seedActor('payment_projection')
    const contract = await seedNasiya(actor, 'payment_projection', 5_000)
    const collector = await seedStaff(actor, 'payment_projection', ['NASIYA_PAYMENT_RECEIVE'])
    useShopAdmin(collector)

    const response = await nasiyaDetailRequest(contract.nasiya.id)
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Record<string, unknown> & {
      customer: Record<string, unknown>
      schedules: unknown[]
      payments: unknown[]
    } }
    expect(payload.data.customer).toMatchObject({
      id: contract.customer.id,
      name: contract.customer.name,
      phone: contract.customer.phone,
    })
    expect(payload.data.schedules).toHaveLength(1)
    expect(payload.data.payments).toEqual([])
    for (const field of [
      'customerTrust', 'paymentScore', 'reminderEnabled', 'note', 'isImported',
      'importSource', 'importedAt', 'originalSaleDate', 'originalTotalAmount',
      'alreadyPaidBeforeImport', 'remainingAtImport', 'importNote',
    ]) {
      expect(payload.data).not.toHaveProperty(field)
    }
    expect(payload.data.customer).not.toHaveProperty('hasPassportPhoto')
    expect(payload.data.customer).not.toHaveProperty('passportPhotoUrl')
    expect(payload.data.customer).not.toHaveProperty('trustOverride')
  })

  it('preserves the original Sale and receipts while posting an allocated return event', async () => {
    const actor = await seedActor('immutable_return')
    useShopAdmin(actor)
    await prisma.shopAdmin.update({
      where: { id: actor.admin.id },
      data: { telegramId: '800000001', telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z') },
    })
    await prisma.shopAdmin.createMany({ data: [
      {
        shopId: actor.shop.id,
        name: 'Inactive return recipient',
        phone: '+998901111131',
        login: 'inactive_return_recipient',
        passwordHash: 'audit-only',
        telegramId: '800000002',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        isActive: false,
      },
      {
        shopId: actor.shop.id,
        name: 'Unverified return recipient',
        phone: '+998901111132',
        login: 'unverified_return_recipient',
        passwordHash: 'audit-only',
        telegramId: '800000003',
      },
    ] })
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Return customer', phone: '+998901234567', normalizedPhone: '998901234567' },
    })
    const device = await prisma.device.create({
      data: { shopId: actor.shop.id, model: 'Return phone', purchasePrice: 600, imei: 'RETURN-ROUTE-1', addedBy: actor.admin.id, status: 'SOLD_DEBT' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 700,
        remainingAmount: 300,
        contractSalePrice: 1_000,
        contractAmountPaid: 700,
        contractRemainingAmount: 300,
        paidFully: false,
        paymentMethod: 'CASH',
        createdBy: actor.admin.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: actor.shop.id,
        saleId: sale.id,
        amount: 700,
        appliedAmountInContractCurrency: 700,
        paymentMethod: 'CASH',
        createdBy: actor.admin.id,
      },
    })

    const response = await returnDeviceRequest({
      deviceId: device.id,
      key: 'immutable-return-route-key',
      refundAmount: 500,
      refundMethod: 'CASH',
    })
    expect(response.status).toBe(200)

    const [storedSale, storedDevice, returned] = await Promise.all([
      prisma.sale.findUniqueOrThrow({ where: { id: sale.id } }),
      prisma.device.findUniqueOrThrow({ where: { id: device.id } }),
      prisma.deviceReturn.findFirstOrThrow({
        where: { saleId: sale.id },
        include: { refundAllocations: true },
      }),
    ])
    expect(storedSale).toMatchObject({ deletedAt: null })
    expect(storedSale.returnedAt).not.toBeNull()
    expect(Number(storedSale.salePrice)).toBe(1_000)
    expect(Number(storedSale.contractRemainingAmount)).toBe(300)
    expect(storedDevice.status).toBe('IN_STOCK')
    expect(returned.refundAllocations).toHaveLength(1)
    expect(Number(returned.contractReceiptsAtReturn)).toBe(700)
    expect(Number(returned.contractRefundAmount)).toBe(500)
    expect(Number(returned.contractRetainedAmount)).toBe(200)
    expect(Number(returned.contractCancelledDebt)).toBe(300)
    expect(Number(returned.revenueReversalAmountUzs)).toBe(1_000)
    expect(Number(returned.inventoryCostRecoveryUzs)).toBe(600)

    const replay = await returnDeviceRequest({
      deviceId: device.id,
      key: 'immutable-return-route-key',
      refundAmount: 500,
      refundMethod: 'CASH',
    })
    expect(replay.status).toBe(200)
    expect(await prisma.deviceReturn.count({ where: { saleId: sale.id } })).toBe(1)
    expect(await prisma.notification.findMany({
      where: { shopId: actor.shop.id, type: 'RETURN', relatedId: returned.id },
      select: { telegramId: true },
    })).toEqual([{ telegramId: '800000001' }])
  })

  it('returns a Nasiya device, defaults the refund contract safely, and removes all future money from live stats', async () => {
    const actor = await seedActor('nasiya_return')
    useShopAdmin(actor)
    await Promise.all([
      prisma.shop.update({
        where: { id: actor.shop.id },
        data: { telegramNotificationsEnabled: true },
      }),
      prisma.shopAdmin.update({
        where: { id: actor.admin.id },
        data: {
          telegramId: '830000001',
          telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
          telegramNotificationsEnabled: true,
        },
      }),
    ])
    const contract = await seedReturnableNasiya(actor, 'nasiya_return')
    const payable = await prisma.supplierPayable.create({
      data: {
        shopId: actor.shop.id,
        deviceId: contract.device.id,
        origin: 'DEVICE_PURCHASE',
        supplierName: 'Nasiya return supplier',
        supplierPhone: '+998901414141',
        amount: 400,
        contractAmount: 400,
        remainingAmount: 400,
        contractRemainingAmount: 400,
        ledgerVersion: 2,
        dueDate: new Date('2026-08-15T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })
    await prisma.notification.createMany({
      data: [
        {
          shopId: actor.shop.id,
          type: 'REMINDER',
          message: 'Parent Nasiya reminder',
          telegramId: '830000001',
          recipientShopAdminId: actor.admin.id,
          status: 'PENDING',
          scheduledAt: new Date('2026-07-25T08:00:00.000Z'),
          relatedId: contract.nasiya.id,
          relatedType: 'Nasiya',
        },
        {
          shopId: actor.shop.id,
          type: 'OVERDUE',
          message: 'Open schedule reminder',
          telegramId: '830000001',
          recipientShopAdminId: actor.admin.id,
          status: 'FAILED',
          scheduledAt: new Date('2026-07-25T08:00:00.000Z'),
          relatedId: contract.openSchedules[0].id,
          relatedType: 'NasiyaSchedule',
        },
      ],
    })
    const beforeAccounting = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-06-30T19:00:00.000Z'),
      monthEnd: new Date('2026-07-31T19:00:00.000Z'),
      adminId: null,
    })
    expect(beforeAccounting).toMatchObject({
      actualProfitUzs: 75,
      expectedProfitUzs: 0,
    })
    const beforeFutureAccounting = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-07-31T19:00:00.000Z'),
      monthEnd: new Date('2026-08-31T19:00:00.000Z'),
      adminId: null,
    })
    expect(beforeFutureAccounting).toMatchObject({
      expectedProfitUzs: 175,
      expectedInterestUzs: 35,
    })

    const response = await returnNasiyaRequest({
      nasiyaId: contract.nasiya.id,
      key: 'nasiya-immutable-return-key',
      refundAmount: 100,
      refundMethod: 'CASH',
      expectedReceipts: 250,
      expectedRemaining: 850,
      note: 'Mijoz qolgan oylarni to‘lay olmasligini tushuntirdi',
    })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)

    const [
      nasiya,
      schedules,
      payments,
      returned,
      storedPayable,
      reminders,
      returnLogs,
      afterAccounting,
      afterFutureAccounting,
      customerProfile,
      customerNasiyaHistory,
      customerReturnHistory,
      rangeReport,
    ] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findMany({ where: { nasiyaId: contract.nasiya.id }, orderBy: { monthNumber: 'asc' } }),
      prisma.nasiyaPayment.findMany({ where: { nasiyaId: contract.nasiya.id }, orderBy: { paidAt: 'asc' } }),
      prisma.deviceReturn.findFirstOrThrow({
        where: { nasiyaId: contract.nasiya.id },
        include: { refundAllocations: true, profitReversal: true },
      }),
      prisma.supplierPayable.findUniqueOrThrow({ where: { id: payable.id } }),
      prisma.notification.findMany({
        where: {
          shopId: actor.shop.id,
          OR: [
            { relatedType: 'Nasiya', relatedId: contract.nasiya.id },
            { relatedType: 'NasiyaSchedule', relatedId: { in: contract.openSchedules.map(({ id }) => id) } },
          ],
        },
      }),
      prisma.log.findMany({ where: { targetType: 'Nasiya', targetId: contract.nasiya.id, action: 'RETURN' } }),
      getShopMonthlyAccountingAggregate({
        shopId: actor.shop.id,
        monthStart: new Date('2026-06-30T19:00:00.000Z'),
        monthEnd: new Date('2026-07-31T19:00:00.000Z'),
        adminId: null,
      }),
      getShopMonthlyAccountingAggregate({
        shopId: actor.shop.id,
        monthStart: new Date('2026-07-31T19:00:00.000Z'),
        monthEnd: new Date('2026-08-31T19:00:00.000Z'),
        adminId: null,
      }),
      getCustomerProfileOverview({
        shopId: actor.shop.id,
        customerId: contract.customer.id,
        now: new Date('2026-07-22T10:00:00.000Z'),
        visibility: { includeOwnerFinancials: true },
      }),
      getCustomerProfileHistory({
        shopId: actor.shop.id,
        customerId: contract.customer.id,
        section: 'nasiya',
        page: 1,
      }),
      getCustomerProfileHistory({
        shopId: actor.shop.id,
        customerId: contract.customer.id,
        section: 'returns',
        page: 1,
      }),
      getShopRangeReport({
        shopId: actor.shop.id,
        range: resolveReportRange({
          preset: 'custom',
          startMonth: '2026-07',
          endMonth: '2026-08',
          defaultEndMonth: '2026-08',
        }),
        adminId: null,
      }),
    ])
    expect(nasiya.status).toBe('CANCELLED')
    expect(nasiya.returnedAt).not.toBeNull()
    expect(nasiya.returnedBy).toBe(actor.admin.id)
    expect(nasiya.reminderEnabled).toBe(false)
    expect(nasiya.earlyReminderEnabled).toBe(false)
    expect(Number(nasiya.contractPaidAmount)).toBe(150)
    expect(Number(nasiya.contractRemainingAmount)).toBe(850)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: contract.device.id } })).status).toBe('IN_STOCK')
    expect(schedules.map(({ status }) => status)).toEqual(['PAID', 'CANCELLED', 'CANCELLED'])
    expect(schedules.map(({ contractRemainingAmount }) => Number(contractRemainingAmount))).toEqual([0, 350, 500])
    expect(payments).toHaveLength(2)
    expect(payments.map(({ amount }) => Number(amount))).toEqual([100, 150])
    expect(returned).toMatchObject({
      ledgerVersion: 2,
      contractCurrency: 'UZS',
      refundMethod: 'CASH',
      note: 'Mijoz qolgan oylarni to‘lay olmasligini tushuntirdi',
    })
    expect(Number(returned.contractReceiptsAtReturn)).toBe(250)
    expect(Number(returned.contractRefundAmount)).toBe(100)
    expect(Number(returned.contractRetainedAmount)).toBe(150)
    expect(Number(returned.contractCancelledDebt)).toBe(850)
    expect(Number(returned.retainedValueAmountUzs)).toBe(150)
    expect(returned.refundAllocations).toHaveLength(1)
    expect(returned.profitReversal).toMatchObject({ nasiyaId: contract.nasiya.id })
    expect(Number(returned.profitReversal?.recognizedMarginAmountUzs)).toBe(60)
    expect(Number(returned.profitReversal?.recognizedInterestAmountUzs)).toBe(15)
    expect(storedPayable).toMatchObject({ status: 'PENDING', reminderEnabled: true })
    expect(Number(storedPayable.contractRemainingAmount)).toBe(400)
    expect(reminders).toHaveLength(2)
    expect(reminders.every(({ status }) => status === 'CANCELLED')).toBe(true)
    expect(returnLogs).toHaveLength(1)
    expect(afterAccounting).toMatchObject({
      actualProfitUzs: 150,
      expectedProfitUzs: 0,
      expectedInterestUzs: 0,
      nasiyaInterestReceivedUzs: 0,
    })
    expect(afterFutureAccounting).toMatchObject({
      expectedProfitUzs: 0,
      expectedInterestUzs: 0,
    })
    expect(customerProfile).toMatchObject({
      counts: { activeNasiya: 0, completedNasiya: 0, returns: 1 },
      metrics: {
        cashCollected: { UZS: 250, USD: 0 },
        dueThisMonth: { UZS: 0, USD: 0 },
        overdue: { UZS: 0, USD: 0 },
        refunds: { UZS: 100, USD: 0 },
        accountingAccrualGrossProfitUzs: 150,
        nasiyaInterestUzs: 0,
      },
      trust: { tier: 'NEW' },
    })
    expect(customerNasiyaHistory.items).toEqual([
      expect.objectContaining({
        kind: 'nasiya',
        referenceId: contract.nasiya.id,
        status: 'RETURNED',
      }),
    ])
    expect(customerReturnHistory.items).toEqual([
      expect.objectContaining({
        kind: 'nasiya-return',
        referenceId: contract.nasiya.id,
        amount: 100,
        retainedAmount: 150,
        cancelledDebt: 850,
      }),
    ])
    expect(rangeReport.months).toEqual([
      expect.objectContaining({
        monthKey: '2026-07',
        cashCollected: { uzs: 250, usd: 0, complete: true },
        refunds: { uzs: 100, usd: 0 },
        grossProfitUzs: 150,
        interestProfitUzs: 0,
        expectedProfit: { uzs: 0, usd: 0 },
        nasiyaInterestExpected: { uzs: 0, usd: 0 },
        returnCount: 1,
      }),
      expect.objectContaining({
        monthKey: '2026-08',
        expectedProfit: { uzs: 0, usd: 0 },
        nasiyaInterestExpected: { uzs: 0, usd: 0 },
        supplierPayables: { uzs: 400, usd: 0, count: 1 },
      }),
    ])

    const { NextRequest } = await import('next/server')
    const { GET: exportEntity } = await import('@/app/api/export/[entity]/route')
    const [returnsExport, nasiyaExport] = await Promise.all([
      exportEntity(new NextRequest('http://localhost/api/export/returns?format=csv'), {
        params: Promise.resolve({ entity: 'returns' }),
      }),
      exportEntity(new NextRequest('http://localhost/api/export/nasiya?format=csv'), {
        params: Promise.resolve({ entity: 'nasiya' }),
      }),
    ])
    expect(returnsExport.status).toBe(200)
    expect(nasiyaExport.status).toBe(200)
    const [returnsCsv, nasiyaCsv] = await Promise.all([returnsExport.text(), nasiyaExport.text()])
    expect(returnsCsv).toContain('"returnId","saleId","nasiyaId"')
    expect(returnsCsv).toContain('"contractRefundAmount","contractRetainedAmount","contractCancelledDebt"')
    expect(returnsCsv).toContain('"note","operatorId","createdAt"')
    expect(returnsCsv).toContain(contract.nasiya.id)
    expect(returnsCsv).toContain(actor.admin.id)
    expect(returnsCsv).toContain('Mijoz qolgan oylarni to‘lay olmasligini tushuntirdi')
    expect(nasiyaCsv).toContain('Qaytarilgan')

    const replay = await returnNasiyaRequest({
      nasiyaId: contract.nasiya.id,
      key: 'nasiya-immutable-return-key',
      refundAmount: 100,
      refundMethod: 'CASH',
      expectedReceipts: 250,
      expectedRemaining: 850,
      note: 'Mijoz qolgan oylarni to‘lay olmasligini tushuntirdi',
    })
    expect(replay.status).toBe(200)
    expect((await replay.json()).data.duplicate).toBe(true)
    expect(await prisma.deviceReturn.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(1)
    expect(await prisma.notification.findMany({
      where: { shopId: actor.shop.id, type: 'RETURN', relatedId: returned.id },
      select: { telegramId: true },
    })).toEqual([{ telegramId: '830000001' }])
  })

  it('keeps Nasiya return behind its exact staff capability and never reuses the Sale return grant', async () => {
    const actor = await seedActor('nasiya_return_staff')
    const deniedContract = await seedReturnableNasiya(actor, 'nasiya_return_staff_denied')
    const saleReturner = await seedStaff(actor, 'nasiya_return_sale_only', ['SALE_RETURN_REFUND'])
    useShopAdmin(saleReturner)

    expect((await returnNasiyaRequest({
      nasiyaId: deniedContract.nasiya.id,
      key: 'nasiya-return-sale-only-denied',
      refundAmount: 100,
      refundMethod: 'CASH',
      expectedReceipts: 250,
      expectedRemaining: 850,
    })).status).toBe(403)
    expect(await prisma.deviceReturn.count({ where: { nasiyaId: deniedContract.nasiya.id } })).toBe(0)

    const allowedContract = await seedReturnableNasiya(actor, 'nasiya_return_staff_allowed')
    const nasiyaReturner = await seedStaff(actor, 'nasiya_return_exact', ['NASIYA_RETURN_REFUND'])
    useShopAdmin(nasiyaReturner)
    const detail = await nasiyaDetailRequest(allowedContract.nasiya.id)
    expect(detail.status).toBe(200)
    expect((await detail.json() as { data: { returnQuote: { defaultRefund: { minorUnits: number } } } }).data.returnQuote.defaultRefund.minorUnits).toBe(100)

    const allowed = await returnNasiyaRequest({
      nasiyaId: allowedContract.nasiya.id,
      key: 'nasiya-return-exact-allowed',
      refundAmount: 75,
      refundMethod: 'CASH',
      expectedReceipts: 250,
      expectedRemaining: 850,
    })
    expect(allowed.status, JSON.stringify(await allowed.clone().json())).toBe(200)
    const returned = await prisma.deviceReturn.findFirstOrThrow({
      where: { nasiyaId: allowedContract.nasiya.id },
    })
    expect(returned.createdBy).toBe(nasiyaReturner.admin.id)
    expect(Number(returned.contractRefundAmount)).toBe(75)
    expect(Number(returned.contractRetainedAmount)).toBe(175)
  })

  it('accepts both a full receipt refund and an explicit zero refund', async () => {
    const actor = await seedActor('nasiya_return_bounds')
    useShopAdmin(actor)
    const full = await seedReturnableNasiya(actor, 'nasiya_return_full')
    const zero = await seedReturnableNasiya(actor, 'nasiya_return_zero')

    const fullResponse = await returnNasiyaRequest({
      nasiyaId: full.nasiya.id,
      key: 'nasiya-return-full-receipts',
      refundAmount: 250,
      refundMethod: 'CASH',
      expectedReceipts: 250,
      expectedRemaining: 850,
    })
    const zeroResponse = await returnNasiyaRequest({
      nasiyaId: zero.nasiya.id,
      key: 'nasiya-return-zero-refund',
      refundAmount: 0,
      expectedReceipts: 250,
      expectedRemaining: 850,
    })
    expect(fullResponse.status, JSON.stringify(await fullResponse.clone().json())).toBe(200)
    expect(zeroResponse.status, JSON.stringify(await zeroResponse.clone().json())).toBe(200)

    const [fullReturn, zeroReturn] = await Promise.all([
      prisma.deviceReturn.findFirstOrThrow({
        where: { nasiyaId: full.nasiya.id },
        include: { refundAllocations: true },
      }),
      prisma.deviceReturn.findFirstOrThrow({
        where: { nasiyaId: zero.nasiya.id },
        include: { refundAllocations: true },
      }),
    ])
    expect(Number(fullReturn.contractRefundAmount)).toBe(250)
    expect(Number(fullReturn.contractRetainedAmount)).toBe(0)
    expect(fullReturn.refundAllocations).toHaveLength(2)
    expect(Number(zeroReturn.contractRefundAmount)).toBe(0)
    expect(Number(zeroReturn.contractRetainedAmount)).toBe(250)
    expect(zeroReturn.refundMethod).toBeNull()
    expect(zeroReturn.refundAllocations).toHaveLength(0)
  })

  it('freezes a USD Nasiya refund at the current governed rate while preserving native contract values', async () => {
    const actor = await seedActor('nasiya_return_usd')
    useShopAdmin(actor)
    await prisma.currencyRate.create({
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'UZS',
        rate: 13_000,
        source: 'CBU',
        effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
        fetchedAt: new Date(),
      },
    })
    const contract = await seedUsdSettlementNasiya(actor, 'nasiya_return_usd')

    const response = await returnNasiyaRequest({
      nasiyaId: contract.nasiya.id,
      key: 'nasiya-return-usd-current-fx',
      refundAmount: 20,
      refundMethod: 'CARD',
      inputCurrency: 'USD',
      expectedReceipts: 6_000,
      expectedRemaining: 6_000,
    })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)

    const returned = await prisma.deviceReturn.findFirstOrThrow({
      where: { nasiyaId: contract.nasiya.id },
      include: { refundAllocations: true },
    })
    expect(returned.contractCurrency).toBe('USD')
    expect(Number(returned.contractReceiptsAtReturn)).toBe(60)
    expect(Number(returned.contractRefundAmount)).toBe(20)
    expect(Number(returned.contractRetainedAmount)).toBe(40)
    expect(Number(returned.contractCancelledDebt)).toBe(60)
    expect(Number(returned.refundExchangeRateAtCreation)).toBe(13_000)
    expect(Number(returned.refundAmount)).toBe(260_000)
    expect(Number(returned.retainedValueAmountUzs)).toBe(460_000)
    expect(returned.refundAllocations).toHaveLength(1)
    expect(Number(returned.refundAllocations[0].contractAmount)).toBe(20)
    expect(Number(returned.refundAllocations[0].amountUzs)).toBe(260_000)
  })

  it('returns an already early-settled Nasiya without rewriting its completed settlement history', async () => {
    const actor = await seedActor('nasiya_return_settled')
    useShopAdmin(actor)
    const contract = await seedSettlementNasiya(actor, 'nasiya_return_settled')
    const settled = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'nasiya-return-prior-settlement',
      reason: 'Oldindan yopish kelishuvi',
    })
    expect(settled.status, JSON.stringify(await settled.clone().json())).toBe(200)

    const response = await returnNasiyaRequest({
      nasiyaId: contract.nasiya.id,
      key: 'nasiya-return-after-settlement',
      refundAmount: 0,
      expectedReceipts: 1_100,
      expectedRemaining: 0,
    })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)

    const [nasiya, schedules, settlement, returned] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findMany({ where: { nasiyaId: contract.nasiya.id }, orderBy: { monthNumber: 'asc' } }),
      prisma.nasiyaSettlement.findUniqueOrThrow({ where: { nasiyaId: contract.nasiya.id } }),
      prisma.deviceReturn.findFirstOrThrow({ where: { nasiyaId: contract.nasiya.id } }),
    ])
    expect(nasiya.status).toBe('COMPLETED')
    expect(nasiya.returnedAt).not.toBeNull()
    expect(schedules.map(({ status }) => status)).toEqual(['PAID', 'SETTLED'])
    expect(settlement.mode).toBe('WAIVE_REMAINING_PROFIT')
    expect(Number(settlement.contractInterestWaivedAmount)).toBe(100)
    expect(Number(returned.contractReceiptsAtReturn)).toBe(1_100)
    expect(Number(returned.contractCancelledDebt)).toBe(0)
    expect(Number(returned.contractRetainedAmount)).toBe(1_100)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: contract.device.id } })).status).toBe('IN_STOCK')
  })

  it('blocks legacy or imported Nasiya return when immutable payment evidence is unverifiable', async () => {
    const actor = await seedActor('nasiya_return_legacy')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'nasiya_return_legacy', 1_000)
    await prisma.nasiya.update({
      where: { id: contract.nasiya.id },
      data: {
        isImported: true,
        importSource: 'MANUAL',
        importedAt: new Date('2026-07-01T00:00:00.000Z'),
        importedById: actor.admin.id,
        originalTotalAmount: 1_000,
        alreadyPaidBeforeImport: 0,
        remainingAtImport: 1_000,
        accountingReconstructionStatus: 'UNRECONSTRUCTABLE',
        accountingReconstructionReason: 'Historic payments cannot be verified',
      },
    })

    const detail = await nasiyaDetailRequest(contract.nasiya.id)
    expect(detail.status).toBe(200)
    const quote = (await detail.json() as { data: { returnQuote: { eligible: boolean; receiptEvidenceVerified: boolean } } }).data.returnQuote
    expect(quote).toMatchObject({ eligible: false, receiptEvidenceVerified: false })
    const response = await returnNasiyaRequest({
      nasiyaId: contract.nasiya.id,
      key: 'nasiya-return-unverified-legacy',
      refundAmount: 0,
      expectedReceipts: 0,
      expectedRemaining: 1_000,
    })
    expect(response.status).toBe(409)
    expect(await prisma.deviceReturn.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(0)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: contract.device.id } })).status).toBe('SOLD_NASIYA')
  })

  it('rejects a refund method that cannot be reconciled to original receipts', async () => {
    const actor = await seedActor('return_method')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Method customer', phone: '+998907654321', normalizedPhone: '998907654321' },
    })
    const device = await prisma.device.create({
      data: { shopId: actor.shop.id, model: 'Method phone', purchasePrice: 500, imei: 'RETURN-METHOD-1', addedBy: actor.admin.id, status: 'SOLD_CASH' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 1_000,
        contractSalePrice: 1_000,
        contractAmountPaid: 1_000,
        paymentMethod: 'CARD',
        createdBy: actor.admin.id,
      },
    })
    await prisma.salePayment.create({
      data: { shopId: actor.shop.id, saleId: sale.id, amount: 1_000, appliedAmountInContractCurrency: 1_000, paymentMethod: 'CARD', createdBy: actor.admin.id },
    })

    const response = await returnDeviceRequest({
      deviceId: device.id,
      key: 'return-method-mismatch-key',
      refundAmount: 100,
      refundMethod: 'CASH',
    })
    expect(response.status).toBe(400)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).status).toBe('SOLD_CASH')
    expect(await prisma.deviceReturn.count()).toBe(0)
  })

  it('records a zero-refund return without inventing a refund method or allocation', async () => {
    const actor = await seedActor('zero_refund')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: {
        shopId: actor.shop.id,
        name: 'Zero refund customer',
        phone: '+998907171717',
        normalizedPhone: '998907171717',
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Zero refund phone',
        purchasePrice: 500,
        imei: 'RETURN-ZERO-REFUND',
        addedBy: actor.admin.id,
        status: 'SOLD_DEBT',
      },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 700,
        remainingAmount: 300,
        contractSalePrice: 1_000,
        contractAmountPaid: 700,
        contractRemainingAmount: 300,
        paidFully: false,
        paymentMethod: 'CASH',
        createdBy: actor.admin.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: actor.shop.id,
        saleId: sale.id,
        amount: 700,
        appliedAmountInContractCurrency: 700,
        paymentMethod: 'CASH',
        createdBy: actor.admin.id,
      },
    })

    const response = await returnDeviceRequest({
      deviceId: device.id,
      key: 'zero-refund-return-key',
      refundAmount: 0,
    })
    expect(response.status).toBe(200)

    const returned = await prisma.deviceReturn.findFirstOrThrow({
      where: { saleId: sale.id },
      include: { refundAllocations: true },
    })
    expect(returned.refundMethod).toBeNull()
    expect(Number(returned.contractRefundAmount)).toBe(0)
    expect(Number(returned.contractReceiptsAtReturn)).toBe(700)
    expect(Number(returned.contractRetainedAmount)).toBe(700)
    expect(Number(returned.contractCancelledDebt)).toBe(300)
    expect(returned.refundAllocations).toHaveLength(0)
  })

  it('serializes a Nasiya return against a concurrent payment so exactly one quote wins', async () => {
    const actor = await seedActor('payment_return_race')
    useShopAdmin(actor)
    const contract = await seedReturnableNasiya(actor, 'payment_return_race')

    const [paymentResponse, returnResponse] = await Promise.all([
      nasiyaPaymentRequest({
        nasiyaId: contract.nasiya.id,
        scheduleId: contract.openSchedules[0].id,
        amount: 100,
        key: 'payment-return-race-payment',
      }),
      returnNasiyaRequest({
        nasiyaId: contract.nasiya.id,
        key: 'payment-return-race-return',
        refundAmount: 0,
        expectedReceipts: 250,
        expectedRemaining: 850,
      }),
    ])

    expect([200, 404, 409]).toContain(paymentResponse.status)
    expect([200, 409]).toContain(returnResponse.status)
    expect(Number(paymentResponse.status === 200) + Number(returnResponse.status === 200)).toBe(1)
    const [nasiya, returned, payments] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.deviceReturn.findFirst({ where: { nasiyaId: contract.nasiya.id } }),
      prisma.nasiyaPayment.findMany({ where: { nasiyaId: contract.nasiya.id } }),
    ])
    const racingPayment = payments.find(({ idempotencyKey }) => idempotencyKey === 'payment-return-race-payment')
    if (returnResponse.status === 200) {
      expect(nasiya.status).toBe('CANCELLED')
      expect(nasiya.returnedAt).not.toBeNull()
      expect(returned).not.toBeNull()
      expect(racingPayment).toBeUndefined()
      expect(payments).toHaveLength(2)
    } else {
      expect(nasiya.status).not.toBe('CANCELLED')
      expect(nasiya.returnedAt).toBeNull()
      expect(returned).toBeNull()
      expect(racingPayment).toBeDefined()
      expect(payments).toHaveLength(3)
      expect(Number(nasiya.contractRemainingAmount)).toBe(750)
    }
  })

  it('recognizes a fully paid cash Sale margin in full on its payment date', async () => {
    const actor = await seedActor('cash_monthly_profit')
    useShopAdmin(actor)
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Cash monthly profit',
        purchasePrice: 1_000_000,
        purchaseInputAmount: 1_000_000,
        purchaseAmountUzsSnapshot: 1_000_000,
        imei: 'CASH-MONTHLY-PROFIT',
        addedBy: actor.admin.id,
      },
    })

    const response = await cashSaleRequest(device.id, '+998901010202')
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201)
    const sale = await prisma.sale.findFirstOrThrow({
      where: { deviceId: device.id },
      include: { payments: true },
    })
    expect(sale.accountingReconstructionStatus).toBe('COMPLETE')
    expect(Number(sale.contractCostBasisAmount)).toBe(1_000_000)
    expect(Number(sale.contractMarginAmount)).toBe(1_000_000)
    expect(sale.payments).toHaveLength(1)
    expect(Number(sale.payments[0].principalAmountUzs)).toBe(1_000_000)
    expect(Number(sale.payments[0].marginAmountUzs)).toBe(1_000_000)

    const july = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-08-01T00:00:00.000Z'),
      adminId: actor.admin.id,
    })
    expect(july.saleMarginReceivedUzs).toBe(1_000_000)
    expect(july.actualProfitUzs).toBe(1_000_000)
  })

  it('creates an idempotent USD Pay Later sale with exactly zero paid and no fake payment', async () => {
    const actor = await seedActor('zero_paid_sale')
    useShopAdmin(actor)
    await prisma.currencyRate.create({
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'UZS',
        rate: 12_500,
        source: 'CBU',
        fetchedAt: new Date(),
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Zero paid USD phone',
        purchasePrice: 10_000_000,
        purchaseCurrency: 'USD',
        purchaseInputAmount: 800,
        purchaseExchangeRateAtCreation: 12_500,
        purchaseAmountUzsSnapshot: 10_000_000,
        imei: 'ZERO-PAID-USD-SALE',
        addedBy: actor.admin.id,
      },
    })
    const command = {
      deviceId: device.id,
      phone: '+998901010299',
      key: 'zero-paid-usd-sale-key',
      salePrice: 1_000,
      inputCurrency: 'USD' as const,
    }

    expect((await payLaterSaleRequest(command)).status).toBe(201)
    expect((await payLaterSaleRequest(command)).status).toBe(201)
    expect((await payLaterSaleRequest({ ...command, salePrice: 1_100 })).status).toBe(409)

    const sale = await prisma.sale.findFirstOrThrow({
      where: { deviceId: device.id },
      include: { payments: true },
    })
    expect(sale.paymentMethod).toBeNull()
    expect(sale.paidFully).toBe(false)
    expect(Number(sale.contractAmountPaid)).toBe(0)
    expect(Number(sale.contractRemainingAmount)).toBe(1_000)
    expect(sale.creationIdempotencyKey).toBe(command.key)
    expect(sale.creationCommandHash).toMatch(/^[a-f0-9]{64}$/)
    expect(sale.payments).toHaveLength(0)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).status).toBe('SOLD_DEBT')

    const accounting = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-08-01T00:00:00.000Z'),
      adminId: null,
    })
    expect(accounting.actualProfitUzs).toBe(0)
  })

  it('recognizes the $800/$1,000 Nasiya example only as installments are paid and attributes it to the collector', async () => {
    const actor = await seedActor('monthly_profit')
    useShopAdmin(actor)
    await prisma.currencyRate.create({
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'UZS',
        rate: 12_500,
        source: 'CBU',
        fetchedAt: new Date(),
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Monthly profit example',
        purchasePrice: 10_000_000,
        purchaseCurrency: 'USD',
        purchaseInputAmount: 800,
        purchaseExchangeRateAtCreation: 12_500,
        purchaseAmountUzsSnapshot: 10_000_000,
        imei: 'MONTHLY-PROFIT-EXAMPLE',
        addedBy: actor.admin.id,
      },
    })

    const createdResponse = await createMonthlyAccountingExampleRequest(
      device.id,
      '+998901234567',
      actor.shop.id,
    )
    expect(createdResponse.status, JSON.stringify(await createdResponse.clone().json())).toBe(201)

    const nasiya = await prisma.nasiya.findFirstOrThrow({
      where: { deviceId: device.id },
      include: {
        schedules: { orderBy: { monthNumber: 'asc' } },
        paymentAllocations: { orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }] },
      },
    })
    expect(nasiya.accountingReconstructionStatus).toBe('COMPLETE')
    expect(Number(nasiya.contractCostBasisAmount)).toBe(800)
    expect(Number(nasiya.contractMarginAmount)).toBe(200)
    expect(Number(nasiya.contractDownPaymentPrincipalAmount)).toBe(160)
    expect(Number(nasiya.contractDownPaymentMarginAmount)).toBe(40)
    expect(Number(nasiya.contractInterestAmount)).toBe(160)
    expect(nasiya.schedules).toHaveLength(4)
    for (const schedule of nasiya.schedules) {
      expect({
        expected: Number(schedule.contractExpectedAmount),
        principal: Number(schedule.contractPrincipalAmount),
        margin: Number(schedule.contractMarginAmount),
        interest: Number(schedule.contractInterestAmount),
      }).toEqual({ expected: 240, principal: 160, margin: 40, interest: 40 })
    }
    expect(nasiya.paymentAllocations).toHaveLength(1)
    expect(Number(nasiya.paymentAllocations[0].contractInterestAmount)).toBe(0)

    const july = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-08-01T00:00:00.000Z'),
      adminId: null,
    })
    expect(july.nasiyaMarginReceivedUzs).toBe(500_000)
    expect(july.nasiyaInterestReceivedUzs).toBe(0)
    expect(july.actualProfitUzs).toBe(500_000)
    expect(july.expectedProfitUsd).toBe(0)

    const augustBeforePayment = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-09-01T00:00:00.000Z'),
      adminId: null,
    })
    expect(augustBeforePayment.expectedProfitUsd).toBe(80)
    expect(augustBeforePayment.expectedInterestUsd).toBe(40)
    expect(augustBeforePayment.actualProfitUzs).toBe(0)

    const collector = await seedStaff(actor, 'monthly_profit_collector', ['NASIYA_PAYMENT_RECEIVE'])
    useShopAdmin(collector)
    const partialResponse = await nasiyaPaymentRequest({
      nasiyaId: nasiya.id,
      scheduleId: nasiya.schedules[0].id,
      amount: 120,
      inputCurrency: 'USD',
      date: '2026-08-10T08:00:00.000Z',
      key: 'monthly-profit-partial',
    })
    expect(partialResponse.status, JSON.stringify(await partialResponse.clone().json())).toBe(200)

    const augustForCollector = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-09-01T00:00:00.000Z'),
      adminId: collector.admin.id,
    })
    expect(augustForCollector.nasiyaMarginReceivedUzs).toBe(250_000)
    expect(augustForCollector.nasiyaInterestReceivedUzs).toBe(250_000)
    expect(augustForCollector.actualProfitUzs).toBe(500_000)
    expect(augustForCollector.expectedProfitUsd).toBe(40)
    expect(augustForCollector.expectedInterestUsd).toBe(20)

    const augustForCreator = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-09-01T00:00:00.000Z'),
      adminId: actor.admin.id,
    })
    expect(augustForCreator.actualProfitUzs).toBe(0)

    const overflowResponse = await nasiyaPaymentRequest({
      nasiyaId: nasiya.id,
      scheduleId: nasiya.schedules[0].id,
      amount: 600,
      inputCurrency: 'USD',
      date: '2026-09-10T08:00:00.000Z',
      key: 'monthly-profit-late-current-early',
    })
    expect(overflowResponse.status, JSON.stringify(await overflowResponse.clone().json())).toBe(200)

    const septemberForCollector = await getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-09-01T00:00:00.000Z'),
      monthEnd: new Date('2026-10-01T00:00:00.000Z'),
      adminId: collector.admin.id,
    })
    expect(septemberForCollector.actualProfitUzs).toBe(2_500_000)
    expect(septemberForCollector.nasiyaInterestReceivedUzs).toBe(1_250_000)
    expect(septemberForCollector.expectedProfitUsd).toBe(0)

    const refreshed = await prisma.nasiya.findUniqueOrThrow({
      where: { id: nasiya.id },
      include: { schedules: { orderBy: { monthNumber: 'asc' } }, paymentAllocations: true },
    })
    expect(refreshed.paymentAllocations).toHaveLength(5)
    expect(refreshed.schedules.map((schedule) => Number(schedule.contractPaidAmount)))
      .toEqual([240, 240, 240, 0])
    expect(refreshed.schedules.slice(0, 3).map((schedule) => ({
      principal: Number(schedule.contractPrincipalPaidAmount),
      margin: Number(schedule.contractMarginPaidAmount),
      interest: Number(schedule.contractInterestPaidAmount),
    }))).toEqual([
      { principal: 160, margin: 40, interest: 40 },
      { principal: 160, margin: 40, interest: 40 },
      { principal: 160, margin: 40, interest: 40 },
    ])

    const novemberAccounting = () => getShopMonthlyAccountingAggregate({
      shopId: actor.shop.id,
      monthStart: new Date('2026-11-01T00:00:00.000Z'),
      monthEnd: new Date('2026-12-01T00:00:00.000Z'),
      adminId: null,
    })
    expect(await novemberAccounting()).toMatchObject({ expectedProfitUsd: 80, expectedInterestUsd: 40 })

    useShopAdmin(actor)
    expect((await nasiyaResolutionRequest({
      nasiyaId: nasiya.id,
      action: 'ARCHIVE',
      reason: 'Temporarily archived after documented review',
      key: 'monthly-profit-archive',
    })).status).toBe(200)
    expect(await novemberAccounting()).toMatchObject({ expectedProfitUsd: 0, expectedInterestUsd: 0 })

    expect((await nasiyaResolutionRequest({
      nasiyaId: nasiya.id,
      action: 'REOPEN',
      reason: 'Collection resumed after customer contact',
      key: 'monthly-profit-reopen',
    })).status).toBe(200)
    expect(await novemberAccounting()).toMatchObject({ expectedProfitUsd: 80, expectedInterestUsd: 40 })

    expect((await nasiyaResolutionRequest({
      nasiyaId: nasiya.id,
      action: 'WRITE_OFF',
      reason: 'Uncollectable after final documented review',
      key: 'monthly-profit-write-off',
    })).status).toBe(400)
    expect(await novemberAccounting()).toMatchObject({ expectedProfitUsd: 80, expectedInterestUsd: 40 })
  })

  it('reverses only Nasiya margin and interest that were actually recognized before a return', async () => {
    const actor = await seedActor('monthly_return')
    useShopAdmin(actor)
    await prisma.currencyRate.create({
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'UZS',
        rate: 12_500,
        source: 'CBU',
        fetchedAt: new Date(),
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Monthly return example',
        purchasePrice: 10_000_000,
        purchaseCurrency: 'USD',
        purchaseInputAmount: 800,
        purchaseExchangeRateAtCreation: 12_500,
        purchaseAmountUzsSnapshot: 10_000_000,
        imei: 'MONTHLY-RETURN-EXAMPLE',
        addedBy: actor.admin.id,
      },
    })
    const createdResponse = await createMonthlyAccountingExampleRequest(
      device.id,
      '+998907654321',
      actor.shop.id,
    )
    expect(createdResponse.status, JSON.stringify(await createdResponse.clone().json())).toBe(201)
    const nasiya = await prisma.nasiya.findFirstOrThrow({
      where: { deviceId: device.id },
      include: { schedules: { orderBy: { monthNumber: 'asc' } } },
    })
    const paymentResponse = await nasiyaPaymentRequest({
      nasiyaId: nasiya.id,
      scheduleId: nasiya.schedules[0].id,
      amount: 120,
      inputCurrency: 'USD',
      date: '2026-07-15T08:00:00.000Z',
      key: 'monthly-return-partial',
    })
    expect(paymentResponse.status, JSON.stringify(await paymentResponse.clone().json())).toBe(200)

    const returnResponse = await returnDeviceRequest({
      deviceId: device.id,
      key: 'monthly-return-recognized-only',
      refundAmount: 0,
    })
    expect(returnResponse.status, JSON.stringify(await returnResponse.clone().json())).toBe(409)
    expect(await prisma.deviceReturn.findFirst({ where: { nasiyaId: nasiya.id } })).toBeNull()
  })

  it('rejects both cash and nasiya sales while a legacy device is still RETURNED', async () => {
    const actor = await seedActor('returned_rejected')
    useShopAdmin(actor)
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Legacy returned phone',
        purchasePrice: 1_000_000,
        purchaseInputAmount: 1_000_000,
        purchaseAmountUzsSnapshot: 1_000_000,
        imei: 'RETURNED-REJECTED-1',
        addedBy: actor.admin.id,
        status: 'RETURNED',
      },
    })

    const [sale, nasiya] = await Promise.all([
      cashSaleRequest(device.id, '+998901111121'),
      createNasiyaRequest(device.id, '+998901111122', actor.shop.id),
    ])
    expect(sale.status).toBe(409)
    expect(nasiya.status, JSON.stringify(await nasiya.clone().json())).toBe(409)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).status).toBe('RETURNED')
    expect(await prisma.sale.count({ where: { deviceId: device.id } })).toBe(0)
    expect(await prisma.nasiya.count({ where: { deviceId: device.id } })).toBe(0)
  })

  it('allows a legacy RETURNED device to be sold only after the audited restock transition', async () => {
    const actor = await seedActor('returned_restocked')
    useShopAdmin(actor)
    await prisma.shopAdmin.update({
      where: { id: actor.admin.id },
      data: { telegramId: '810000001', telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z') },
    })
    await prisma.shopAdmin.create({
      data: {
        shopId: actor.shop.id,
        name: 'Inactive restock recipient',
        phone: '+998901111133',
        login: 'inactive_restock_recipient',
        passwordHash: 'audit-only',
        telegramId: '810000002',
        telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        isActive: false,
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'Legacy restock phone',
        purchasePrice: 1_000_000,
        purchaseInputAmount: 1_000_000,
        purchaseAmountUzsSnapshot: 1_000_000,
        imei: 'RETURNED-RESTOCKED-1',
        addedBy: actor.admin.id,
        status: 'RETURNED',
      },
    })

    expect((await restockDeviceRequest(device.id)).status).toBe(200)
    expect((await cashSaleRequest(device.id, '+998901111123')).status).toBe(201)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).status).toBe('SOLD_CASH')
    expect(await prisma.log.count({ where: { targetType: 'Device', targetId: device.id, action: 'RESTOCK' } })).toBe(1)
    expect(await prisma.sale.count({ where: { deviceId: device.id } })).toBe(1)
    expect(await prisma.notification.findMany({
      where: { shopId: actor.shop.id, type: 'RESTOCK', relatedId: device.id },
      select: { telegramId: true },
    })).toEqual([{ telegramId: '810000001' }])
  })

  it('waives only unpaid Nasiya interest, preserves prior cash, and closes every downstream ledger', async () => {
    const actor = await seedActor('settlement_waiver')
    useShopAdmin(actor)
    await Promise.all([
      prisma.shop.update({
        where: { id: actor.shop.id },
        data: { telegramNotificationsEnabled: true },
      }),
      prisma.shopAdmin.update({
        where: { id: actor.admin.id },
        data: {
          telegramId: '820000001',
          telegramVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
          telegramNotificationsEnabled: true,
        },
      }),
    ])
    const contract = await seedSettlementNasiya(actor, 'settlement_waiver')
    const payable = await prisma.supplierPayable.create({
      data: {
        shopId: actor.shop.id,
        deviceId: contract.device.id,
        origin: 'DEVICE_PURCHASE',
        supplierName: 'Settlement supplier',
        supplierPhone: '+998901212121',
        amount: 400,
        contractAmount: 400,
        remainingAmount: 400,
        contractRemainingAmount: 400,
        ledgerVersion: 2,
        dueDate: new Date('2026-08-15T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })
    await prisma.notification.createMany({
      data: [
        {
          shopId: actor.shop.id,
          type: 'REMINDER',
          message: 'Pending parent reminder',
          telegramId: '820000001',
          recipientShopAdminId: actor.admin.id,
          status: 'PENDING',
          scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
          relatedId: contract.nasiya.id,
          relatedType: 'Nasiya',
        },
        {
          shopId: actor.shop.id,
          type: 'OVERDUE',
          message: 'Failed schedule reminder',
          telegramId: '820000001',
          recipientShopAdminId: actor.admin.id,
          status: 'FAILED',
          scheduledAt: new Date('2026-07-21T09:00:00.000Z'),
          nextAttemptAt: new Date('2026-07-22T09:00:00.000Z'),
          relatedId: contract.openSchedule.id,
          relatedType: 'NasiyaSchedule',
        },
        {
          shopId: actor.shop.id,
          type: 'REMINDER',
          message: 'Historical sent reminder',
          telegramId: '820000001',
          recipientShopAdminId: actor.admin.id,
          status: 'SENT',
          scheduledAt: new Date('2026-07-01T09:00:00.000Z'),
          sentAt: new Date('2026-07-01T09:01:00.000Z'),
          relatedId: contract.nasiya.id,
          relatedType: 'Nasiya',
        },
      ],
    })

    const quoteResponse = await nasiyaSettlementQuoteRequest(contract.nasiya.id)
    expect(quoteResponse.status).toBe(200)
    const quotePayload = await quoteResponse.json() as {
      data: {
        quotes: {
          full: { cashToReceive: { minorUnits: number }; interestToWaive: { minorUnits: number } }
          waive: {
            cashToReceive: { minorUnits: number }
            interestToWaive: { minorUnits: number }
            waiverEligible: boolean
          }
        }
      }
    }
    expect(quotePayload.data.quotes).toMatchObject({
      full: { cashToReceive: { minorUnits: 600 }, interestToWaive: { minorUnits: 0 } },
      waive: {
        cashToReceive: { minorUnits: 500 },
        interestToWaive: { minorUnits: 100 },
        waiverEligible: true,
      },
    })

    const response = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'settlement-waiver-route-key',
      reason: 'Customer requested an agreed early closure',
    })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    const payload = await response.json() as {
      data: {
        settlement: {
          mode: string
          cashReceived: { minorUnits: number }
          interestWaived: { minorUnits: number }
        }
        ledger: {
          paid: { minorUnits: number }
          waived: { minorUnits: number }
          fulfilled: { minorUnits: number }
          remaining: { minorUnits: number }
          status: string
        }
        duplicate: boolean
      }
    }
    expect(payload.data).toMatchObject({
      settlement: {
        mode: 'WAIVE_REMAINING_PROFIT',
        cashReceived: { minorUnits: 500 },
        interestWaived: { minorUnits: 100 },
      },
      ledger: {
        paid: { minorUnits: 1_100 },
        waived: { minorUnits: 100 },
        fulfilled: { minorUnits: 1_200 },
        remaining: { minorUnits: 0 },
        status: 'COMPLETED',
      },
      duplicate: false,
    })

    const [nasiya, schedules, payments, settlement, device, payableAfter, reminders, accounting] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findMany({
        where: { nasiyaId: contract.nasiya.id },
        orderBy: { monthNumber: 'asc' },
      }),
      prisma.nasiyaPayment.findMany({
        where: { nasiyaId: contract.nasiya.id },
        include: { allocations: true },
        orderBy: { paidAt: 'asc' },
      }),
      prisma.nasiyaSettlement.findUniqueOrThrow({
        where: { nasiyaId: contract.nasiya.id },
        include: { allocations: true, payment: true },
      }),
      prisma.device.findUniqueOrThrow({ where: { id: contract.device.id } }),
      prisma.supplierPayable.findUniqueOrThrow({ where: { id: payable.id } }),
      prisma.notification.findMany({
        where: {
          shopId: actor.shop.id,
          OR: [
            { relatedId: contract.nasiya.id },
            { relatedId: contract.openSchedule.id },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
      getShopMonthlyAccountingAggregate({
        shopId: actor.shop.id,
        monthStart: new Date('2026-07-01T00:00:00.000Z'),
        monthEnd: new Date('2026-08-01T00:00:00.000Z'),
        adminId: null,
      }),
    ])
    expect(nasiya).toMatchObject({
      status: 'COMPLETED',
      reminderEnabled: false,
      earlyReminderEnabled: false,
    })
    expect(Number(nasiya.contractPaidAmount)).toBe(1_100)
    expect(Number(nasiya.contractInterestWaivedAmount)).toBe(100)
    expect(Number(nasiya.contractRemainingAmount)).toBe(0)
    expect(schedules.map((schedule) => ({
      status: schedule.status,
      paid: Number(schedule.contractPaidAmount),
      waived: Number(schedule.contractInterestWaivedAmount),
      remaining: Number(schedule.contractRemainingAmount),
      interestPaid: Number(schedule.contractInterestPaidAmount),
    }))).toEqual([
      { status: 'PAID', paid: 600, waived: 0, remaining: 0, interestPaid: 100 },
      { status: 'SETTLED', paid: 500, waived: 100, remaining: 0, interestPaid: 0 },
    ])
    expect(payments).toHaveLength(2)
    expect(payments[0].id).toBe(contract.priorPayment.id)
    expect(Number(payments[0].appliedAmountInContractCurrency)).toBe(600)
    expect(payments[0].allocations.map((allocation) => ({
      principal: Number(allocation.contractPrincipalAmount),
      margin: Number(allocation.contractMarginAmount),
      interest: Number(allocation.contractInterestAmount),
    }))).toEqual([{ principal: 300, margin: 200, interest: 100 }])
    expect(payments[1].allocations.map((allocation) => ({
      principal: Number(allocation.contractPrincipalAmount),
      margin: Number(allocation.contractMarginAmount),
      interest: Number(allocation.contractInterestAmount),
    }))).toEqual([{ principal: 300, margin: 200, interest: 0 }])
    expect(settlement.mode).toBe('WAIVE_REMAINING_PROFIT')
    expect(settlement.allocations).toHaveLength(1)
    expect(Number(settlement.contractCashReceivedAmount)).toBe(500)
    expect(Number(settlement.contractInterestWaivedAmount)).toBe(100)
    expect(device.status).toBe('SOLD_NASIYA')
    expect(payableAfter.status).toBe('PENDING')
    expect(Number(payableAfter.contractRemainingAmount)).toBe(400)
    expect(reminders
      .filter((notification) => notification.type !== 'NASIYA_COMPLETED')
      .map((notification) => notification.status)
      .sort())
      .toEqual(['CANCELLED', 'CANCELLED', 'SENT'])
    expect(await prisma.notification.findMany({
      where: { shopId: actor.shop.id, type: 'NASIYA_COMPLETED' },
      select: { telegramId: true, status: true, relatedId: true },
    })).toEqual([{ telegramId: '820000001', status: 'PENDING', relatedId: contract.nasiya.id }])
    expect(accounting).toMatchObject({
      actualProfitUzs: 500,
      nasiyaInterestReceivedUzs: 100,
      expectedProfitUzs: 0,
      expectedInterestUzs: 0,
    })
    expect(accounting).not.toHaveProperty('waivedNasiyaProfitUzs')
    expect(accounting).not.toHaveProperty('waivedNasiyaProfitCount')
    const customerOverview = await getCustomerProfileOverview({
      shopId: actor.shop.id,
      customerId: contract.customer.id,
      now: new Date('2026-07-22T10:00:00.000Z'),
      visibility: { includeOwnerFinancials: true },
    })
    expect(customerOverview?.metrics.nasiyaInterestUzs).toBe(100)
    expect(customerOverview?.metrics).not.toHaveProperty('waivedNasiyaProfit')
    const reportRange = resolveReportRange({
      preset: 'single',
      month: '2026-07',
      defaultEndMonth: '2026-07',
    })
    const [rangeReport, actorRangeReport] = await Promise.all([
      getShopRangeReport({ shopId: actor.shop.id, range: reportRange, adminId: null }),
      getShopRangeReport({ shopId: actor.shop.id, range: reportRange, adminId: actor.admin.id }),
    ])
    expect(rangeReport.months[0]).toMatchObject({
      grossProfitUzs: 500,
      interestProfitUzs: 100,
      expectedProfit: { uzs: 0, usd: 0 },
      nasiyaInterestExpected: { uzs: 0, usd: 0 },
    })
    expect(rangeReport.months[0]).not.toHaveProperty('waivedNasiyaProfit')
    expect(rangeReport.totals).not.toHaveProperty('waivedNasiyaProfit')
    expect(actorRangeReport.totals).not.toHaveProperty('waivedNasiyaProfit')
    expect(await prisma.log.count({
      where: {
        shopId: actor.shop.id,
        targetType: 'Nasiya',
        targetId: contract.nasiya.id,
        action: 'NASIYA_SETTLED_PROFIT_WAIVED',
      },
    })).toBe(1)

    const replay = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'settlement-waiver-route-key',
      reason: 'Customer requested an agreed early closure',
    })
    expect(replay.status).toBe(200)
    expect((await replay.json() as { data: { duplicate: boolean } }).data.duplicate).toBe(true)
    const changedReplay = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'settlement-waiver-route-key',
      reason: 'Changed replay must be rejected',
    })
    expect(changedReplay.status).toBe(409)
    expect(await prisma.nasiyaSettlement.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(1)
    expect(await prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(2)
    expect(await prisma.log.count({ where: { targetId: contract.nasiya.id } })).toBe(1)

    await expect(prisma.nasiyaSettlement.update({
      where: { id: settlement.id },
      data: { reason: 'Attempted rewrite' },
    })).rejects.toThrow()
    await expect(prisma.nasiyaSettlement.delete({ where: { id: settlement.id } })).rejects.toThrow()
  })

  it('keeps USD compatibility balances at the creation rate while freezing settlement evidence at the current rate', async () => {
    const actor = await seedActor('settlement_usd_fx')
    useShopAdmin(actor)
    await prisma.currencyRate.create({
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'UZS',
        rate: 13_000,
        source: 'CBU',
        effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
        fetchedAt: new Date(),
      },
    })
    const contract = await seedUsdSettlementNasiya(actor, 'settlement_usd_fx')

    const response = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 6_000,
      expectedCash: 5_000,
      expectedWaived: 1_000,
      key: 'settlement-usd-fx-route-key',
      reason: 'USD early closure with a changed reporting rate',
      inputCurrency: 'USD',
      expectedContractCurrency: 'USD',
    })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)

    const [nasiya, schedules, settlement, payment, accounting] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findMany({
        where: { nasiyaId: contract.nasiya.id },
        orderBy: { monthNumber: 'asc' },
      }),
      prisma.nasiyaSettlement.findUniqueOrThrow({
        where: { nasiyaId: contract.nasiya.id },
        include: { allocations: true },
      }),
      prisma.nasiyaPayment.findFirstOrThrow({
        where: { nasiyaId: contract.nasiya.id, id: { not: contract.priorPayment.id } },
        include: { allocations: true },
      }),
      getShopMonthlyAccountingAggregate({
        shopId: actor.shop.id,
        monthStart: new Date('2026-07-01T00:00:00.000Z'),
        monthEnd: new Date('2026-08-01T00:00:00.000Z'),
        adminId: null,
      }),
    ])

    expect(nasiya.status).toBe('COMPLETED')
    expect(Number(nasiya.contractPaidAmount)).toBe(110)
    expect(Number(nasiya.contractInterestWaivedAmount)).toBe(10)
    expect(Number(nasiya.contractRemainingAmount)).toBe(0)
    expect(Number(nasiya.interestWaivedAmount)).toBe(120_000)
    expect(schedules.map((schedule) => ({
      status: schedule.status,
      expectedUzs: Number(schedule.expectedAmount),
      paidUzs: Number(schedule.paidAmount),
      waivedUzs: Number(schedule.interestWaivedAmount),
      paidUsd: Number(schedule.contractPaidAmount),
      waivedUsd: Number(schedule.contractInterestWaivedAmount),
      remainingUsd: Number(schedule.contractRemainingAmount),
    }))).toEqual([
      {
        status: 'PAID',
        expectedUzs: 720_000,
        paidUzs: 720_000,
        waivedUzs: 0,
        paidUsd: 60,
        waivedUsd: 0,
        remainingUsd: 0,
      },
      {
        status: 'SETTLED',
        expectedUzs: 720_000,
        paidUzs: 600_000,
        waivedUzs: 120_000,
        paidUsd: 50,
        waivedUsd: 10,
        remainingUsd: 0,
      },
    ])

    expect(Number(settlement.contractCashReceivedAmount)).toBe(50)
    expect(Number(settlement.contractInterestWaivedAmount)).toBe(10)
    expect(Number(settlement.cashReceivedAmountUzs)).toBe(650_000)
    expect(Number(settlement.interestWaivedAmountUzs)).toBe(130_000)
    expect(Number(settlement.frozenUsdUzsRate)).toBe(13_000)
    expect(settlement.allocations.map((allocation) => ({
      cashUsd: Number(allocation.contractCashAmount),
      waivedUsd: Number(allocation.contractInterestWaivedAmount),
      cashUzs: Number(allocation.cashAmountUzs),
      waivedUzs: Number(allocation.interestWaivedAmountUzs),
    }))).toEqual([{ cashUsd: 50, waivedUsd: 10, cashUzs: 650_000, waivedUzs: 130_000 }])

    expect(Number(payment.amount)).toBe(650_000)
    expect(Number(payment.paymentInputAmount)).toBe(50)
    expect(payment.paymentInputCurrency).toBe('USD')
    expect(Number(payment.appliedAmountInContractCurrency)).toBe(50)
    expect(Number(payment.paymentExchangeRate)).toBe(13_000)
    expect(payment.allocations.map((allocation) => ({
      contractAmount: Number(allocation.contractAmount),
      principal: Number(allocation.contractPrincipalAmount),
      margin: Number(allocation.contractMarginAmount),
      interest: Number(allocation.contractInterestAmount),
      amountUzs: Number(allocation.amountUzs),
      principalUzs: Number(allocation.principalAmountUzs),
      marginUzs: Number(allocation.marginAmountUzs),
      interestUzs: Number(allocation.interestAmountUzs),
    }))).toEqual([{
      contractAmount: 50,
      principal: 30,
      margin: 20,
      interest: 0,
      amountUzs: 650_000,
      principalUzs: 390_000,
      marginUzs: 260_000,
      interestUzs: 0,
    }])
    expect(accounting).toMatchObject({
      actualProfitUzs: 620_000,
      nasiyaInterestReceivedUzs: 120_000,
      expectedProfitUsd: 0,
      expectedInterestUsd: 0,
    })
    expect(accounting).not.toHaveProperty('waivedNasiyaProfitUsd')
    expect(accounting).not.toHaveProperty('waivedNasiyaProfitCount')

    const reportRange = resolveReportRange({
      preset: 'single',
      month: '2026-07',
      defaultEndMonth: '2026-07',
    })
    const rangeReport = await getShopRangeReport({
      shopId: actor.shop.id,
      range: reportRange,
      adminId: null,
    })
    expect(rangeReport.totals).not.toHaveProperty('waivedNasiyaProfit')
    expect(rangeReport.totals.grossProfitUzs).toBe(620_000)
    expect(rangeReport.totals.interestProfitUzs).toBe(120_000)
  })

  it('takes the full remaining amount with profit and records no waiver', async () => {
    const actor = await seedActor('settlement_full')
    useShopAdmin(actor)
    const contract = await seedSettlementNasiya(actor, 'settlement_full')

    const stale = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'FULL_WITH_PROFIT',
      expectedRemaining: 599,
      expectedCash: 599,
      expectedWaived: 0,
      key: 'settlement-stale-quote-key',
    })
    expect(stale.status).toBe(409)
    expect(await prisma.nasiyaSettlement.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(0)
    expect(Number((await prisma.nasiya.findUniqueOrThrow({
      where: { id: contract.nasiya.id },
    })).contractRemainingAmount)).toBe(600)

    const response = await nasiyaSettlementRequest({
      nasiyaId: contract.nasiya.id,
      mode: 'FULL_WITH_PROFIT',
      expectedRemaining: 600,
      expectedCash: 600,
      expectedWaived: 0,
      key: 'settlement-full-route-key',
    })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)

    const [nasiya, schedules, settlement, latestPayment, device, accounting] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findMany({
        where: { nasiyaId: contract.nasiya.id },
        orderBy: { monthNumber: 'asc' },
      }),
      prisma.nasiyaSettlement.findUniqueOrThrow({ where: { nasiyaId: contract.nasiya.id } }),
      prisma.nasiyaPayment.findFirstOrThrow({
        where: { nasiyaId: contract.nasiya.id, id: { not: contract.priorPayment.id } },
        include: { allocations: true },
      }),
      prisma.device.findUniqueOrThrow({ where: { id: contract.device.id } }),
      getShopMonthlyAccountingAggregate({
        shopId: actor.shop.id,
        monthStart: new Date('2026-07-01T00:00:00.000Z'),
        monthEnd: new Date('2026-08-01T00:00:00.000Z'),
        adminId: null,
      }),
    ])
    expect(nasiya.status).toBe('COMPLETED')
    expect(Number(nasiya.contractPaidAmount)).toBe(1_200)
    expect(Number(nasiya.contractInterestWaivedAmount)).toBe(0)
    expect(Number(nasiya.contractRemainingAmount)).toBe(0)
    expect(schedules.map(({ status }) => status)).toEqual(['PAID', 'PAID'])
    expect(schedules.map((schedule) => Number(schedule.contractInterestPaidAmount))).toEqual([100, 100])
    expect(settlement.mode).toBe('FULL_WITH_PROFIT')
    expect(Number(settlement.contractCashReceivedAmount)).toBe(600)
    expect(Number(settlement.contractInterestWaivedAmount)).toBe(0)
    expect(latestPayment.allocations.map((allocation) => Number(allocation.contractInterestAmount))).toEqual([100])
    expect(device.status).toBe('SOLD_NASIYA')
    expect(accounting).not.toHaveProperty('waivedNasiyaProfitCount')
    expect(accounting).not.toHaveProperty('waivedNasiyaProfitUzs')
    expect(accounting.actualProfitUzs).toBe(600)
  })

  it('keeps profit waiver behind its exact staff permission while ordinary full closure remains collectable', async () => {
    const actor = await seedActor('settlement_staff')
    const deniedContract = await seedSettlementNasiya(actor, 'settlement_staff_denied')
    const waiverOnly = await seedStaff(actor, 'settlement_waiver_only', ['NASIYA_PROFIT_WAIVE'])
    useShopAdmin(waiverOnly)
    expect((await nasiyaDetailRequest(deniedContract.nasiya.id)).status).toBe(403)
    expect((await nasiyaSettlementRequest({
      nasiyaId: deniedContract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'settlement-waiver-only-denied',
      reason: 'Supplemental waiver grant is not collection authority',
    })).status).toBe(403)

    const collector = await seedStaff(actor, 'settlement_collector', ['NASIYA_PAYMENT_RECEIVE'])
    useShopAdmin(collector)

    const denied = await nasiyaSettlementRequest({
      nasiyaId: deniedContract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'settlement-staff-waiver-denied',
      reason: 'Staff waiver permission boundary',
    })
    expect(denied.status).toBe(403)
    expect(await prisma.nasiyaSettlement.count({ where: { nasiyaId: deniedContract.nasiya.id } })).toBe(0)

    const full = await nasiyaSettlementRequest({
      nasiyaId: deniedContract.nasiya.id,
      mode: 'FULL_WITH_PROFIT',
      expectedRemaining: 600,
      expectedCash: 600,
      expectedWaived: 0,
      key: 'settlement-staff-full-allowed',
    })
    expect(full.status).toBe(200)
    expect((await prisma.nasiyaSettlement.findUniqueOrThrow({
      where: { nasiyaId: deniedContract.nasiya.id },
    })).actorId).toBe(collector.admin.id)

    const allowedContract = await seedSettlementNasiya(actor, 'settlement_staff_allowed')
    const allowed = await seedStaff(
      actor,
      'settlement_waiver_staff',
      ['NASIYA_PAYMENT_RECEIVE', 'NASIYA_PROFIT_WAIVE'],
    )
    useShopAdmin(allowed)
    const waived = await nasiyaSettlementRequest({
      nasiyaId: allowedContract.nasiya.id,
      mode: 'WAIVE_REMAINING_PROFIT',
      expectedRemaining: 600,
      expectedCash: 500,
      expectedWaived: 100,
      key: 'settlement-staff-waiver-allowed',
      reason: 'Owner explicitly granted the waiver capability',
    })
    expect(waived.status, JSON.stringify(await waived.clone().json())).toBe(200)
    expect((await prisma.nasiyaSettlement.findUniqueOrThrow({
      where: { nasiyaId: allowedContract.nasiya.id },
    })).actorId).toBe(allowed.admin.id)
  })

  it('isolates tenants and serializes competing early-settlement commands', async () => {
    const first = await seedActor('settlement_tenant_a')
    const second = await seedActor('settlement_tenant_b')
    const foreign = await seedSettlementNasiya(second, 'settlement_foreign')
    useShopAdmin(first)

    expect((await nasiyaSettlementQuoteRequest(foreign.nasiya.id)).status).toBe(404)
    expect((await nasiyaSettlementRequest({
      nasiyaId: foreign.nasiya.id,
      mode: 'FULL_WITH_PROFIT',
      expectedRemaining: 600,
      expectedCash: 600,
      expectedWaived: 0,
      key: 'settlement-cross-tenant',
    })).status).toBe(404)
    expect(await prisma.nasiyaSettlement.count()).toBe(0)

    const local = await seedSettlementNasiya(first, 'settlement_concurrent')
    const responses = await Promise.all([
      nasiyaSettlementRequest({
        nasiyaId: local.nasiya.id,
        mode: 'FULL_WITH_PROFIT',
        expectedRemaining: 600,
        expectedCash: 600,
        expectedWaived: 0,
        key: 'settlement-concurrent-a',
      }),
      nasiyaSettlementRequest({
        nasiyaId: local.nasiya.id,
        mode: 'FULL_WITH_PROFIT',
        expectedRemaining: 600,
        expectedCash: 600,
        expectedWaived: 0,
        key: 'settlement-concurrent-b',
      }),
    ])
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409])
    const [nasiya, settlementCount, paymentCount] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: local.nasiya.id } }),
      prisma.nasiyaSettlement.count({ where: { nasiyaId: local.nasiya.id } }),
      prisma.nasiyaPayment.count({ where: { nasiyaId: local.nasiya.id } }),
    ])
    expect(nasiya.status).toBe('COMPLETED')
    expect(Number(nasiya.contractPaidAmount) + Number(nasiya.contractInterestWaivedAmount) + Number(nasiya.contractRemainingAmount))
      .toBe(Number(nasiya.contractFinalAmount))
    expect(settlementCount).toBe(1)
    expect(paymentCount).toBe(2)
  })

  it('replays the successful final Nasiya payment before the completed-state guard', async () => {
    const actor = await seedActor('final_retry')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'final_retry', 1_000)

    const first = await nasiyaPaymentRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      amount: 1_000,
      key: 'final-payment-retry-key',
    })
    expect(first.status).toBe(200)
    expect(await prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(1)
    expect((await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })).status).toBe('COMPLETED')

    const retry = await nasiyaPaymentRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      amount: 1_000,
      key: 'final-payment-retry-key',
    })
    const retryBody = await retry.json() as {
      success: boolean
      data: {
        receipt: { recordedUzs: { minorUnits: number } }
        ledger: { remaining: { minorUnits: number } }
        duplicate: boolean
      }
    }
    expect(retry.status).toBe(200)
    expect(retryBody.success).toBe(true)
    expect(retryBody.data).toMatchObject({
      receipt: { recordedUzs: { minorUnits: 1_000 } },
      ledger: { remaining: { minorUnits: 0 } },
      duplicate: true,
    })
    expect(await prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(1)
    expect(await prisma.log.count({ where: { targetType: 'NasiyaSchedule', targetId: contract.schedule.id } })).toBe(1)
  })

  it('allocates a payment to the selected month first, then the oldest remaining month', async () => {
    const actor = await seedActor('selected_month')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'selected_month', 3_000_000)
    const { selected, third } = await prisma.$transaction(async (tx) => {
      await tx.nasiyaSchedule.update({
        where: { id: contract.schedule.id },
        data: {
          expectedAmount: 1_000_000,
          contractExpectedAmount: 1_000_000,
          contractRemainingAmount: 1_000_000,
        },
      })
      const selected = await tx.nasiyaSchedule.create({
        data: {
          nasiyaId: contract.nasiya.id,
          shopId: actor.shop.id,
          monthNumber: 2,
          dueDate: new Date('2026-09-01T00:00:00.000Z'),
          expectedAmount: 1_000_000,
          contractCurrency: 'UZS',
          contractExpectedAmount: 1_000_000,
          contractRemainingAmount: 1_000_000,
        },
      })
      const third = await tx.nasiyaSchedule.create({
        data: {
          nasiyaId: contract.nasiya.id,
          shopId: actor.shop.id,
          monthNumber: 3,
          dueDate: new Date('2026-10-01T00:00:00.000Z'),
          expectedAmount: 1_000_000,
          contractCurrency: 'UZS',
          contractExpectedAmount: 1_000_000,
          contractRemainingAmount: 1_000_000,
        },
      })
      return { selected, third }
    })

    const response = await nasiyaPaymentRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: selected.id,
      amount: 1_500_000,
      key: 'selected-month-first-key',
    })
    expect(response.status).toBe(200)

    const rows = await prisma.nasiyaSchedule.findMany({
      where: { nasiyaId: contract.nasiya.id },
      orderBy: { monthNumber: 'asc' },
      select: { id: true, contractPaidAmount: true },
    })
    expect(rows.map((row) => [row.id, Number(row.contractPaidAmount)])).toEqual([
      [contract.schedule.id, 500_000],
      [selected.id, 1_000_000],
      [third.id, 0],
    ])
    expect((await prisma.nasiyaPayment.findFirstOrThrow({ where: { nasiyaId: contract.nasiya.id } })).nasiyaScheduleId)
      .toBe(selected.id)
  })

  it('serializes two concurrent payments without losing or duplicating balance updates', async () => {
    const actor = await seedActor('concurrent_payment')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'concurrent_payment', 1_000_000)

    const responses = await Promise.all([
      nasiyaPaymentRequest({
        nasiyaId: contract.nasiya.id,
        scheduleId: contract.schedule.id,
        amount: 400_000,
        key: 'concurrent-payment-a',
      }),
      nasiyaPaymentRequest({
        nasiyaId: contract.nasiya.id,
        scheduleId: contract.schedule.id,
        amount: 600_000,
        key: 'concurrent-payment-b',
      }),
    ])

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 200])
    const [nasiya, schedule, payments] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findUniqueOrThrow({ where: { id: contract.schedule.id } }),
      prisma.nasiyaPayment.findMany({ where: { nasiyaId: contract.nasiya.id } }),
    ])
    expect(nasiya.status).toBe('COMPLETED')
    expect(Number(nasiya.contractRemainingAmount)).toBe(0)
    expect(Number(schedule.contractPaidAmount)).toBe(1_000_000)
    expect(payments).toHaveLength(2)
    expect(payments.reduce((sum, payment) => sum + Number(payment.appliedAmountInContractCurrency), 0)).toBe(1_000_000)
  })

  it('rejects the same Nasiya payment idempotency key when the submitted amount changes', async () => {
    const actor = await seedActor('payload_retry')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'payload_retry', 2_000)

    const first = await nasiyaPaymentRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      amount: 500,
      key: 'payload-mismatch-key',
    })
    expect(first.status).toBe(200)

    const changedPayload = await nasiyaPaymentRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      amount: 600,
      key: 'payload-mismatch-key',
    })
    const body = await changedPayload.json() as { success: boolean; error?: string }
    expect(changedPayload.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error).toContain("Idempotency-Key")
    expect(await prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(1)
    expect(Number((await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })).contractRemainingAmount)).toBe(1_500)
  })

  it('records deferral separately without a payment or paid-total mutation and rejects a changed replay', async () => {
    const actor = await seedActor('deferral_payload_retry')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'deferral_payload_retry', 2_000)
    const key = 'deferral-payload-mismatch-key'

    const before = await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })
    const first = await nasiyaDeferRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      key,
      newDueDate: '2026-09-01T00:00:00.000Z',
      reason: 'Customer requested September',
    })
    expect(first.status).toBe(200)

    const changed = await nasiyaDeferRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      key,
      newDueDate: '2026-10-01T00:00:00.000Z',
      reason: 'Customer requested October',
    })
    expect(changed.status).toBe(409)
    expect(await prisma.nasiyaDeferral.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(1)
    expect(await prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(0)
    const after = await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })
    expect(Number(after.contractPaidAmount)).toBe(Number(before.contractPaidAmount))
    expect(Number(after.contractRemainingAmount)).toBe(Number(before.contractRemainingAmount))
    expect((await prisma.nasiyaSchedule.findUniqueOrThrow({ where: { id: contract.schedule.id } })).delayedUntil)
      .toEqual(new Date('2026-09-01T00:00:00.000Z'))
    const event = await prisma.nasiyaDeferral.findFirstOrThrow({ where: { nasiyaId: contract.nasiya.id } })
    expect(event.originalDueDate).toEqual(new Date('2026-08-01T00:00:00.000Z'))
    expect(event.newDueDate).toEqual(new Date('2026-09-01T00:00:00.000Z'))
  })

  it('archives a Nasiya without changing balances and blocks payment until a compensating reopen', async () => {
    const actor = await seedActor('archive_reopen')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'archive_reopen', 5_000)

    expect((await nasiyaResolutionRequest({
      nasiyaId: contract.nasiya.id,
      action: 'ARCHIVE',
      reason: 'Collection queue cleanup',
      key: 'archive-reopen-archive',
    })).status).toBe(200)

    const archived = await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })
    expect(archived.resolutionState).toBe('ARCHIVED')
    expect(Number(archived.contractRemainingAmount)).toBe(5_000)
    expect(Number(archived.contractPaidAmount)).toBe(0)
    expect(await prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } })).toBe(0)
    expect((await nasiyaPaymentRequest({
      nasiyaId: contract.nasiya.id,
      scheduleId: contract.schedule.id,
      amount: 1_000,
      key: 'archived-payment-blocked',
    })).status).toBe(404)

    expect((await nasiyaResolutionRequest({
      nasiyaId: contract.nasiya.id,
      action: 'REOPEN',
      reason: 'Customer resumed payments',
      key: 'archive-reopen-reopen',
    })).status).toBe(200)
    const events = await prisma.nasiyaResolutionEvent.findMany({
      where: { nasiyaId: contract.nasiya.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(events.map((event) => event.eventType)).toEqual(['ARCHIVE', 'REOPEN'])
    expect(events[1].reversesEventId).toBe(events[0].id)
    expect(Number(events[1].nativeRemainingAmount)).toBe(Number(events[0].nativeRemainingAmount))
    expect(Number(events[1].frozenUzsAmount)).toBe(Number(events[0].frozenUzsAmount))
    expect((await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })).resolutionState).toBe('ACTIVE')
  })

  it('rejects every new write-off command without changing balances or creating events', async () => {
    const actor = await seedActor('writeoff_concurrency')
    useShopAdmin(actor)
    const contract = await seedNasiya(actor, 'writeoff_concurrency', 8_000)

    const responses = await Promise.all([
      nasiyaResolutionRequest({
        nasiyaId: contract.nasiya.id,
        action: 'WRITE_OFF',
        reason: 'Uncollectible debt attempt one',
        key: 'writeoff-concurrency-a',
      }),
      nasiyaResolutionRequest({
        nasiyaId: contract.nasiya.id,
        action: 'WRITE_OFF',
        reason: 'Uncollectible debt attempt two',
        key: 'writeoff-concurrency-b',
      }),
    ])
    expect(responses.map((response) => response.status)).toEqual([400, 400])
    const [nasiya, schedule, events, paymentCount] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } }),
      prisma.nasiyaSchedule.findUniqueOrThrow({ where: { id: contract.schedule.id } }),
      prisma.nasiyaResolutionEvent.findMany({ where: { nasiyaId: contract.nasiya.id } }),
      prisma.nasiyaPayment.count({ where: { nasiyaId: contract.nasiya.id } }),
    ])
    expect(nasiya.resolutionState).toBe('ACTIVE')
    expect(Number(nasiya.contractRemainingAmount)).toBe(8_000)
    expect(Number(nasiya.contractPaidAmount)).toBe(0)
    expect(Number(schedule.contractPaidAmount)).toBe(0)
    expect(events).toHaveLength(0)
    expect(paymentCount).toBe(0)
  })

  it('isolates Nasiya archive from view and write-off grants', async () => {
    const actor = await seedActor('writeoff_rbac')
    const contract = await seedNasiya(actor, 'writeoff_rbac', 3_000)
    const deniedStaff = await seedStaff(actor, 'writeoff_denied', ['NASIYA_VIEW'])
    useShopAdmin(deniedStaff)
    expect((await nasiyaResolutionRequest({
      nasiyaId: contract.nasiya.id,
      action: 'ARCHIVE',
      reason: 'Denied staff archive attempt',
      key: 'writeoff-rbac-denied',
    })).status).toBe(403)

    const writeOffStaff = await seedStaff(actor, 'writeoff_granted', ['NASIYA_VIEW', 'NASIYA_WRITE_OFF'])
    useShopAdmin(writeOffStaff)
    expect((await nasiyaResolutionRequest({
      nasiyaId: contract.nasiya.id,
      action: 'ARCHIVE',
      reason: 'Write-off grant must not archive',
      key: 'writeoff-rbac-granted',
    })).status).toBe(403)

    const archiveStaff = await seedStaff(actor, 'archive_granted', ['NASIYA_VIEW', 'NASIYA_ARCHIVE'])
    useShopAdmin(archiveStaff)
    expect((await nasiyaResolutionRequest({
      nasiyaId: contract.nasiya.id,
      action: 'ARCHIVE',
      reason: 'Exact archive grant may archive',
      key: 'archive-rbac-granted',
    })).status).toBe(200)

    const events = await prisma.nasiyaResolutionEvent.findMany({ where: { nasiyaId: contract.nasiya.id } })
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('ARCHIVE')
    expect((await prisma.nasiya.findUniqueOrThrow({ where: { id: contract.nasiya.id } })).resolutionState).toBe('ARCHIVED')
  })

  it('does not let a shop resolve another shop Nasiya', async () => {
    const first = await seedActor('resolution_tenant_a')
    const second = await seedActor('resolution_tenant_b')
    const foreign = await seedNasiya(second, 'resolution_foreign', 4_000)
    useShopAdmin(first)
    const response = await nasiyaResolutionRequest({
      nasiyaId: foreign.nasiya.id,
      action: 'ARCHIVE',
      reason: 'Cross-tenant action must fail',
      key: 'resolution-cross-tenant',
    })
    expect(response.status).toBe(404)
    expect(await prisma.nasiyaResolutionEvent.count()).toBe(0)
    expect((await prisma.nasiya.findUniqueOrThrow({ where: { id: foreign.nasiya.id } })).resolutionState).toBe('ACTIVE')
  })

  it('replays only the exact Sale payment command and rejects changed durable fields', async () => {
    const actor = await seedActor('sale_payload_retry')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Sale replay customer', phone: '+998903838383', normalizedPhone: '998903838383' },
    })
    const device = await prisma.device.create({
      data: { shopId: actor.shop.id, model: 'Sale replay phone', purchasePrice: 500, imei: 'SALE-REPLAY-PAYLOAD', addedBy: actor.admin.id, status: 'SOLD_DEBT' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 0,
        remainingAmount: 1_000,
        contractSalePrice: 1_000,
        contractAmountPaid: 0,
        contractRemainingAmount: 1_000,
        paidFully: false,
        paymentMethod: 'CASH',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })
    const key = 'sale-payment-payload-key'
    const command = {
      saleId: sale.id,
      amount: 400,
      key,
      note: 'First exact payment',
      paidAt: '2026-07-13T08:00:00.000Z',
      nextDueDate: '2026-09-01T00:00:00.000Z',
    }

    expect((await salePaymentRequest(command)).status).toBe(200)
    expect((await salePaymentRequest(command)).status).toBe(200)
    expect((await salePaymentRequest({ ...command, amount: 500 })).status).toBe(409)
    expect((await salePaymentRequest({ ...command, nextDueDate: '2026-10-01T00:00:00.000Z' })).status).toBe(409)
    expect(await prisma.salePayment.count({ where: { saleId: sale.id } })).toBe(1)
    const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })
    expect(Number(stored.contractRemainingAmount)).toBe(600)
    expect(stored.dueDate).toEqual(new Date('2026-09-01T00:00:00.000Z'))
  })

  it('replays only the exact shop subscription payment command', async () => {
    const actor = await seedActor('shop_payment_retry')
    await useSuperAdmin(actor)
    const key = 'shop-payment-payload-key'
    const command = { shopId: actor.shop.id, amount: 1_000, months: 1, key, note: 'One month paid' }

    expect((await shopPaymentRequest(command)).status).toBe(200)
    expect((await shopPaymentRequest(command)).status).toBe(200)
    expect((await shopPaymentRequest({ ...command, months: 2 })).status).toBe(409)
    expect((await shopPaymentRequest({ ...command, note: 'Changed note' })).status).toBe(409)
    expect(await prisma.shopPayment.count({ where: { shopId: actor.shop.id } })).toBe(1)
    const receipt = await prisma.shopPayment.findFirstOrThrow({ where: { shopId: actor.shop.id } })
    expect(receipt.allocationStatus).toBe('PACKAGE_ALLOCATED')
    expect(receipt.currency).toBe('UZS')
    expect(Number(receipt.packageMonthlyPriceSnapshot)).toBe(1_000)
    expect(receipt.packageVersionId).not.toBeNull()
    expect(receipt.commandHash).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.servicePeriodStart).not.toBeNull()
    expect(receipt.servicePeriodEnd).not.toBeNull()
  })

  it('does not let a shop admin pay another shop Nasiya', async () => {
    const first = await seedActor('tenant_a')
    const second = await seedActor('tenant_b')
    const foreign = await seedNasiya(second, 'foreign', 1_000)
    useShopAdmin(first)

    const response = await nasiyaPaymentRequest({
      nasiyaId: foreign.nasiya.id,
      scheduleId: foreign.schedule.id,
      amount: 500,
      key: 'foreign-tenant-key',
    })
    expect(response.status).toBe(404)
    expect(await prisma.nasiyaPayment.count()).toBe(0)
    expect(Number((await prisma.nasiya.findUniqueOrThrow({ where: { id: foreign.nasiya.id } })).contractRemainingAmount)).toBe(1_000)
  })

  it('does not let a shop admin read or modify another shop device, customer, or Nasiya', async () => {
    const first = await seedActor('tenant_matrix_a')
    const second = await seedActor('tenant_matrix_b')
    const foreign = await seedNasiya(second, 'tenant_matrix_foreign', 1_000)
    useShopAdmin(first)
    const { NextRequest } = await import('next/server')
    const deviceRoute = await import('@/app/api/devices/[id]/route')
    const customerRoute = await import('@/app/api/customers/[id]/route')
    const nasiyaRoute = await import('@/app/api/nasiya/[id]/route')

    const [deviceGet, devicePatch, customerGet, customerPatch, nasiyaGet, nasiyaPatch] = await Promise.all([
      deviceRoute.GET(
        new NextRequest(`http://localhost/api/devices/${foreign.device.id}`),
        { params: Promise.resolve({ id: foreign.device.id }) },
      ),
      deviceRoute.PATCH(
        new NextRequest(`http://localhost/api/devices/${foreign.device.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'Cross-tenant edit attempt' }),
        }),
        { params: Promise.resolve({ id: foreign.device.id }) },
      ),
      customerRoute.GET(
        new NextRequest(`http://localhost/api/customers/${foreign.customer.id}`),
        { params: Promise.resolve({ id: foreign.customer.id }) },
      ),
      customerRoute.PATCH(
        new NextRequest(`http://localhost/api/customers/${foreign.customer.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'Cross-tenant edit attempt' }),
        }),
        { params: Promise.resolve({ id: foreign.customer.id }) },
      ),
      nasiyaRoute.GET(
        new NextRequest(`http://localhost/api/nasiya/${foreign.nasiya.id}`),
        { params: Promise.resolve({ id: foreign.nasiya.id }) },
      ),
      nasiyaRoute.PATCH(
        new NextRequest(`http://localhost/api/nasiya/${foreign.nasiya.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'Cross-tenant edit attempt' }),
        }),
        { params: Promise.resolve({ id: foreign.nasiya.id }) },
      ),
    ])

    expect([deviceGet, devicePatch, customerGet, customerPatch, nasiyaGet, nasiyaPatch].map(({ status }) => status))
      .toEqual([404, 404, 404, 404, 404, 404])
    expect((await prisma.device.findUniqueOrThrow({ where: { id: foreign.device.id } })).model).toBe('Route phone tenant_matrix_foreign')
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: foreign.customer.id } })).note).toBeNull()
    expect((await prisma.nasiya.findUniqueOrThrow({ where: { id: foreign.nasiya.id } })).note).toBeNull()
  })

  it('creates an in-stock normal device with an append-only partial supplier debt split', async () => {
    const actor = await seedActor('device_pay_later')
    useShopAdmin(actor)
    const response = await createDeviceRequest({
      model: 'Normal Pay Later phone',
      color: 'Qora',
      storageAmount: 256,
      storageUnit: 'GB',
      conditionCode: 'NEW',
      purchasePrice: 1_000_000,
      inputCurrency: 'UZS',
      imei: '867530920260722',
      supplierName: 'Normal device supplier',
      supplierPhone: '+998907771122',
      purchaseSettlement: 'PAY_LATER',
      supplierDueDate: '2026-09-20',
      supplierInitialPaymentAmount: 300_000,
      supplierPaymentMethod: 'CASH',
      supplierPaymentBreakdown: [
        { method: 'CASH', amount: 100_000 },
        { method: 'CARD', amount: 200_000 },
      ],
    }, 'device-pay-later-split-proof')
    expect(response.status).toBe(201)
    const device = await prisma.device.findFirstOrThrow({ where: { shopId: actor.shop.id, imei: '867530920260722' } })
    expect(device.status).toBe('IN_STOCK')
    const payable = await prisma.supplierPayable.findFirstOrThrow({
      where: { shopId: actor.shop.id, deviceId: device.id },
      include: { payments: true },
    })
    expect(payable).toMatchObject({ origin: 'DEVICE_PURCHASE', status: 'PARTIAL', saleId: null })
    expect(Number(payable.contractPaidAmount)).toBe(300_000)
    expect(Number(payable.contractRemainingAmount)).toBe(700_000)
    expect(payable.payments).toHaveLength(1)
    expect(payable.payments[0].paymentBreakdown).toEqual([
      { method: 'CASH', amount: 100000 },
      { method: 'CARD', amount: 200000 },
    ])
  })

  it('allows the supplier payable PENDING and OVERDUE transitions to PAID', async () => {
    const actor = await seedActor('open_payables')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Open payable customer', phone: '+998909292929', normalizedPhone: '998909292929' },
    })

    for (const [index, status] of (['PENDING', 'OVERDUE'] as const).entries()) {
      const device = await prisma.device.create({
        data: {
          shopId: actor.shop.id,
          model: `Open payable phone ${status}`,
          purchasePrice: 500,
          imei: `ROUTE-OPEN-PAYABLE-${index}`,
          addedBy: actor.admin.id,
          status: 'SOLD_CASH',
        },
      })
      const sale = await prisma.sale.create({
        data: {
          shopId: actor.shop.id,
          deviceId: device.id,
          customerId: customer.id,
          salePrice: 1_000,
          amountPaid: 1_000,
          contractSalePrice: 1_000,
          contractAmountPaid: 1_000,
          paymentMethod: 'CASH',
          createdBy: actor.admin.id,
        },
      })
      const payable = await prisma.supplierPayable.create({
        data: {
          shopId: actor.shop.id,
          deviceId: device.id,
          saleId: sale.id,
          supplierName: `${status} supplier`,
          supplierPhone: '+998908282828',
          amount: 500,
          contractAmount: 500,
          status,
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          createdBy: actor.admin.id,
        },
      })

      const response = await supplierPayablePaymentRequest(payable.id, `${status} transition proof`)
      expect(response.status).toBe(200)
      expect((await prisma.supplierPayable.findUniqueOrThrow({ where: { id: payable.id } })).status).toBe('PAID')
      expect(await prisma.log.count({ where: { targetType: 'SupplierPayable', targetId: payable.id } })).toBe(1)
    }
  })

  it('never transitions a CANCELLED supplier payable to PAID', async () => {
    const actor = await seedActor('cancelled_payable')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: { shopId: actor.shop.id, name: 'Payable customer', phone: '+998909191919', normalizedPhone: '998909191919' },
    })
    const device = await prisma.device.create({
      data: { shopId: actor.shop.id, model: 'Payable phone', purchasePrice: 500, imei: 'ROUTE-PAYABLE', addedBy: actor.admin.id, status: 'SOLD_CASH' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 1_000,
        contractSalePrice: 1_000,
        contractAmountPaid: 1_000,
        paymentMethod: 'CASH',
        createdBy: actor.admin.id,
      },
    })
    const payable = await prisma.supplierPayable.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        saleId: sale.id,
        supplierName: 'Cancelled supplier',
        supplierPhone: '+998908181818',
        amount: 500,
        contractAmount: 500,
        status: 'CANCELLED',
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })

    const response = await supplierPayablePaymentRequest(payable.id, 'Cancelled transition audit')

    expect(response.status).toBe(409)
    expect((await prisma.supplierPayable.findUniqueOrThrow({ where: { id: payable.id } })).status).toBe('CANCELLED')
    expect(await prisma.log.count({ where: { targetType: 'SupplierPayable', targetId: payable.id } })).toBe(0)
    expect(await prisma.notification.count({ where: { relatedType: 'SupplierPayable', relatedId: payable.id } })).toBe(0)
  })

  it('exports a device purchase in its frozen native currency with its creation-rate and UZS snapshot', async () => {
    const actor = await seedActor('device_export_native')
    useShopAdmin(actor)
    await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'USD purchase export phone',
        purchasePrice: 1_250_000,
        purchaseCurrency: 'USD',
        purchaseInputAmount: 100,
        purchaseExchangeRateAtCreation: 12_500,
        purchaseAmountUzsSnapshot: 1_250_000,
        imei: 'ROUTE-USD-EXPORT-DEVICE',
        addedBy: actor.admin.id,
      },
    })

    const { NextRequest } = await import('next/server')
    const { GET } = await import('@/app/api/export/[entity]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/export/devices?format=csv'),
      { params: Promise.resolve({ entity: 'devices' }) },
    )
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(csv).toContain('purchaseAmountNative')
    expect(csv).toContain('purchaseCurrency')
    expect(csv).toContain('purchaseExchangeRateAtCreation')
    expect(csv).toContain('purchaseAmountUzsSnapshot')
    expect(csv).toContain('purchasePriceCurrentShopDisplay')
    expect(csv).toContain('USD purchase export phone')
    expect(csv).toContain('"100","AQSH dollari","12500","1250000","1250000"')
  })

  it('exports the frozen native Sale ledger alongside clearly labelled UZS snapshots', async () => {
    const actor = await seedActor('sale_export_native')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: {
        shopId: actor.shop.id,
        name: 'USD export customer',
        phone: '+998901919191',
        normalizedPhone: '998901919191',
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'USD export phone',
        purchasePrice: 500_000,
        purchaseInputAmount: 500_000,
        purchaseAmountUzsSnapshot: 500_000,
        imei: 'ROUTE-USD-EXPORT-SALE',
        addedBy: actor.admin.id,
        status: 'SOLD_DEBT',
      },
    })
    await prisma.sale.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_250_000,
        amountPaid: 500_000,
        remainingAmount: 750_000,
        contractCurrency: 'USD',
        contractExchangeRateAtCreation: 12_500,
        contractSalePrice: 100,
        contractAmountPaid: 40,
        contractRemainingAmount: 60,
        paidFully: false,
        paymentMethod: 'CASH',
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: actor.admin.id,
      },
    })

    const { NextRequest } = await import('next/server')
    const { GET } = await import('@/app/api/export/[entity]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/export/sales?format=csv'),
      { params: Promise.resolve({ entity: 'sales' }) },
    )
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(csv).toContain('contractCurrency')
    expect(csv).toContain('contractExchangeRateAtCreation')
    expect(csv).toContain('contractRemainingAmount')
    expect(csv).toContain('salePriceUzsSnapshot')
    expect(csv).toContain('USD export customer')
    expect(csv).toContain('$100.00')
    expect(csv).toContain('$60.00')
    expect(csv).toContain('1250000')
  })

  it('exports frozen native Nasiya fields to CSV and produces the XLSX from the same projection', async () => {
    const actor = await seedActor('nasiya_export_native')
    useShopAdmin(actor)
    const customer = await prisma.customer.create({
      data: {
        shopId: actor.shop.id,
        name: 'USD nasiya export customer',
        phone: '+998902929292',
        normalizedPhone: '998902929292',
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: actor.shop.id,
        model: 'USD nasiya export phone',
        purchasePrice: 750_000,
        purchaseInputAmount: 750_000,
        purchaseAmountUzsSnapshot: 750_000,
        imei: 'ROUTE-USD-EXPORT-NASIYA',
        addedBy: actor.admin.id,
        status: 'SOLD_NASIYA',
      },
    })
    await prisma.$transaction(async (tx) => {
      const nasiya = await tx.nasiya.create({
      data: {
        shopId: actor.shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_500_000,
        downPayment: 250_000,
        baseRemainingAmount: 1_250_000,
        interestAmount: 250_000,
        finalNasiyaAmount: 1_500_000,
        remainingAmount: 1_000_000,
        months: 1,
        monthlyPayment: 1_500_000,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        contractCurrency: 'USD',
        contractExchangeRateAtCreation: 12_500,
        contractTotalAmount: 120,
        contractDownPayment: 20,
        contractBaseRemainingAmount: 100,
        contractInterestAmount: 20,
        contractFinalAmount: 120,
        contractMonthlyPayment: 120,
        contractPaidAmount: 40,
        contractRemainingAmount: 80,
        createdBy: actor.admin.id,
      },
    })
      await tx.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: actor.shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        expectedAmount: 1_500_000,
        paidAmount: 500_000,
        contractCurrency: 'USD',
        contractExpectedAmount: 120,
        contractPaidAmount: 40,
        contractRemainingAmount: 80,
        status: 'PARTIAL',
      },
      })
    })

    const { NextRequest } = await import('next/server')
    const { GET } = await import('@/app/api/export/[entity]/route')
    const csvResponse = await GET(
      new NextRequest('http://localhost/api/export/nasiya?format=csv'),
      { params: Promise.resolve({ entity: 'nasiya' }) },
    )
    const csv = await csvResponse.text()
    expect(csvResponse.status).toBe(200)
    expect(csv).toContain('contractTotalAmount')
    expect(csv).toContain('contractInterestAmount')
    expect(csv).toContain('contractPaidAmount')
    expect(csv).toContain('remainingAmountUzsSnapshot')
    expect(csv).toContain('USD nasiya export customer')
    expect(csv).toContain('$120.00')
    expect(csv).toContain('$80.00')

    const xlsxResponse = await GET(
      new NextRequest('http://localhost/api/export/nasiya?format=xlsx'),
      { params: Promise.resolve({ entity: 'nasiya' }) },
    )
    const xlsx = new Uint8Array(await xlsxResponse.arrayBuffer())
    expect(xlsxResponse.status).toBe(200)
    expect(xlsxResponse.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(xlsx.byteLength).toBeGreaterThan(1_000)
    expect(String.fromCharCode(xlsx[0] ?? 0, xlsx[1] ?? 0)).toBe('PK')
  })
})
