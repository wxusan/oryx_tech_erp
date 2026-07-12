'use client'

import { useCallback, useEffect, useRef } from 'react'
import { signOut } from 'next-auth/react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clearNavigationClientState } from '@/lib/client-events'

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const LOGOUT_EVENT_KEY = 'oryx:last-logout'

type SessionControlsProps = {
  callbackUrl: string
  idleTimeoutMs?: number
}

export function SessionControls({
  callbackUrl,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
}: SessionControlsProps) {
  const timerRef = useRef<number | null>(null)
  const signingOutRef = useRef(false)

  const logout = useCallback(
    (broadcast = true) => {
      if (signingOutRef.current) return
      signingOutRef.current = true

      if (broadcast) {
        try {
          window.localStorage.setItem(LOGOUT_EVENT_KEY, String(Date.now()))
        } catch {
          // localStorage can be unavailable in private/restricted browsers.
        }
      }

      // The callback is a full document navigation, which clears Next's
      // in-memory Router Cache. Remove our cross-tab marker before leaving too.
      clearNavigationClientState()

      void signOut({ callbackUrl })
    },
    [callbackUrl],
  )

  const resetIdleTimer = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => logout(), idleTimeoutMs)
  }, [idleTimeoutMs, logout])

  useEffect(() => {
    const activityEvents: Array<keyof WindowEventMap> = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
    ]

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resetIdleTimer()
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOGOUT_EVENT_KEY) logout(false)
    }

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetIdleTimer, { passive: true })
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorage)
    resetIdleTimer()

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetIdleTimer)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [logout, resetIdleTimer])

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => logout()}
      className="border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
    >
      <LogOut className="size-4" />
      Chiqish
    </Button>
  )
}
