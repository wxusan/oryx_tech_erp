import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addNasiyaPaymentSchema } from '@/lib/validations'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nasiyaScheduleId: 'sched_1',
    amount: 500_000,
    paymentMethod: 'CASH',
    date: new Date('2026-07-08'),
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
  })

  it('still accepts a payment when a note is provided', () => {
    const result = addNasiyaPaymentSchema.safeParse(baseInput({ note: "Mijoz naqd to'ladi" }))
    expect(result.success).toBe(true)
  })

  it('still requires a reason (>=5 chars) for the defer/carry-over flow specifically', () => {
    const withoutReason = addNasiyaPaymentSchema.safeParse(
      baseInput({ amount: 0, deferredToNext: true, delayedUntil: new Date('2026-08-08'), note: '' }),
    )
    expect(withoutReason.success).toBe(false)

    const withReason = addNasiyaPaymentSchema.safeParse(
      baseInput({
        amount: 0,
        deferredToNext: true,
        delayedUntil: new Date('2026-08-08'),
        note: "Mijoz 10 kunga so'radi",
      }),
    )
    expect(withReason.success).toBe(true)
  })
})

describe('nasiya payment modal: Izoh is optional in the UI', () => {
  const source = read('src/components/shop/nasiya-payment-modal.tsx')

  it('does not show a required star on Izoh for a regular payment', () => {
    expect(source).toContain('Izoh {carryOver && <span className="text-red-500">*</span>}')
    expect(source).not.toContain('Izoh <span className="text-red-500">*</span>')
  })

  it('canSubmit for a regular payment does not require a note length', () => {
    const canSubmitBlock = source.slice(source.indexOf('const canSubmit ='), source.indexOf('const canSubmit =') + 400)
    // The non-carryOver branch must not gate on payNote length.
    const nonCarryOverBranch = canSubmitBlock.split(': Boolean(')[1] ?? ''
    expect(nonCarryOverBranch).not.toContain('payNote')
  })

  it('the carry-over/defer flow still requires a note (unchanged)', () => {
    expect(source).toContain('payDate.trim() && selectedScheduleId && payNote.trim().length >= 5')
  })

  it('submits an empty note as undefined, never a fake placeholder string', () => {
    expect(source).toContain('note: payNote || undefined')
  })
})

describe('empty note does not break Telegram, logs, or payment history', () => {
  it('nasiyaPaymentMessage omits the Izoh line cleanly via optionalLine/cleanNote', () => {
    const templates = read('src/lib/telegram-templates.ts')
    expect(templates).toContain("optionalLine('Izoh', cleanNote(data.note), '📝')")
  })

  it('the payment route stores a trimmed/undefined note, never a fabricated default', () => {
    const route = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(route).toContain('const auditNote = note?.trim()')
  })

  it('the nasiya detail page renders the payment-history note only when present', () => {
    const detail = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(detail).toContain("payment.note ?? '—'")
  })

  it('the Amallar tarixi note line is conditionally rendered, never a broken empty line', () => {
    const detail = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(detail).toContain('{l.note && <div className="text-xs text-zinc-500 mt-0.5">{l.note}</div>}')
  })
})
