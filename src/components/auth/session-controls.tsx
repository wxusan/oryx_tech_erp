'use client'

import { useCallback, useEffect, useRef } from 'react'
import { signOut } from 'next-auth/react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clearNavigationClientState } from '@/lib/client-events'

const LOGOUT_EVENT_KEY = 'oryx:last-logout'
const ADMIN_ACTIVITY_KEY = 'oryx:admin-last-activity'

type SessionControlsProps = {
  callbackUrl: string
  /** null disables inactivity logout while retaining explicit logout/revocation. */
  idleTimeoutMs: number | null
}

export function SessionControls({ callbackUrl, idleTimeoutMs }: SessionControlsProps) {
  const timerRef = useRef<number | null>(null)
  const signingOutRef = useRef(false)
  const lastBroadcastRef = useRef(0)
  const lastServerTouchRef = useRef(0)

  const logout = useCallback((broadcast = true) => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    try {
      if (broadcast) window.localStorage.setItem(LOGOUT_EVENT_KEY, String(Date.now()))
      window.localStorage.removeItem(ADMIN_ACTIVITY_KEY)
    } catch {}
    clearNavigationClientState()
    void signOut({ callbackUrl })
  }, [callbackUrl])

  useEffect(() => {
    const handleStorageLogout = (event: StorageEvent) => {
      if (event.key === LOGOUT_EVENT_KEY) logout(false)
    }
    window.addEventListener('storage', handleStorageLogout)
    return () => window.removeEventListener('storage', handleStorageLogout)
  }, [logout])

  useEffect(() => {
    if (idleTimeoutMs == null) return

    const touchServerSession = (now: number) => {
      if (now - lastServerTouchRef.current < 60_000) return
      lastServerTouchRef.current = now
      void fetch('/api/auth/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).then((response) => {
        if (response.status === 401 || response.status === 403) logout()
      }).catch(() => {
        // The exact local inactivity timer remains active during a temporary
        // network failure; a later protected request still enforces the
        // durable server-side deadline.
      })
    }

    const scheduleFrom = (lastActivity: number) => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      const remaining = lastActivity + idleTimeoutMs - Date.now()
      if (remaining <= 0) {
        logout()
        return
      }
      timerRef.current = window.setTimeout(() => logout(), remaining)
    }

    const readLastActivity = () => {
      try {
        const stored = Number(window.localStorage.getItem(ADMIN_ACTIVITY_KEY))
        return Number.isFinite(stored) && stored > 0 ? stored : Date.now()
      } catch { return Date.now() }
    }

    const recordActivity = () => {
      const now = Date.now()
      // Pointer movement and key repeat can be noisy; one cross-tab write per
      // second is sufficient while the local deadline still remains exact.
      if (now - lastBroadcastRef.current < 1000) return
      lastBroadcastRef.current = now
      try { window.localStorage.setItem(ADMIN_ACTIVITY_KEY, String(now)) } catch {}
      scheduleFrom(now)
      touchServerSession(now)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== ADMIN_ACTIVITY_KEY) return
      const timestamp = Number(event.newValue)
      if (Number.isFinite(timestamp)) scheduleFrom(timestamp)
    }
    const checkDeadline = () => {
      if (document.visibilityState === 'visible') scheduleFrom(readLastActivity())
      if (document.visibilityState === 'visible') touchServerSession(Date.now())
    }
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel']
    activityEvents.forEach((name) => window.addEventListener(name, recordActivity, { passive: true }))
    window.addEventListener('storage', handleStorage)
    document.addEventListener('visibilitychange', checkDeadline)

    // Mounting the authenticated admin shell follows a successful login,
    // reload, or intentional navigation. Count that as real activity so a
    // stale timestamp left by a prior session cannot immediately sign out the
    // newly authenticated administrator.
    const initial = Date.now()
    lastBroadcastRef.current = initial
    try {
      window.localStorage.setItem(ADMIN_ACTIVITY_KEY, String(initial))
    } catch {}
    scheduleFrom(initial)
    touchServerSession(initial)

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      activityEvents.forEach((name) => window.removeEventListener(name, recordActivity))
      window.removeEventListener('storage', handleStorage)
      document.removeEventListener('visibilitychange', checkDeadline)
    }
  }, [idleTimeoutMs, logout])

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => logout()} className="border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
      <LogOut className="size-4" />
      Chiqish
    </Button>
  )
}
