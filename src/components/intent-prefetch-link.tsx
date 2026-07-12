'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ComponentProps } from 'react'

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch'> & {
  intentDelayMs?: number
}
/**
 * Expensive row details are not prefetched just because 25 links rendered.
 * A short hover dwell, keyboard focus, or touch intent opts that one link
 * back into Next's normal prefetching behavior.
 */
export function IntentPrefetchLink({
  intentDelayMs = 80,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps) {
  const [intent, setIntent] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearIntentTimer() {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearIntentTimer, [])

  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        clearIntentTimer()
        timerRef.current = setTimeout(() => setIntent(true), intentDelayMs)
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event)
        clearIntentTimer()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        clearIntentTimer()
        setIntent(true)
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        clearIntentTimer()
        setIntent(true)
      }}
    />
  )
}
