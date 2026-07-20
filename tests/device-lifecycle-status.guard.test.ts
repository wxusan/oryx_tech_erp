import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('device lifecycle status model', () => {
  it('adds SOLD_DEBT without removing legacy RETURNED', () => {
    const schema = read('prisma/schema.prisma')
    const migration = read('prisma/migrations/202607110001_add_sold_debt_device_status/migration.sql')

    expect(schema).toContain('  SOLD_DEBT')
    expect(schema).toContain('  RETURNED')
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'SOLD_DEBT'")
    expect(migration).not.toMatch(/UPDATE\s+"Device"|DROP TYPE|DELETE FROM/i)
  })

  it('returns cash and debt sales directly to IN_STOCK while keeping a DeviceReturn and audit log', () => {
    const route = read('src/app/api/devices/[id]/return/route.ts')

    expect(route).toContain("['SOLD_CASH', 'SOLD_DEBT']")
    expect(route).toContain('Nasiya shartnomasini bekor qilish')
    expect(route).toContain("data: { status: 'IN_STOCK'")
    expect(route).toContain('tx.deviceReturn.create')
    expect(route).toContain("action: 'RETURN'")
    expect(route).not.toContain("data: { status: 'RETURNED'")
  })

  it('keeps restock available only for legacy RETURNED records', () => {
    const route = read('src/app/api/devices/[id]/restock/route.ts')

    expect(route).toContain("device.status !== 'RETURNED'")
    expect(route).toContain("status: 'RETURNED'")
    expect(route).toContain("data: { status: 'IN_STOCK'")
  })

  it('sets debt status at creation for partial simple sales and restores SOLD_CASH only after final payment', () => {
    const saleRoute = read('src/app/api/devices/[id]/sell/route.ts')
    const paymentRoute = read('src/app/api/sales/[id]/payment/route.ts')
    const olibSotdimRoute = read('src/app/api/olib-sotdim/route.ts')

    expect(saleRoute).toContain("const nextDeviceStatus = contractRemaining > 0 ? 'SOLD_DEBT' : 'SOLD_CASH'")
    expect(saleRoute).toContain('data: { status: nextDeviceStatus')
    expect(olibSotdimRoute).toContain("const deviceStatus = d.customerDealType === 'NASIYA'")
    expect(olibSotdimRoute).toContain("? 'SOLD_NASIYA' as const")
    expect(olibSotdimRoute).toContain("? 'SOLD_DEBT' as const : 'SOLD_CASH' as const")
    expect(paymentRoute).toContain("contractPayment.isFullyPaid && sale.device.status === 'SOLD_DEBT'")
    expect(paymentRoute).toContain("? 'SOLD_CASH'")
  })

  it('keeps nasiya separate and exposes debt status in devices list, filter, labels, and export', () => {
    const nasiyaCore = read('src/lib/server/nasiya-contract-core.ts')
    const list = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')
    const labels = read('src/lib/labels.ts')
    const presentationLabels = read('src/lib/presentation-labels.ts')
    const exportRoute = read('src/app/api/export/[entity]/route.ts')

    expect(nasiyaCore).toContain("data: { status: 'SOLD_NASIYA'")
    expect(list).toContain("{ label: 'Qarzga sotilgan', value: 'SOLD_DEBT' }")
    expect(list).toContain("SOLD_DEBT: 'Qarzga sotilgan'")
    expect(labels).toContain('DEVICE_STATUS_LABELS')
    expect(presentationLabels).toContain("SOLD_DEBT: 'Qarzga sotilgan'")
    expect(exportRoute).toContain('deviceStatusLabel(d.status)')
  })
})
