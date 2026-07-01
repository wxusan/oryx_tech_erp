'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/admin'
  const adminCallbackUrl = callbackUrl.startsWith('/admin') ? callbackUrl : '/admin'
  const errorParam = searchParams.get('error')

  const [tab, setTab] = useState<'admin' | 'shop'>('admin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'unauthorized' ? "Ruxsat yo'q. Iltimos, to'g'ri hisobdan kiring." : null
  )

  const [adminForm, setAdminForm] = useState({ email: '', password: '' })
  const [shopForm, setShopForm] = useState({ login: '', password: '' })

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await signIn('superadmin', {
      email: adminForm.email,
      password: adminForm.password,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      setError("Email yoki parol noto'g'ri.")
    } else {
      router.push(adminCallbackUrl)
    }
  }

  async function handleShopLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await signIn('shopadmin', {
      login: shopForm.login,
      password: shopForm.password,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      setError("Login yoki parol noto'g'ri.")
    } else {
      router.push('/shop/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-zinc-200">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-zinc-100">
          <div className="text-lg font-bold text-zinc-900 tracking-tight">Oryx ERP</div>
          <div className="text-xs text-zinc-400 mt-0.5">Tizimga kirish</div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-200">
          <button
            onClick={() => { setTab('admin'); setError(null) }}
            className={[
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              tab === 'admin'
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50',
            ].join(' ')}
          >
            Super Admin
          </button>
          <button
            onClick={() => { setTab('shop'); setError(null) }}
            className={[
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              tab === 'shop'
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50',
            ].join(' ')}
          >
            Do&apos;kon Admin
          </button>
        </div>

        <div className="px-8 py-6">
          {error && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {tab === 'admin' ? (
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <Label htmlFor="admin-email" className="text-xs font-medium text-zinc-700 mb-1.5 block">
                  Email
                </Label>
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="admin@example.com"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                  required
                  className="h-9 text-sm border-zinc-200 rounded-none focus-visible:ring-zinc-900"
                />
              </div>
              <div>
                <Label htmlFor="admin-password" className="text-xs font-medium text-zinc-700 mb-1.5 block">
                  Parol
                </Label>
                <Input
                  id="admin-password"
                  type="password"
                  placeholder="••••••••"
                  value={adminForm.password}
                  onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  required
                  className="h-9 text-sm border-zinc-200 rounded-none focus-visible:ring-zinc-900"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-9 bg-zinc-900 text-white text-sm rounded-none hover:bg-zinc-800"
              >
                {loading ? 'Kirish...' : 'Kirish'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleShopLogin} className="space-y-4">
              <div>
                <Label htmlFor="shop-login" className="text-xs font-medium text-zinc-700 mb-1.5 block">
                  Login
                </Label>
                <Input
                  id="shop-login"
                  type="text"
                  placeholder="login"
                  value={shopForm.login}
                  onChange={(e) => setShopForm({ ...shopForm, login: e.target.value })}
                  required
                  className="h-9 text-sm border-zinc-200 rounded-none focus-visible:ring-zinc-900"
                />
              </div>
              <div>
                <Label htmlFor="shop-password" className="text-xs font-medium text-zinc-700 mb-1.5 block">
                  Parol
                </Label>
                <Input
                  id="shop-password"
                  type="password"
                  placeholder="••••••••"
                  value={shopForm.password}
                  onChange={(e) => setShopForm({ ...shopForm, password: e.target.value })}
                  required
                  className="h-9 text-sm border-zinc-200 rounded-none focus-visible:ring-zinc-900"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-9 bg-zinc-900 text-white text-sm rounded-none hover:bg-zinc-800"
              >
                {loading ? 'Kirish...' : 'Kirish'}
              </Button>
            </form>
          )}
        </div>

        <div className="px-8 pb-6 text-center text-xs text-zinc-400">
          Oryx Tech ERP © 2024
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
          <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
