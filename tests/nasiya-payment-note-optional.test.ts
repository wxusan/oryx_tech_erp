import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addNasiyaPaymentSchema, addSalePaymentSchema, deferNasiyaScheduleSchema } from '@/lib/validations'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nasiyaScheduleId: 'sched_1',
    amount: 500_000,
    paymentMethod: 'CASH',
    date: new Date('2026-07-08'),
    inputCurrency: 'UZS',
    ...overrides,
  }
}

describe('addNasiyaPaymentSchema — Izoh is optional for a regular payment', () => {
  it('accepts a payment with no note at all', () => {
    const result = addNasiyaPaymentSchema.safeParse(baseInput())
    expect(result.success).toBe(true)
  })

  it('accepts a payment with an empty-string note', () => {
    const result = addNasiyaPaymentSchema.safeParse(baseInput({ note: '' }))
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.note).toBeUndefined()
  })

  it('still accepts a payment when a note is provided', () => {
    const result = addNasiyaPaymentSchema.safeParse(baseInput({ note: "Mijoz naqd to'ladi" }))
    expect(result.success).toBe(true)
  })

  it('the separate defer command permits no ordinary comment and normalizes a blank one', () => {
    const withoutReason = deferNasiyaScheduleSchema.safeParse({
      nasiyaScheduleId: 'sched_1',
      newDueDate: new Date('2026-08-08'),
      reason: '',
    })
    expect(withoutReason.success).toBe(true)
    if (withoutReason.success) expect(withoutReason.data.reason).toBeUndefined()

    const withReason = deferNasiyaScheduleSchema.safeParse({
      nasiyaScheduleId: 'sched_1',
      newDueDate: new Date('2026-08-08'),
      reason: "Mijoz 10 kunga so'radi",
    })
    expect(withReason.success).toBe(true)
  })

  it('normalizes blank cash-sale payment comments too', () => {
    const result = addSalePaymentSchema.safeParse({
      amount: 500_000,
      paymentMethod: 'CASH',
      note: '   ',
      reason: '',
      inputCurrency: 'UZS',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.note).toBeUndefined()
      expect(result.data.reason).toBeUndefined()
    }
  })
})

describe('nasiya payment modal: Izoh is optional in the UI', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('does not show a required star on Izoh for a regular payment', () => {
    expect(source).toContain('<Field label="Izoh">')
  })

  it('canSubmit for a regular payment does not require a note length', () => {
    const canSubmitBlock = source.slice(source.indexOf('const canSubmit ='), source.indexOf('const canSubmit =') + 400)
    expect(canSubmitBlock).not.toContain('payNote')
  })

  it('submits an empty note as undefined, never a fake placeholder string', () => {
    expect(source).toContain('note: payNote || undefined')
  })
})

describe('nasiya deferral modal: Izoh is optional in the UI', () => {
  const source = read('src/components/shop/nasiya-defer-modal.tsx')

  it('does not render a required marker or gate submission on a comment', () => {
    expect(source).toContain('<Field label="Izoh">')
    expect(source).toContain('const canSubmit = Boolean(selected && newDueDate)')
    expect(source).toContain('reason: reason.trim() || undefined')
  })
})

describe('empty note does not break Telegram, logs, or payment history', () => {
  it('nasiyaPaymentMessage omits the Izoh line cleanly via optionalLine/cleanNote', () => {
    const templates = read('src/lib/telegram-templates.ts')
    expect(templates).toContain("optionalLine('Izoh', cleanNote(data.note), '📝')")
  })

  it('the payment route stores a trimmed/undefined note, never a fabricated default', () => {
    const route = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(route).toContain('const auditNote = note?.trim() || undefined')
    const saleRoute = read('src/app/api/sales/[id]/payment/route.ts')
    expect(saleRoute).toContain('const auditNote = parsed.data.reason?.trim() || parsed.data.note?.trim() || undefined')
    expect(saleRoute).not.toContain('if (!auditNote)')
  })

  it('deferral stores an optional empty comment as NULL while preserving its immutable event', () => {
    const route = read('src/app/api/nasiya/[id]/defer/route.ts')
    expect(route).toContain('note: reason ?? null')
    expect(route).toContain('auditReason: reason ?? null')
  })

  it('the nasiya detail page renders the payment-history note only when present', () => {
    const detail = read('src/components/shop/nasiya-history-sections.tsx')
    expect(detail).toContain("payment.note ?? '—'")
  })

  it('the Amallar tarixi note line is conditionally rendered, never a broken empty line', () => {
    const detail = read('src/components/shop/nasiya-history-sections.tsx')
    expect(detail).toContain('{log.note && <div className="mt-0.5 text-xs text-zinc-500">{log.note}</div>}')
  })
})
