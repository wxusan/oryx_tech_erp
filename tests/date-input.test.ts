import { describe, expect, it } from 'vitest'
import { dateDisplayToIso, formatDateDraft, isoToDateDisplay, sanitizeDateDigits } from '@/components/ui/date-input'

describe('shared date input mask', () => {
  it('fills day, month and year left-to-right with the required year prefix', () => {
    expect(formatDateDraft(sanitizeDateDigits('3'))).toBe('3')
    expect(formatDateDraft(sanitizeDateDigits('31'))).toBe('31')
    expect(formatDateDraft(sanitizeDateDigits('311'))).toBe('31.1')
    expect(formatDateDraft(sanitizeDateDigits('3110'))).toBe('31.10')
    expect(formatDateDraft(sanitizeDateDigits('31103'))).toBe('31.10.2')
    expect(formatDateDraft(sanitizeDateDigits('311039'))).toBe('31.10.20')
    expect(formatDateDraft(sanitizeDateDigits('31103926'))).toBe('31.10.2026')
  })

  it('round-trips valid ISO calendar days and rejects impossible dates', () => {
    expect(isoToDateDisplay('2026-07-12')).toBe('12.07.2026')
    expect(dateDisplayToIso('12.07.2026')).toBe('2026-07-12')
    expect(dateDisplayToIso('31.02.2026')).toBeNull()
    expect(dateDisplayToIso('29.02.2024')).toBe('2024-02-29')
  })
})
