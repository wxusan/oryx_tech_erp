'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type LoginMode = 'admin' | 'shop'

function LoginFormInner({ mode }: { mode: LoginMode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fallbackUrl = mode === 'admin' ? '/admin' : '/shop/dashboard'
  const allowedPrefix = mode === 'admin' ? '/admin' : '/shop'
  const callbackUrl = searchParams.get('callbackUrl') || fallbackUrl
  const safeCallbackUrl = callbackUrl.startsWith(allowedPrefix) ? callbackUrl : fallbackUrl
  const errorParam = searchParams.get('error')
  const [form, setForm] = useState({ login: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'unauthorized' ? "Ruxsat yo'q. Iltimos, to'g'ri hisobdan kiring." : null,
  )

  const isAdmin = mode === 'admin'

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const result = await signIn(isAdmin ? 'superadmin' : 'shopadmin', {
      login: form.login,
      password: form.password,
      redirect: false,
    })

    setLoading(false)
    if (result?.error) {
      setError("Login yoki parol noto'g'ri.")
      return
    }

    router.replace(safeCallbackUrl)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-8 pb-6 pt-8">
          <div className="text-lg font-bold tracking-tight text-zinc-900">Oryx ERP</div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {isAdmin ? 'Bosh admin kirishi' : "Do'kon admini kirishi"}
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
                placeholder={isAdmin ? 'Login yoki email' : "Do'kon loginini kiriting"}
                value={form.login}
                onChange={(event) => setForm({ ...form, login: event.target.value })}
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
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
                className="h-9 rounded-none border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </div>

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
          {isAdmin ? "Do'konlar uchun alohida kirish manzili bor." : 'Bosh adminlar uchun alohida kirish manzili bor.'}
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
