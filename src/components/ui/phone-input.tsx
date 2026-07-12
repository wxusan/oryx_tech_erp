'use client'

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatUzPhoneInputDisplay, normalizeUzPhoneInput } from "@/lib/phone"
import { caretAfterDigitCount, editableDigitIndex, removeDigitAt } from '@/lib/input-mask'

interface PhoneInputProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
}

function localDigitCountBeforeCaret(raw: string, caret: number) {
  const digits = raw.slice(0, Math.max(0, caret)).replace(/\D/g, '')
  return Math.max(0, Math.min(9, digits.startsWith('998') ? digits.length - 3 : digits.length))
}

export function applyPhoneInputEdit(raw: string, caret: number) {
  const value = normalizeUzPhoneInput(raw)
  const display = formatUzPhoneInputDisplay(value)
  const localDigits = localDigitCountBeforeCaret(raw, caret)
  return {
    value,
    display,
    caret: display ? caretAfterDigitCount(display, 3 + localDigits) : 0,
  }
}

export function deletePhoneDigit(display: string, caret: number, direction: 'backward' | 'forward') {
  const digitIndex = editableDigitIndex(display, caret, direction, 3)
  if (digitIndex == null) return { value: normalizeUzPhoneInput(display), display, caret }
  const canonical = normalizeUzPhoneInput(display)
  const local = canonical.replace(/\D/g, '').slice(3)
  const nextLocal = removeDigitAt(local, digitIndex)
  const value = normalizeUzPhoneInput(nextLocal)
  const nextDisplay = formatUzPhoneInputDisplay(value)
  return {
    value,
    display: nextDisplay,
    caret: nextDisplay ? caretAfterDigitCount(nextDisplay, 3 + digitIndex) : 0,
  }
}

/**
 * Drop-in replacement for a raw phone `<Input>` — auto-prefixes the
 * Uzbekistan country code (998) as the user types or pastes, so they only
 * ever need to enter the local 9-digit number. Form state stays canonical
 * (`+998901234567`) while the input renders the familiar grouped format.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, placeholder, onKeyDown, ...props }, forwardedRef) {
    const inputRef = React.useRef<HTMLInputElement | null>(null)
    const pendingCaretRef = React.useRef<number | null>(null)
    const display = formatUzPhoneInputDisplay(value)
    const setInputRef = React.useCallback((node: HTMLInputElement | null) => {
      inputRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    }, [forwardedRef])

    React.useLayoutEffect(() => {
      const input = inputRef.current
      if (pendingCaretRef.current == null || !input || document.activeElement !== input) return
      input.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current)
      pendingCaretRef.current = null
    }, [display])

    return (
      <Input
        ref={setInputRef}
        type="tel"
        inputMode="tel"
        value={display}
        onChange={(event) => {
          const next = applyPhoneInputEdit(event.target.value, event.target.selectionStart ?? event.target.value.length)
          pendingCaretRef.current = next.caret
          onChange(next.value)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented || (event.key !== 'Backspace' && event.key !== 'Delete')) return
          const start = event.currentTarget.selectionStart
          const end = event.currentTarget.selectionEnd
          if (start == null || end == null || start !== end) return
          const next = deletePhoneDigit(display, start, event.key === 'Backspace' ? 'backward' : 'forward')
          if (next.display === display) return
          event.preventDefault()
          pendingCaretRef.current = next.caret
          onChange(next.value)
        }}
        autoComplete="tel"
        maxLength={17}
        placeholder={placeholder ?? '+998 90 123 45 67'}
        {...props}
      />
    )
  },
)
