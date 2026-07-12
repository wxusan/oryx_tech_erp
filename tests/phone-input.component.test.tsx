// @vitest-environment jsdom

import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhoneInput } from '@/components/ui/phone-input'

afterEach(cleanup)

function PhoneHarness() {
  const [value, setValue] = React.useState('')
  return (
    <>
      <PhoneInput aria-label="Telefon" value={value} onChange={setValue} />
      <output data-testid="canonical-phone">{value}</output>
    </>
  )
}

describe('PhoneInput component behavior', () => {
  it('caps the local number at nine digits while retaining canonical form', async () => {
    const user = userEvent.setup()
    render(<PhoneHarness />)
    const input = screen.getByLabelText('Telefon') as HTMLInputElement
    await user.type(input, '9012345678')

    expect(input.value).toBe('+998 90 123 45 67')
    expect(screen.getByTestId('canonical-phone').textContent).toBe('+998901234567')
    expect(input.selectionStart).toBe(input.value.length)
  })

  it('pastes an already-prefixed number without duplicating 998', async () => {
    const user = userEvent.setup()
    render(<PhoneHarness />)
    const input = screen.getByLabelText('Telefon') as HTMLInputElement
    await user.click(input)
    await user.paste('+998 90 123 45 67')

    expect(input.value).toBe('+998 90 123 45 67')
    expect(screen.getByTestId('canonical-phone').textContent).toBe('+998901234567')
  })

  it('backspaces across formatting spaces and preserves a middle caret', async () => {
    const user = userEvent.setup()
    render(<PhoneHarness />)
    const input = screen.getByLabelText('Telefon') as HTMLInputElement
    await user.type(input, '901234567')
    input.setSelectionRange(7, 7)
    await user.keyboard('{Backspace}')

    expect(screen.getByTestId('canonical-phone').textContent).toBe('+99891234567')
    expect(input.selectionStart).toBeLessThan(input.value.length)
  })
})
