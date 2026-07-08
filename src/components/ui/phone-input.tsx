'use client'

import * as React from "react"
import { Input } from "@/components/ui/input"
import { applyPhonePrefix } from "@/lib/phone"

interface PhoneInputProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
}

/**
 * Drop-in replacement for a raw phone `<Input>` — auto-prefixes the
 * Uzbekistan country code (998) as the user types or pastes, so they only
 * ever need to enter the local 9-digit number. See src/lib/phone.ts's
 * `applyPhonePrefix` for the exact normalization rules.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, placeholder, ...props }, ref) {
    return (
      <Input
        ref={ref}
        type="tel"
        inputMode="tel"
        value={value}
        onChange={(e) => onChange(applyPhonePrefix(e.target.value))}
        placeholder={placeholder ?? '+998 90 123 45 67'}
        {...props}
      />
    )
  },
)
