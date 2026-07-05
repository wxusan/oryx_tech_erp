import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const SOTUV = 'src/app/(shop)/shop/sotuv/new/page.tsx'
const NASIYA = 'src/app/(shop)/shop/nasiyalar/new/page.tsx'

describe('stepper is clickable for previous steps (both flows)', () => {
  for (const file of [SOTUV, NASIYA]) {
    const src = read(file)

    it(`${file}: renders step items as type="button" (never submit) with a goToStep handler`, () => {
      expect(src).toContain('function goToStep')
      // Only previous (completed) steps navigate.
      expect(src).toContain('if (n < step) setStep(n)')
      expect(src).toContain('onClick={() => goToStep(')
      expect(src).toContain("aria-current={")
    })

    it(`${file}: page "Orqaga" steps back within the flow before leaving the page`, () => {
      expect(src).toContain('function handleBack')
      expect(src).toContain('onClick={handleBack}')
      // Falls back to the operation picker only when already on step 1.
      expect(src).toContain("router.push('/shop/yangi-operatsiya')")
    })

    it(`${file}: "O'zgartirish" returns to the device-selection step (step 1)`, () => {
      expect(src).toContain('onClick={() => setStep(1)}')
    })
  }
})

describe('cash sale: back navigation and phone validation', () => {
  const src = read(SOTUV)

  it('validates phone format on submit and shows it inline (not only server-side)', () => {
    expect(src).toContain('if (!isValidPhone(customerPhone)) {')
    expect(src).toContain('setPhoneError(PHONE_ERROR)')
    expect(src).toContain('phoneRef.current?.focus()')
    // Inline error element under the phone input.
    expect(src).toContain('{phoneError && <p')
  })

  it('clears the phone error as soon as the user edits the field', () => {
    expect(src).toContain('if (phoneError) setPhoneError(')
  })
})

describe('nasiya: phone validated on the customer step, before step 3', () => {
  const src = read(NASIYA)

  it('gates step 2 -> step 3 through a validating handler', () => {
    expect(src).toContain('function handleContinueToTerms')
    expect(src).toContain('onClick={handleContinueToTerms}')
    // The continue handler blocks on an invalid phone and does not advance.
    const fn = src.slice(src.indexOf('function handleContinueToTerms'), src.indexOf('function handleContinueToTerms') + 600)
    expect(fn).toContain('isValidPhone(customerPhone)')
    expect(fn).toContain('setPhoneError(PHONE_ERROR)')
    expect(fn).toContain('setStep(3)')
    // setStep(3) is guarded — it must come after the validation `return`.
    expect(fn.indexOf('return')).toBeLessThan(fn.indexOf('setStep(3)'))
  })

  it('shows the phone error inline under the Mijoz tel input', () => {
    expect(src).toContain('{phoneError && <p')
    expect(src).toContain('aria-invalid={!!phoneError}')
  })

  it('keeps the shared phone rule (imports the helper, no ad-hoc regex)', () => {
    expect(src).toContain("import { isValidPhone, PHONE_ERROR } from '@/lib/phone'")
  })
})
