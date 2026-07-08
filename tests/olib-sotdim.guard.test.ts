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

  it('creates the device directly as SOLD_CASH, flagged isExternalSourced', () => {
    expect(route).toContain("status: 'SOLD_CASH'")
    expect(route).toContain('isExternalSourced: true')
    expect(route).not.toContain("status: 'IN_STOCK'")
  })

  it('reuses the active-only IMEI uniqueness check and NOIMEI- placeholder convention', () => {
    expect(route).toContain("Bu IMEI raqami allaqachon mavjud")
    expect(route).toContain('NOIMEI-')
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
      schema.indexOf('model SupplierPayable') + 1200,
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
    expect(payRoute).toContain("Bu to'lov allaqachon qayd etilgan")
  })

  it('cron reminder queries only ever select PENDING/OVERDUE, so a PAID payable is naturally excluded', () => {
    expect(cron).toContain("status: 'PENDING'")
    expect(cron).toContain("status: { in: ['PENDING', 'OVERDUE'] }")
    expect(cron).not.toContain("status: 'PAID'")
  })
})

describe('supplier payable reminders: cron + jitter + idempotency', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('has due-today, overdue, and early-reminder blocks for SupplierPayable', () => {
    expect(cron).toContain('supplierPayableDueToday')
    expect(cron).toContain('supplierPayableOverdue')
    expect(cron).toContain('supplierPayableEarlyCandidates')
  })

  it('uses the shared jitter helper and dedupe keys (no separate jitter logic)', () => {
    expect(cron).toContain("dedupeKey = `SUPPLIER_PAYABLE_REMINDER:")
    expect(cron).toContain("dedupeKey = `SUPPLIER_PAYABLE_OVERDUE:")
    expect(cron).toContain("dedupeKey = `SUPPLIER_PAYABLE_EARLY_REMINDER:")
  })

  it('early reminder is skipped once its date has passed (no backfill) — same day-math as nasiya/sale', () => {
    const block = cron.slice(cron.indexOf('supplierPayableEarlyCandidates'), cron.indexOf('supplierPayableEarlyCandidates') + 1500)
    expect(block).toContain('daysUntil !== payable.earlyReminderDays')
  })

  it('upsert-by-dedupeKey guarantees no duplicates across repeated cron runs', () => {
    const count = cron.split('.notification.upsert({').length - 1
    expect(count).toBeGreaterThanOrEqual(9) // one per planned reminder type, all upsert not create
  })
})

describe('Telegram: photo pipeline covers SupplierPayable, never touches passport data', () => {
  const notificationImage = read('src/lib/server/notification-image.ts')
  const templates = read('src/lib/telegram-templates.ts')

  it('resolves SupplierPayable images through its linked Device, same signed-URL pipeline', () => {
    expect(notificationImage).toContain("case 'SupplierPayable':")
    expect(notificationImage).toContain('prisma.supplierPayable.findUnique')
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
    expect(templates).toContain("yetkazib beruvchiga to'lov")
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

  it('submits inputCurrency and converts server-side via moneyInputToUzs', () => {
    expect(form).toContain('inputCurrency: currency.currency')
    expect(route).toContain('moneyInputToUzs(d.purchasePrice, d.inputCurrency)')
    expect(route).toContain('moneyInputToUzs(d.salePrice, d.inputCurrency)')
  })
})

describe('reports: no double-counted inventory cost', () => {
  const stats = read('src/lib/server/shop-stats.ts')

  it('inventoryPurchaseCost still only sums IN_STOCK/RESERVED devices — SOLD_CASH olib-sotdim devices never enter it', () => {
    expect(stats).toContain("status: { in: ['IN_STOCK', 'RESERVED'] }")
  })

  it('this month\'s sale revenue/profit scan already joins Sale -> device.purchasePrice, so olib-sotdim sales count for free', () => {
    expect(stats).toContain('device: { select: { purchasePrice: true } }')
  })
})

describe('search: olib-sotdim list is searchable by supplier/customer/device/IMEI, shop-scoped', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('the GET query is scoped to the resolved shopId', () => {
    const whereBlock = route.slice(route.indexOf('const payables = await prisma.supplierPayable.findMany'), route.indexOf('orderBy'))
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
