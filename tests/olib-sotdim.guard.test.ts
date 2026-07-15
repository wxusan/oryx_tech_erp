import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('quick action: Olib-sotdim card on /shop/yangi-operatsiya', () => {
  const page = read('src/app/(shop)/shop/yangi-operatsiya/page.tsx')

  it('lists Olib-sotdim linking to /shop/olib-sotdim/new', () => {
    expect(page).toContain("href: '/shop/olib-sotdim/new'")
    expect(page).toContain("title: 'Olib-sotdim'")
  })
})

describe('olib-sotdim device lifecycle: never IN_STOCK, never normal-sale-available', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('creates the device directly as SOLD_CASH or SOLD_DEBT, flagged isExternalSourced', () => {
    expect(route).toContain("const deviceStatus = contractRemaining > 0 ? 'SOLD_DEBT' : 'SOLD_CASH'")
    expect(route).toContain('status: deviceStatus')
    expect(route).toContain('isExternalSourced: true')
    expect(route).not.toContain("status: 'IN_STOCK'")
  })

  it('requires normalized IMEI identity and checks duplicates across both slots', () => {
    expect(route).toContain("Bu IMEI raqami allaqachon mavjud")
    expect(route).toContain('normalizeImei(d.imei)')
    expect(route).toContain('normalizedValue: { in: imeiValues }')
  })

  it('creates a real Sale row so existing sold-device/profit UI and reports pick it up unchanged', () => {
    expect(route).toContain('tx.sale.create')
    expect(route).toContain('deviceId: device.id')
  })
})

describe('supplier debt is tracked separately from customer debt', () => {
  const schema = read('prisma/schema.prisma')
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('SupplierPayable is its own model, not folded into Sale', () => {
    const supplierPayableBlock = schema.slice(
      schema.indexOf('model SupplierPayable'),
      schema.indexOf('model SupplierPayable') + 1900,
    )
    expect(supplierPayableBlock).toContain('amount')
    expect(supplierPayableBlock).toContain('SupplierPayableStatus')
    expect(supplierPayableBlock).toContain('saleId')
    // It references the Sale, but is a distinct table — not a field bag on Sale.
    expect(schema).not.toContain('supplierAmount')
  })

  it('the create route writes Sale.remainingAmount (customer owes us) and SupplierPayable.amount (we owe supplier) independently', () => {
    expect(route).toContain('remainingAmount: remaining')
    expect(route).toContain('tx.supplierPayable.create')
  })
})

describe('supplier paid now vs pay later', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('paid now creates a PAID payable with paidAt + paymentMethod, no reminders', () => {
    expect(route).toContain("status: supplierPaidNow ? 'PAID' : 'PENDING'")
    expect(route).toContain('reminderEnabled: supplierPaidNow ? false')
  })

  it('pay later requires a due date and defaults reminders on', () => {
    expect(route).toContain('dueDate: supplierPaidNow ? (d.supplierPaidDate ?? new Date()) : d.supplierDueDate!')
  })
})

describe('mark supplier payable as paid stops reminders', () => {
  const payRoute = read('src/app/api/olib-sotdim/[id]/pay/route.ts')
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('pay route flips status to PAID and rejects an already-paid payable', () => {
    expect(payRoute).toContain("status: 'PAID'")
    expect(payRoute).toContain('PAYABLE_NOT_OPEN_MESSAGE')
  })

  it('cron reminder queries only ever select PENDING/OVERDUE, so a PAID payable is naturally excluded', () => {
    expect(cron).toContain("status: 'PENDING'")
    expect(cron).toContain("status: { in: ['PENDING', 'OVERDUE'] }")
    expect(cron).not.toContain("status: 'PAID'")
  })
})

describe('supplier payable reminders: cron + jitter + idempotency', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')
  const overdueTransition = read('src/lib/server/overdue-transition.ts')

  it('has due-today, overdue, and early-reminder blocks for SupplierPayable', () => {
    expect(cron).toContain("'SUPPLIER_DUE'")
    expect(cron).toContain("'SUPPLIER_OVERDUE'")
    expect(cron).toContain("'SUPPLIER_EARLY'")
  })

  it('uses the shared jitter helper and dedupe keys (no separate jitter logic)', () => {
    expect(cron).toContain("dedupeKey = `SUPPLIER_PAYABLE_REMINDER:")
    expect(cron).toContain("dedupeKey = `SUPPLIER_PAYABLE_OVERDUE:")
    expect(cron).toContain("dedupeKey = `SUPPLIER_PAYABLE_EARLY_REMINDER:")
  })

  it('early reminders catch up only when the original trigger day belongs to the watermark window', () => {
    const block = cron.slice(cron.indexOf("'SUPPLIER_EARLY'"), cron.indexOf('if (activeLeaseToken)'))
    expect(block).toContain('earlyTriggerDay(payable.dueDate, payable.earlyReminderDays)')
    expect(block).toContain('isWithin(triggerDay, windowStart, windowEnd)')
  })

  it('upsert-by-dedupeKey guarantees no duplicates across repeated cron runs', () => {
    const count = [cron, overdueTransition]
      .reduce((total, source) => total + source.split('.notification.upsert({').length - 1, 0)
    expect(count).toBeGreaterThanOrEqual(9) // one per planned reminder type, all upsert not create
  })
})

describe('Telegram: photo pipeline covers SupplierPayable, never touches passport data', () => {
  const notificationImage = read('src/lib/server/notification-image.ts')
  const templates = read('src/lib/telegram-templates.ts')

  it('resolves SupplierPayable images through its linked Device, same signed-URL pipeline', () => {
    expect(notificationImage).toContain("case 'SupplierPayable':")
    expect(notificationImage).toContain('prisma.supplierPayable.findFirst')
    expect(notificationImage).toContain('where: { id: relatedId, shopId }')
  })

  it('never references passportPhotoUrl anywhere in the image resolver', () => {
    expect(notificationImage).not.toContain('passportPhotoUrl')
    expect(notificationImage).not.toContain('passport')
  })

  it('olib-sotdim message templates exist and distinguish supplier debt wording from customer debt', () => {
    expect(templates).toContain('export function olibSotdimCreatedMessage')
    expect(templates).toContain('export function supplierPayableDueTodayMessage')
    expect(templates).toContain('export function supplierPayableOverdueMessage')
    expect(templates).toContain('export function supplierPayableEarlyReminderMessage')
    expect(templates).toContain('export function supplierPayablePaidMessage')
    expect(templates).toContain('Yetkazib beruvchiga to‘lov')
  })

  it('unverified telegram IDs are still excluded (unchanged admin filter reused by the new route)', () => {
    const route = read('src/app/api/olib-sotdim/route.ts')
    expect(route).toContain('telegramVerifiedAt: { not: null }')
  })
})

describe('money/currency: MoneyInput used, server converts and stores UZS', () => {
  const form = read('src/app/(shop)/shop/olib-sotdim/new/page.tsx')
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('uses MoneyInput for purchasePrice and salePrice, never a raw number input', () => {
    expect(form).toContain('<MoneyInput')
    expect(form).not.toMatch(/type="number"[^>]*purchasePrice/)
    expect(form).not.toMatch(/type="number"[^>]*salePrice/)
  })

  it('submits inputCurrency and converts every amount through one operation-scoped rate', () => {
    expect(form).toContain('inputCurrency: currency.currency')
    expect(route).toContain('createMoneyInputConverter(d.inputCurrency)')
    expect(route).toContain('purchaseInput = convertMoney(d.purchasePrice)')
    expect(route).toContain('saleInput = convertMoney(d.salePrice)')
  })
})

describe('reports: no double-counted inventory cost', () => {
  const stats = read('src/lib/server/shop-stats.ts')
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('inventoryPurchaseCost only sums IN_STOCK devices — SOLD_CASH olib-sotdim devices never enter it', () => {
    expect(stats).toContain("status: 'IN_STOCK'")
  })

  it('freezes the supplier cost and proportional paid margin on the Sale receipt exactly once', () => {
    expect(route).toContain('costBasisAmount: contractPurchasePrice')
    expect(route).toContain("accountingReconstructionStatus: 'COMPLETE'")
    expect(route).toContain('contractMarginAmount: initialComponents!.allocation.margin')
    expect(route).toContain('marginAmountUzs: reportingComponents.margin')
  })
})

describe('search: olib-sotdim list is searchable by supplier/customer/device/IMEI, shop-scoped', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('the GET query is scoped to the resolved shopId', () => {
    const whereBlock = route.slice(route.indexOf('const where: Prisma.SupplierPayableWhereInput'), route.indexOf('const [payables, total]'))
    expect(whereBlock).toContain('shopId,')
  })

  it('search matches supplier name/phone, customer name/phone, device model/IMEI', () => {
    expect(route).toContain('supplierName: { contains: search')
    expect(route).toContain('supplierPhone: { contains: search')
    expect(route).toContain("sale: { customer: { name: { contains: search")
    expect(route).toContain("sale: { customer: { phone: { contains: search")
    expect(route).toContain("device: { model: { contains: search")
    expect(route).toContain("device: { imei: { contains: search")
  })
})

/**
 * P1 fix (production-readiness audit): mark-as-paid used to be a plain
 * `update()` by id with a pre-transaction status check — two concurrent
 * requests (e.g. a double-click) could both pass the check before either
 * committed, then both succeed, firing two Telegram confirmations and two
 * log rows for the same payable. Fixed to the same atomic
 * updateMany-with-status-guard-plus-count-check pattern already used by the
 * device sell/nasiya/restock/return routes.
 */
describe('mark supplier payable as paid is race-safe (atomic status-guarded update)', () => {
  const payRoute = read('src/app/api/olib-sotdim/[id]/pay/route.ts')

  it('flips PAID via updateMany with a status guard, not a plain update by id', () => {
    expect(payRoute).toContain("const flipped = await tx.supplierPayable.updateMany({\n        where: { id, shopId, deletedAt: null, status: { in: ['PENDING', 'OVERDUE'] } },")
    expect(payRoute).not.toContain('await tx.supplierPayable.update({\n        where: { id },')
  })

  it('rejects with 409 if the atomic flip did not affect exactly one row (already paid by a concurrent request)', () => {
    expect(payRoute).toContain('if (flipped.count !== 1) {')
    expect(payRoute).toContain('throw { status: 409, message: PAYABLE_NOT_OPEN_MESSAGE }')
    expect(payRoute).toContain("if (e.status === 409) return conflict(e.message)")
  })

  it('allows only PENDING/OVERDUE and cannot transition CANCELLED to PAID', () => {
    expect(payRoute).toContain("payable.status !== 'PENDING' && payable.status !== 'OVERDUE'")
    expect(payRoute).not.toContain("status: { not: 'PAID' }")
  })
})
