'use client'

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatUzPhoneDisplay, normalizeUzPhoneInput } from "@/lib/phone"

interface PhoneInputProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
}

/**
 * Drop-in replacement for a raw phone `<Input>` — auto-prefixes the
 * Uzbekistan country code (998) as the user types or pastes, so they only
 * ever need to enter the local 9-digit number. Form state stays canonical
 * (`+998901234567`) while the input renders the familiar grouped format.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, placeholder, ...props }, ref) {
    return (
      <Input
        ref={ref}
        type="tel"
        inputMode="tel"
        value={formatUzPhoneDisplay(value)}
        onChange={(e) => onChange(normalizeUzPhoneInput(e.target.value))}
        autoComplete="tel"
        placeholder={placeholder ?? '+998 90 123 45 67'}
        {...props}
      />
    )
  },
)
