'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { cleanMoneyInput, formatMoneyInput } from '@/lib/money-input-format'
import type { CurrencyCode } from '@/lib/currency'

interface MoneyInputProps {
  /** Clean numeric string held in form state (no spaces), e.g. "1200000" or "1200.5". */
  value: string
  /** Receives the clean numeric string (space-free). Submit with Number(value). */
  onChange: (value: string) => void
  currency?: CurrencyCode
  placeholder?: string
  disabled?: boolean
  className?: string
  required?: boolean
  min?: number
  id?: string
  name?: string
  'aria-invalid'?: boolean
}

/**
 * Money input: type-as-you-go space grouping ("1 000 000"), decimal support
 * ("1 200.50"), NO browser number steppers (it's a text input). The value in
 * state / submitted stays a clean, space-free numeric string.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  required,
  id,
  name,
  ...rest
}: MoneyInputProps) {
  const ref = React.useRef<HTMLInputElement>(null)
  const display = formatMoneyInput(value ?? '')

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const el = event.target
    const rawCaret = el.selectionStart ?? el.value.length
    // How many meaningful chars (digits/dot) sit left of the caret — used to
    // put the caret back in the right place after re-formatting adds spaces.
    const meaningfulBeforeCaret = el.value.slice(0, rawCaret).replace(/[^\d.]/g, '').length

    const clean = cleanMoneyInput(el.value)
    onChange(clean)

    const nextDisplay = formatMoneyInput(clean)
    let caret = 0
    let seen = 0
    while (caret < nextDisplay.length && seen < meaningfulBeforeCaret) {
      if (/[\d.]/.test(nextDisplay[caret])) seen += 1
      caret += 1
    }
    // Controlled value updates on re-render; restore the caret afterwards.
    requestAnimationFrame(() => {
      const node = ref.current
      if (node && document.activeElement === node) {
        node.setSelectionRange(caret, caret)
      }
    })
  }

  return (
    <input
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      aria-invalid={rest['aria-invalid']}
      data-slot="money-input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30',
        className,
      )}
    />
  )
}
