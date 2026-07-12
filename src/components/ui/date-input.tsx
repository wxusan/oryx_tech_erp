'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { caretAfterDigitCount, digitCountBeforeCaret, editableDigitIndex, removeDigitAt } from '@/lib/input-mask'

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
  const yearDefaults = ['2', '0']
  for (let index = 4; index < Math.min(digits.length, 6); index++) digits[index] = yearDefaults[index - 4]
  return digits.join('')
}

export function formatDateDraft(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.')
}

export function applyDateInputEdit(raw: string, caret: number) {
  const digitsBeforeCaret = digitCountBeforeCaret(raw, caret)
  const digits = sanitizeDateDigits(raw)
  const display = formatDateDraft(digits)
  return {
    display,
    caret: caretAfterDigitCount(display, Math.min(digitsBeforeCaret, digits.length)),
  }
}

export function deleteDateDraftDigit(display: string, caret: number, direction: 'backward' | 'forward') {
  const digitIndex = editableDigitIndex(display, caret, direction)
  if (digitIndex == null) return { display, caret }
  const digits = display.replace(/\D/g, '')
  const nextDisplay = formatDateDraft(sanitizeDateDigits(removeDigitAt(digits, digitIndex)))
  return { display: nextDisplay, caret: caretAfterDigitCount(nextDisplay, digitIndex) }
}

export interface DateInputProps extends Omit<React.ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> {
  value: string
  onValueChange: (isoDate: string) => void
}

/** Calendar-day input with a deterministic DD.MM.YYYY mask and ISO value. */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onValueChange, onFocus, onBlur, onKeyDown, ...props },
  forwardedRef,
) {
  const [focused, setFocused] = React.useState(false)
  const [draft, setDraft] = React.useState(() => isoToDateDisplay(value))
  const invalid = draft.length === 10 && dateDisplayToIso(draft) == null
  const errorId = React.useId()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const pendingCaretRef = React.useRef<number | null>(null)

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
  }, [draft])

  React.useEffect(() => {
    if (!focused) setDraft(isoToDateDisplay(value))
  }, [focused, value])

  return (
    <>
    <Input
      {...props}
      ref={setInputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="KK.OO.YYYY"
      maxLength={10}
      value={draft}
      aria-invalid={invalid ? true : props['aria-invalid']}
      aria-errormessage={invalid ? errorId : props['aria-errormessage']}
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
        const next = applyDateInputEdit(event.target.value, event.target.selectionStart ?? event.target.value.length)
        pendingCaretRef.current = next.caret
        setDraft(next.display)
        const iso = dateDisplayToIso(next.display)
        onValueChange(iso ?? '')
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || (event.key !== 'Backspace' && event.key !== 'Delete')) return
        const start = event.currentTarget.selectionStart
        const end = event.currentTarget.selectionEnd
        if (start == null || end == null || start !== end) return
        const next = deleteDateDraftDigit(draft, start, event.key === 'Backspace' ? 'backward' : 'forward')
        if (next.display === draft) return
        event.preventDefault()
        pendingCaretRef.current = next.caret
        setDraft(next.display)
        const iso = dateDisplayToIso(next.display)
        onValueChange(iso ?? '')
      }}
      onPaste={(event) => {
        const pasted = event.clipboardData.getData('text').trim()
        const iso = pasted.match(/^\d{4}-\d{2}-\d{2}$/) ? pasted : dateDisplayToIso(pasted)
        if (!iso || !dateDisplayToIso(isoToDateDisplay(iso))) return
        event.preventDefault()
        const display = isoToDateDisplay(iso)
        pendingCaretRef.current = display.length
        setDraft(display)
        onValueChange(iso)
      }}
      aria-label={props['aria-label']}
    />
      {invalid && <span id={errorId} role="alert" className="sr-only">Sana noto&apos;g&apos;ri. Kun, oy va yilni tekshiring.</span>}
    </>
  )
})
