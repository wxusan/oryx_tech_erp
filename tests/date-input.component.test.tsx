// @vitest-environment jsdom

import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateInput } from '@/components/ui/date-input'

afterEach(cleanup)

function DateHarness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = React.useState(initial)
  return (
    <>
      <DateInput aria-label="To'lov sanasi" value={value} onValueChange={setValue} />
      <output data-testid="iso-value">{value}</output>
    </>
  )
}

describe('DateInput component behavior', () => {
  it('types day, month, and year from left to right and emits ISO date-only', async () => {
    const user = userEvent.setup()
    render(<DateHarness />)
    const input = screen.getByLabelText("To'lov sanasi") as HTMLInputElement

    await user.type(input, '31102026')

    expect(input.value).toBe('31.10.2026')
    expect(screen.getByTestId('iso-value').textContent).toBe('2026-10-31')
    expect(input.selectionStart).toBe(10)
  })

  it('supports full selection replacement and valid ISO paste', async () => {
    const user = userEvent.setup()
    render(<DateHarness initial="2026-07-12" />)
    const input = screen.getByLabelText("To'lov sanasi") as HTMLInputElement
    input.focus()
    input.setSelectionRange(0, input.value.length)
    await user.paste('2024-02-29')

    expect(input.value).toBe('29.02.2024')
    expect(screen.getByTestId('iso-value').textContent).toBe('2024-02-29')
    expect(input.selectionStart).toBe(10)
  })

  it('deletes a digit across a separator instead of trapping the caret', async () => {
    const user = userEvent.setup()
    render(<DateHarness initial="2026-10-31" />)
    const input = screen.getByLabelText("To'lov sanasi") as HTMLInputElement
    input.focus()
    input.setSelectionRange(3, 3)
    await user.keyboard('{Backspace}')

    expect(input.value).not.toBe('31.10.2026')
    expect(input.selectionStart).toBeLessThan(input.value.length)
  })

  it('marks a complete impossible date invalid and never emits it', async () => {
    const user = userEvent.setup()
    render(<DateHarness />)
    const input = screen.getByLabelText("To'lov sanasi") as HTMLInputElement
    await user.type(input, '31022026')

    expect(input.value).toBe('31.02.2026')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('iso-value').textContent).toBe('')
  })

  it('clears a previously valid parent value while an invalid replacement is being edited', () => {
    render(<DateHarness initial="2026-07-12" />)
    const input = screen.getByLabelText("To'lov sanasi") as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '32012026', selectionStart: 8 } })

    expect(input.value).toBe('32.01.2026')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('iso-value').textContent).toBe('')
  })
})
