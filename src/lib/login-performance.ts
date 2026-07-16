'use client'

type LoginSurface = 'admin' | 'shop'

const LOGIN_RESPONSE_STORAGE_KEY = 'oryx:login-authenticated-response'

function userTimingAvailable() {
  return typeof performance !== 'undefined'
    && typeof performance.mark === 'function'
    && typeof performance.measure === 'function'
    && typeof performance.clearMarks === 'function'
}

export function beginLoginSubmitTiming(surface: LoginSurface) {
  const mark = `oryx:login-submit:${surface}:${Date.now()}`
  if (userTimingAvailable()) performance.mark(mark)
  return mark
}

/** Records only timing metadata, never credentials or authentication state. */
export function completeLoginSubmitTiming(surface: LoginSurface, mark: string, authenticated: boolean) {
  if (userTimingAvailable()) {
    try {
      performance.measure('oryx:login-submit-to-response', mark)
    } catch {
      // User Timing is observability only.
    } finally {
      performance.clearMarks(mark)
    }
  }
  if (!authenticated || typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(LOGIN_RESPONSE_STORAGE_KEY, JSON.stringify({ surface, respondedAt: Date.now() }))
  } catch {
    // Private/restricted contexts can still complete the login normally.
  }
}

/** Marks the first hydrated authenticated shell after a successful login. */
export function measureAuthenticatedShellUsable(surface: LoginSurface) {
  if (typeof window === 'undefined') return
  try {
    const raw = window.sessionStorage.getItem(LOGIN_RESPONSE_STORAGE_KEY)
    window.sessionStorage.removeItem(LOGIN_RESPONSE_STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { surface?: unknown; respondedAt?: unknown }
    if (saved.surface !== surface || typeof saved.respondedAt !== 'number') return
    const duration = Math.max(0, Date.now() - saved.respondedAt)
    if (!userTimingAvailable()) return
    performance.measure('oryx:login-response-to-usable-shell', { start: 0, duration })
  } catch {
    // Login functionality must not depend on browser performance/storage APIs.
  }
}
