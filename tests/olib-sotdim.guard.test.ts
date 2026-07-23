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

  it('creates the device directly as SOLD_CASH, SOLD_DEBT, or SOLD_NASIYA, flagged isExternalSourced', () => {
    expect(route).toContain("const deviceStatus = d.customerDealType === 'NASIYA'")
    expect(route).toContain("? 'SOLD_NASIYA' as const")
    expect(route).toContain("? 'SOLD_DEBT' as const : 'SOLD_CASH' as const")
    expect(route).toContain('status: deviceStatus')
    expect(route).toContain('isExternalSourced: true')
    expect(route).not.toContain("status: 'IN_STOCK'")
  })

  it('requires normalized IMEI identity and checks duplicates across both slots', () => {
    expect(route).toContain("Bu IMEI raqami allaqachon mavjud")
    expect(route).toContain('normalizeImei(d.imei)')
    expect(route).toContain('normalizedValue: { in: imeiValues }')
  })

  it('creates an exact Sale or Nasiya outcome behind one Olib operation', () => {
    expect(route).toContain('tx.sale.create')
    expect(route).toContain('createNasiyaContractCore({')
    expect(route).toContain('tx.olibSotdimOperation.create')
    expect(route).toContain('deviceId: device.id')
  })
})

describe('supplier debt is tracked separately from customer debt', () => {
  const schema = read('prisma/schema.prisma')
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('SupplierPayable is its own model, not folded into Sale', () => {
    const supplierPayableBlock = schema.slice(
      schema.indexOf('model SupplierPayable'),
      schema.indexOf('model SupplierPayablePayment'),
    )
    expect(supplierPayableBlock).toContain('amount')
    expect(supplierPayableBlock).toContain('SupplierPayableStatus')
    expect(supplierPayableBlock).toContain('saleId')
    // It references the Sale, but is a distinct table — not a field bag on Sale.
    expect(schema).not.toContain('supplierAmount')
  })

  it('the create route writes Sale.remainingAmount (customer owes us) and SupplierPayable.amount (we owe supplier) independently', () => {
    expect(route).toContain('contractRemainingAmount: contractRemaining')
    expect(route).toContain('createSupplierPayableCore({')
  })
})

describe('supplier paid now vs pay later', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')
  const ledger = read('src/lib/server/supplier-payable-payments.ts')

  it('paid now creates a PAID payable with paidAt + paymentMethod, no reminders', () => {
    expect(route).toContain('supplierPaidNow:')
    expect(route).toContain('supplierInitialRaw = d.supplierPaidNow ? d.purchasePrice')
    expect(ledger).toContain("status: fullyPaid ? 'PAID' : 'PARTIAL'")
    expect(ledger).toContain('reminderEnabled: fullyPaid ? false : input.reminderEnabled')
  })

  it('pay later requires a due date and defaults reminders on', () => {
    expect(route).toContain('dueDate: d.supplierPaidNow ? (d.supplierPaidDate ?? new Date()) : d.supplierDueDate!')
  })
})

describe('mark supplier payable as paid stops reminders', () => {
  const payRoute = read('src/app/api/olib-sotdim/[id]/pay/route.ts')
  const ledger = read('src/lib/server/supplier-payable-payments.ts')
  const cron = read('src/app/api/cron/reminders/route.ts')

  it('pay route flips status to PAID and rejects an already-paid payable', () => {
    expect(payRoute).toContain('recordSupplierPayablePayment({')
    expect(ledger).toContain("const nextStatus = isFullyPaid ? 'PAID' as const")
    expect(ledger).toContain("Bu qarz yopilgan yoki bekor qilingan")
  })

  it('cron reminder queries include every open balance state and naturally exclude PAID payables', () => {
    const openStatusPredicate = "status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }"
    for (const phase of ['SUPPLIER_DUE', 'SUPPLIER_OVERDUE', 'SUPPLIER_EARLY']) {
      const start = cron.indexOf(`'${phase}'`)
      const query = cron.slice(start, cron.indexOf('orderBy:', start))
      expect(query).toContain(openStatusPredicate)
      expect(query).toContain('contractRemainingAmount: { gt: 0 }')
      expect(query).not.toContain("'PAID'")
    }
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
    expect(cron).toContain("dedupeKey: (recipient) => `SUPPLIER_PAYABLE_REMINDER:")
    expect(cron).toContain("dedupeKey: (recipient) => `SUPPLIER_PAYABLE_OVERDUE:")
    expect(cron).toContain("dedupeKey: (recipient) => `SUPPLIER_PAYABLE_EARLY_REMINDER:")
  })

  it('early reminders catch up only when the original trigger day belongs to the watermark window', () => {
    const block = cron.slice(cron.indexOf("'SUPPLIER_EARLY'"), cron.indexOf('if (activeLeaseToken)'))
    expect(block).toContain('earlyTriggerDay(payable.dueDate, payable.earlyReminderDays)')
    expect(block).toContain('isWithin(triggerDay, windowStart, windowEnd)')
  })

  it('unique dedupe keys plus insert-only skipDuplicates prevent replay duplicates', () => {
    expect(cron).toContain('prisma.notification.createMany({ data: rows, skipDuplicates: true })')
    expect(overdueTransition).toContain('tx.notification.createMany({ data: gapMarkers, skipDuplicates: true })')
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
    const recipients = read('src/lib/server/telegram-recipients.ts')
    expect(route).toContain('resolveTelegramRecipients(tx,')
    expect(recipients).toContain('!admin.telegramId || !admin.telegramVerifiedAt')
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

  it('submits both explicit currencies and reuses each operation-scoped converter', () => {
    expect(form).toContain('purchaseInputCurrency,')
    expect(form).toContain('customerInputCurrency,')
    expect(form).toContain("'Idempotency-Key': saleCommand.keyFor(payload)")
    expect(route).toContain('createMoneyInputConverter(d.purchaseInputCurrency)')
    expect(route).toContain('d.customerInputCurrency === d.purchaseInputCurrency')
    expect(route).toContain('await createMoneyInputConverter(d.customerInputCurrency)')
    expect(route).toContain('purchaseInput = convertPurchase(d.purchasePrice)')
    expect(route).toContain('saleInput = convertCustomer(d.salePrice!)')
  })
})

describe('reports: no double-counted inventory cost', () => {
  const stats = read('src/lib/server/shop-stats.ts')
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('inventoryPurchaseCost only sums IN_STOCK devices — SOLD_CASH olib-sotdim devices never enter it', () => {
    expect(stats).toContain("status: 'IN_STOCK'")
  })

  it('freezes the supplier cost and proportional paid margin on the Sale receipt exactly once', () => {
    expect(route).toContain('contractCostBasisAmount: componentPlan.principal')
    expect(route).toContain("accountingReconstructionStatus: 'COMPLETE'")
    expect(route).toContain('contractMarginPaidAmount: initialComponents?.paidAfter.margin ?? 0')
    expect(route).toContain('marginAmountUzs: reporting.margin')
  })
})

describe('search: olib-sotdim list is searchable by supplier/customer/device/IMEI, shop-scoped', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('the GET query is scoped to the resolved shopId', () => {
    const whereBlock = route.slice(
      route.indexOf('export function buildOlibSotdimWhere'),
      route.indexOf('export async function GET'),
    )
    expect(whereBlock).toContain('shopId,')
    expect(whereBlock).toContain('deletedAt: null')
    expect(route).toContain('buildOlibSotdimWhere(shopId, { search, status })')
  })

  it('search matches supplier name/phone, customer name/phone, device model/IMEI', () => {
    const escapedText = String.raw`(?:prepared\.escapedText|search)`
    expect(route).toMatch(new RegExp(`supplierName: \\{ contains: ${escapedText}`))
    expect(route).toMatch(new RegExp(`supplierPhone: \\{ contains: ${escapedText}`))
    expect(route).toMatch(new RegExp(`olibSotdimOperation: \\{ customer: \\{ name: \\{ contains: ${escapedText}`))
    expect(route).toMatch(new RegExp(`olibSotdimOperation: \\{ customer: \\{ phone: \\{ contains: ${escapedText}`))
    expect(route).toMatch(new RegExp(`device: \\{ model: \\{ contains: ${escapedText}`))
    expect(route).toMatch(new RegExp(`device: \\{ imei: \\{ contains: ${escapedText}`))
    expect(route).toContain('normalizedValue: { contains: prepared.identifierDigits }')
    expect(route).toContain('phoneSearchDigits: { contains: prepared.identifierDigits }')
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
  const ledger = read('src/lib/server/supplier-payable-payments.ts')

  it('flips PAID via updateMany with a status guard, not a plain update by id', () => {
    expect(payRoute).toContain('recordSupplierPayablePayment({')
    expect(ledger).toContain('const updated = await tx.supplierPayable.updateMany({')
    expect(ledger).toContain('ledgerVersion: payable.ledgerVersion')
    expect(ledger).toContain("status: { notIn: ['PAID', 'CANCELLED'] }")
  })

  it('rejects with 409 if the atomic flip did not affect exactly one row (already paid by a concurrent request)', () => {
    expect(ledger).toContain('if (updated.count !== 1)')
    expect(ledger).toContain("code: 'P2034'")
    expect(payRoute).toContain('return conflict(error.message)')
  })

  it('allows only PENDING/OVERDUE and cannot transition CANCELLED to PAID', () => {
    expect(ledger).toContain("payable.status === 'PAID' || payable.status === 'CANCELLED'")
    expect(ledger).toContain("status: { notIn: ['PAID', 'CANCELLED'] }")
  })
})
