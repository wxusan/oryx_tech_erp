import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level GUARDS for the "safe editability" pass. Behavioural coverage needs
// a live DB/session (see integration.todo.test.ts); these fail loudly if a safety
// property is reverted: tenant scoping, audit logging, cache invalidation, and the
// money/history locks that keep this ERP auditable.

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

/** Extract the body of a `const <name> = z.object({ ... })` from collapsed source. */
function schemaBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = z.object({`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const from = src.indexOf('{', start)
  let depth = 0
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(from, i + 1)
    }
  }
  throw new Error(`unterminated schema ${name}`)
}

describe('device edit safety guard', () => {
  const src = read('src/app/api/devices/[id]/route.ts')

  it('scopes shop admins to their own shop', () => {
    expect(src).toContain("session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}")
  })

  it('locks the purchase price once a device is financially linked', () => {
    expect(src).toContain('isFinanciallyLinked && updateData.purchasePrice !== undefined')
  })

  it('validates active-IMEI uniqueness and backstops on the DB partial unique index', () => {
    expect(src).toContain("where: { shopId: existing.shopId, imei: updateData.imei, deletedAt: null, id: { not: deviceId } }")
    expect(src).toContain("err.code === 'P2002'")
  })

  it('requires a reason when editing a sold / nasiya device and writes an audit log', () => {
    expect(src).toContain('hasDeviceChanges && isFinanciallyLinked')
    expect(src).toContain('tx.log.create')
    expect(src).toContain("action: 'UPDATE'")
  })

  it('invalidates device/stat/report/log caches', () => {
    expect(src).toContain('invalidateShopDeviceMutation(existing.shopId)')
  })
})

describe('nasiya edit safety guard', () => {
  const src = read('src/app/api/nasiya/[id]/route.ts')

  it('only accepts the safe note field — never financial terms', () => {
    const schema = schemaBody(src, 'updateNasiyaSchema')
    expect(schema).toContain('note:')
    // Dangerous money fields must NOT be editable inputs in the PATCH schema.
    for (const field of [
      'finalNasiyaAmount',
      'remainingAmount',
      'paidAmount',
      'interestPercent',
      'downPayment',
      'monthlyPayment',
      'expectedAmount',
    ]) {
      expect(schema).not.toContain(field)
    }
  })

  it('is shop-scoped, audit-logged and cache-invalidated', () => {
    expect(src).toContain("session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}")
    expect(src).toContain('tx.log.create')
    expect(src).toContain('invalidateShopReminderMutation(existing.shopId)')
  })
})

describe('payment append-only guard', () => {
  it('nasiya payments are never raw-edited or deleted (no PATCH/DELETE/update handlers)', () => {
    const src = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(src).not.toMatch(/export async function (PATCH|DELETE|PUT)\b/)
    // The only nasiyaPayment mutation is an append (create), never an amount update.
    expect(src).not.toContain('nasiyaPayment.update')
    expect(src).not.toContain('nasiyaPayment.delete')
  })

  it('sale payments are never raw-edited or deleted', () => {
    const src = read('src/app/api/sales/[id]/payment/route.ts')
    expect(src).not.toMatch(/export async function (PATCH|DELETE|PUT)\b/)
    expect(src).not.toContain('salePayment.update')
    expect(src).not.toContain('salePayment.delete')
  })
})

describe('shop profile self-edit safety guard', () => {
  const src = read('src/app/api/shop/profile/route.ts')

  it('restricts a shop admin to their own shop id from the session', () => {
    expect(src).toContain("session.user.role !== 'SHOP_ADMIN'")
    expect(src).toContain('const shopId = session.user.shopId')
  })

  it('never accepts super-admin-controlled fields (status, subscription, shopNumber)', () => {
    const schema = schemaBody(src, 'updateShopProfileSchema')
    for (const field of ['status', 'subscriptionDue', 'shopNumber', 'telegramGroupId', 'deletedAt']) {
      // These must not be part of the editable input schema.
      expect(schema).not.toContain(field)
    }
    expect(src).toContain('invalidateShopProfileMutation(shopId)')
    expect(src).toContain('tx.log.create')
  })
})

describe('profile edit audit guards', () => {
  it('shop admin name/phone edit writes an audit log', () => {
    const src = read('src/app/api/shop-admin/profile/route.ts')
    expect(src).toContain('const updateProfileSchema = z.object({')
    expect(src).toContain("targetType: 'ShopAdmin'")
  })

  it('super admin name edit writes an audit log and cannot change role/id', () => {
    const src = read('src/app/api/admin/profile/route.ts')
    expect(src).toContain('const updateProfileSchema = z.object({')
    expect(src).toContain("targetType: 'SuperAdmin'")
    // role/id are not part of the editable schema.
    expect(src).not.toContain('role: z.')
  })
})
