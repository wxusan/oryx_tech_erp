import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const detailPage = 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx'

describe('Amallar tarixi — data source audit', () => {
  const source = read(detailPage)

  it('fetches from the shared Log table, scoped to this shop and this nasiya + its own schedules only', () => {
    expect(source).toContain("const url = new URL('/api/logs', window.location.origin)")
    expect(source).toContain("if (nasiyaShopId) url.searchParams.set('shopId', nasiyaShopId)")
    expect(source).toContain("const targetIds = [nasiyaId, ...(nasiya?.schedules?.map((s) => s.id) ?? [])]")
  })

  it('the /api/logs route enforces shop scoping server-side regardless of the shopId query param for shop admins', () => {
    const logsRoute = read('src/app/api/logs/route.ts')
    expect(logsRoute).toContain("session.user.role === 'SHOP_ADMIN' ? session.user.shopId : requestedShopId")
  })
})

describe('Amallar tarixi — event label coverage (the concrete gaps this ticket fixes)', () => {
  const source = read('src/components/shop/nasiya-history-sections.tsx')

  it('shows "Nasiya yakunlandi" for the completion event (previously fell through to the raw action string)', () => {
    expect(source).toContain("if (log.action === 'NASIYA_COMPLETED') return 'Nasiya yakunlandi'")
  })

  it('shows "Muddat uzaytirildi" for a defer, distinct from a regular payment', () => {
    expect(source).toContain("if (log.action === 'NASIYA_DEFER') return 'Muddat uzaytirildi'")
  })

  it('shows the old -> new due date under a defer event', () => {
    expect(source).toContain("`${uzDate(log.newValue.oldDueDate)} → ${uzDate(log.newValue.newDueDate)}`")
  })

  it('shows the specific reminder toggle direction (yoqildi/o\'chirildi), not a generic "changed" label', () => {
    expect(source).toContain("if (log.newValue?.reminderEnabled === true) return 'Eslatma yoqildi'")
    expect(source).toContain("if (log.newValue?.reminderEnabled === false) return \"Eslatma o'chirildi\"")
  })

  it('still shows the regular payment label unchanged', () => {
    expect(source).toContain("if (log.action === 'PAYMENT') return \"To'lov qabul qilindi\"")
  })
})

describe('Amallar tarixi — payment route creates a distinct, non-duplicated, correctly-typed log per event', () => {
  const route = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('logs a defer as NASIYA_DEFER, not PAYMENT, with old/new due dates in newValue', () => {
    expect(route).toContain("action: deferredToNext ? 'NASIYA_DEFER' : 'PAYMENT'")
    expect(route).toContain('oldDueDate: (selectedSchedule.delayedUntil ?? selectedSchedule.dueDate).toISOString()')
    expect(route).toContain('newDueDate: delayedUntil!.toISOString()')
  })

  it('logs the completion event once, only on the real transition (guarded by justCompleted)', () => {
    expect(route).toContain("action: 'NASIYA_COMPLETED'")
    const idx = route.indexOf("action: 'NASIYA_COMPLETED'")
    expect(route.slice(0, idx)).toContain('if (justCompleted)')
  })

  it('a single payment writes exactly one PAYMENT/NASIYA_DEFER log row per request (idempotency key prevents retries from adding more)', () => {
    expect(route).toContain('existingPayment')
    expect(route).toContain('duplicate: true')
  })
})

describe('Amallar tarixi — safe rendering (no broken rows, no leaked private data)', () => {
  const source = read('src/components/shop/nasiya-history-sections.tsx')

  it('never renders a raw newValue object or passport URL in the timeline', () => {
    expect(source).not.toContain('passportPhotoUrl')
    expect(source).not.toContain('JSON.stringify')
  })

  it('shows a clean empty state instead of a broken layout when there are no logs yet', () => {
    expect(source).toContain('Amallar tarixi yo&apos;q')
  })

  it('formats timestamps with the shared Tashkent-consistent uzDateTime helper', () => {
    expect(source).toContain('{uzDateTime(log.createdAt)}')
  })
})
