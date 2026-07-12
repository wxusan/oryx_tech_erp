// @vitest-environment jsdom

import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StorageInput, type StorageInputUnit } from '@/components/ui/storage-input'

function Harness() {
  const [amount, setAmount] = useState('256')
  const [unit, setUnit] = useState<StorageInputUnit>('GB')
  return <StorageInput amount={amount} unit={unit} onAmountChange={setAmount} onUnitChange={setUnit} required />
}

describe('StorageInput', () => {
  it('exposes a labeled numeric amount and switches explicitly between GB and TB', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const amount = screen.getByRole('spinbutton', { name: /^Xotira/ })
    expect((amount as HTMLInputElement).value).toBe('256')
    await user.clear(amount)
    await user.type(amount, '1.5')
    expect((amount as HTMLInputElement).value).toBe('1.5')

    await user.click(screen.getByLabelText('Xotira birligi'))
    await user.click(screen.getByRole('option', { name: 'TB' }))
    expect(screen.getByLabelText('Xotira birligi').textContent).toContain('TB')
  })
})
