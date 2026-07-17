import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('human-readable exports use approved display labels', () => {
  const shopExport = readFileSync('src/app/api/export/[entity]/route.ts', 'utf8')
  const adminPaymentsExport = readFileSync('src/app/api/admin/payments/route.ts', 'utf8')

  it('formats nasiya, supplier, return, and log code values', () => {
    expect(shopExport).toContain('nasiyaResolutionLabel(n.resolutionState)')
    expect(shopExport).toContain('nasiyaResolutionEventLabel(resolution.eventType)')
    expect(shopExport).toContain('exchangeRateSourceLabel(n.importSource)')
    expect(shopExport).toContain('supplierPayableStatusLabel(item.status)')
    expect(shopExport).toContain('sourcePaymentMethod: paymentMethodLabel(allocation.sourcePaymentMethod)')
    expect(shopExport).toContain('actorTypeLabel(log.actorType)')
    expect(shopExport).toContain('logActionLabel(log.action, log.targetType)')
    expect(shopExport).toContain('logTargetLabel(log.targetType)')
  })

  it('formats admin payment reconstruction, currency, and method values', () => {
    expect(adminPaymentsExport).toContain('accountingReconstructionLabel(row.currencyReconstructionStatus)')
    expect(adminPaymentsExport).toContain('currencyLabel(row.currency)')
    expect(adminPaymentsExport).toContain('paymentMethodLabel(row.paymentMethod)')
  })
})
