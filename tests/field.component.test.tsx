// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

afterEach(cleanup)

describe('accessible Field', () => {
  it('associates label, required state, help, invalid state, and error text', () => {
    render(
      <Field label="Telefon" required help="998 dan keyin 9 ta raqam" error="Telefon noto'g'ri">
        <Input />
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Telefon' })
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy).toContain('-help')
    expect(describedBy).toContain('-error')
    expect(screen.getByRole('alert').textContent).toContain("Telefon noto'g'ri")
  })

  it('focuses only the first invalid control', async () => {
    render(
      <>
        <Field label="Birinchi" error="Majburiy"><Input /></Field>
        <Field label="Ikkinchi" error="Majburiy"><Input /></Field>
      </>,
    )

    const first = screen.getByRole('textbox', { name: 'Birinchi' })
    await waitFor(() => expect(document.activeElement).toBe(first))
  })
})
