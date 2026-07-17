'use client'

import { Suspense, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { beginLoginSubmitTiming, completeLoginSubmitTiming } from '@/lib/login-performance'

type LoginMode = 'admin' | 'shop'
type ValidatedSession = { role?: string }

function LoginFormInner({ mode }: { mode: LoginMode }) {
  const searchParams = useSearchParams()
  // The shop root performs the final role-aware redirect: owners land on the
  // dashboard, while workers start directly in their operational workflow.
  const fallbackUrl = mode === 'admin' ? '/admin' : '/shop'
  const allowedPrefix = mode === 'admin' ? '/admin' : '/shop'
  const callbackUrl = searchParams.get('callbackUrl') || fallbackUrl
  const safeCallbackUrl = callbackUrl.startsWith(allowedPrefix) ? callbackUrl : fallbackUrl
  const errorParam = searchParams.get('error')
  const [form, setForm] = useState({ login: '', password: '', rememberMe: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'unauthorized' ? "Ruxsat yo'q. Iltimos, to'g'ri hisobdan kiring." : null,
  )

  const isAdmin = mode === 'admin'

  useEffect(() => {
    let cancelled = false

    async function redirectIfSignedIn() {
      try {
        // `/api/auth/session` only verifies that the JWT can be decoded. A
        // JWT can outlive the durable session after idle expiry, a password
        // reset, or a permission change; redirecting on it would bounce the
        // user between this page and the protected route forever.
        const response = await fetch('/api/auth/validate-session', { cache: 'no-store' })
        if (!response.ok) return
        const session = (await response.json()) as ValidatedSession
        if (cancelled) return

        const expectedRole = isAdmin ? 'SUPER_ADMIN' : 'SHOP_ADMIN'
        if (session.role === expectedRole) {
          window.location.replace(safeCallbackUrl)
        }
      } catch {
        // Stay on the login page if the session check cannot complete.
      }
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return
      setForm({ login: '', password: '', rememberMe: false })
      setError(null)
      setLoading(false)
      void redirectIfSignedIn()
    }

    window.addEventListener('pageshow', handlePageShow)

    return () => {
      cancelled = true
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [isAdmin, safeCallbackUrl])

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    const loginTimingMark = beginLoginSubmitTiming(mode)

    const result = await signIn(isAdmin ? 'superadmin' : 'shopadmin', {
      login: form.login,
      password: form.password,
      ...(!isAdmin ? { rememberMe: form.rememberMe ? 'true' : 'false' } : {}),
      redirect: false,
    })
    completeLoginSubmitTiming(mode, loginTimingMark, !result?.error)

    setLoading(false)
    if (result?.error) {
      setForm((current) => ({ ...current, password: '' }))
      setError("Login yoki parol noto'g'ri.")
      return
    }

    window.location.assign(safeCallbackUrl)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-8 pb-6 pt-8">
          <div className="text-lg font-bold tracking-tight text-zinc-900">Oryx ERP</div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {isAdmin ? 'Bosh administrator kirishi' : 'Do‘kon foydalanuvchisi kirishi'}
          </div>
        </div>

        <div className="px-8 py-6">
          {error && (
            <div className="mb-4 border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor={`${mode}-login`} className="mb-1.5 block text-xs font-medium text-zinc-700">
                Login
              </Label>
              <Input
                id={`${mode}-login`}
                type="text"
                placeholder={isAdmin ? 'Admin loginini kiriting' : "Do'kon loginini kiriting"}
                value={form.login}
                onChange={(event) => {
                  setForm({ ...form, login: event.target.value })
                  setError(null)
                }}
                autoComplete="username"
                required
                className="h-9 rounded-none border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </div>

            <div>
              <Label htmlFor={`${mode}-password`} className="mb-1.5 block text-xs font-medium text-zinc-700">
                Parol
              </Label>
              <Input
                id={`${mode}-password`}
                type="password"
                placeholder="Parolni kiriting"
                value={form.password}
                onChange={(event) => {
                  setForm({ ...form, password: event.target.value })
                  setError(null)
                }}
                autoComplete="current-password"
                required
                className="h-9 rounded-none border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </div>

            {!isAdmin && (
              <label htmlFor="shop-remember-me" className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700">
                <input
                  id="shop-remember-me"
                  type="checkbox"
                  checked={form.rememberMe}
                  onChange={(event) => setForm({ ...form, rememberMe: event.target.checked })}
                  className="size-4 rounded border-zinc-300 accent-zinc-900"
                />
                Meni eslab qol
              </label>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="h-9 w-full rounded-none bg-zinc-900 text-sm text-white hover:bg-zinc-800"
            >
              {loading ? 'Kirish...' : 'Kirish'}
            </Button>
          </form>
        </div>

        <div className="px-8 pb-6 text-center text-xs text-zinc-400">
          {isAdmin ? 'Do‘konlar uchun alohida kirish manzili bor.' : 'Bosh administratorlar uchun alohida kirish manzili bor.'}
        </div>
      </div>
    </div>
  )
}

export function RoleLoginForm({ mode }: { mode: LoginMode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
          <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
        </div>
      }
    >
      <LoginFormInner mode={mode} />
    </Suspense>
  )
}
