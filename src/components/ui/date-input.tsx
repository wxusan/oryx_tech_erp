'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'

export function isoToDateDisplay(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : ''
}

export function dateDisplayToIso(value: string): string | null {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!match) return null
  const iso = `${match[3]}-${match[2]}-${match[1]}`
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null
}

export function sanitizeDateDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8).split('')
  if (digits[0] && Number(digits[0]) > 3) digits[0] = '3'
  if (digits.length >= 2 && Number(digits.slice(0, 2).join('')) > 31) digits[1] = '1'
  if (digits[2] && Number(digits[2]) > 1) digits[2] = '1'
  if (digits.length >= 4 && Number(digits.slice(2, 4).join('')) > 12) digits[3] = '2'
  const yearDefaults = ['2', '0']
  for (let index = 4; index < Math.min(digits.length, 6); index++) digits[index] = yearDefaults[index - 4]
  return digits.join('')
}

export function formatDateDraft(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.')
}

export interface DateInputProps extends Omit<React.ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> {
  value: string
  onValueChange: (isoDate: string) => void
}

/** Calendar-day input with a deterministic DD.MM.YYYY mask and ISO value. */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onValueChange, onFocus, onBlur, ...props },
  forwardedRef,
) {
  const [focused, setFocused] = React.useState(false)
  const [draft, setDraft] = React.useState(() => isoToDateDisplay(value))

  React.useEffect(() => {
    if (!focused) setDraft(isoToDateDisplay(value))
  }, [focused, value])

  return (
    <Input
      {...props}
      ref={forwardedRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="KK.OO.YYYY"
      maxLength={10}
      value={draft}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        setDraft(isoToDateDisplay(value))
        onBlur?.(event)
      }}
      onChange={(event) => {
        if (!event.target.value) {
          setDraft('')
          onValueChange('')
          return
        }
        const next = formatDateDraft(sanitizeDateDigits(event.target.value))
        setDraft(next)
        const iso = dateDisplayToIso(next)
        if (iso) onValueChange(iso)
      }}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData('text').trim()
        const iso = pasted.match(/^\d{4}-\d{2}-\d{2}$/) ? pasted : dateDisplayToIso(pasted)
        if (!iso || !dateDisplayToIso(isoToDateDisplay(iso))) return
        event.preventDefault()
        setDraft(isoToDateDisplay(iso))
        onValueChange(iso)
      }}
      aria-label={props['aria-label'] ?? 'Sana, kun oy yil'}
    />
  )
})
