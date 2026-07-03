'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { CheckCircle2, KeyRound, Loader2, Send, ServerCog, ShieldCheck, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiResponse } from '@/types'

interface EnvCheck {
  label: string
  ok: boolean
}

interface SuperAdminProfile {
  id: string
  name: string
  login: string | null
  telegramId: string | null
  telegramVerifiedAt: string | null
  role: string
  createdAt: string
}

interface PasswordForm {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const emptyPasswordForm: PasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

async function readApiError(response: Response) {
  try {
    const json: ApiResponse = await response.json()
    return json.error || 'Xatolik yuz berdi'
  } catch {
    return 'Xatolik yuz berdi'
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString('uz-UZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminSettingsClient({ checks }: { checks: EnvCheck[] }) {
  const [profile, setProfile] = useState<SuperAdminProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(emptyPasswordForm)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [telegramId, setTelegramId] = useState('')
  const [telegramError, setTelegramError] = useState('')
  const [telegramSuccess, setTelegramSuccess] = useState('')
  const [telegramLoading, setTelegramLoading] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [nameSuccess, setNameSuccess] = useState('')
  const [nameLoading, setNameLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    fetch('/api/admin/profile')
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response))
        const json: ApiResponse<SuperAdminProfile> = await response.json()
        if (mounted) {
          setProfile(json.data ?? null)
          setTelegramId(json.data?.telegramId ?? '')
          setName(json.data?.name ?? '')
        }
      })
      .catch((err: Error) => {
        if (mounted) setError(err.message || 'Xatolik yuz berdi')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const canSubmitPassword =
    passwordForm.currentPassword.length > 0 &&
    passwordForm.newPassword.length >= 8 &&
    passwordForm.confirmPassword.length >= 8 &&
    !passwordLoading

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Yangi parol va tasdiq bir xil emas')
      return
    }

    setPasswordLoading(true)
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })

      if (!response.ok) throw new Error(await readApiError(response))

      setPasswordForm(emptyPasswordForm)
      setPasswordSuccess("Parol yangilandi. Qayta kirish oynasiga yo'naltirilasiz.")
      window.setTimeout(() => {
        void signOut({ callbackUrl: '/admin/login?callbackUrl=/admin/settings' })
      }, 900)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setPasswordLoading(false)
    }
  }

  async function handleNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNameError('')
    setNameSuccess('')
    if (name.trim().length < 2) {
      setNameError("Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      return
    }
    setNameLoading(true)
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const json: ApiResponse<SuperAdminProfile> = await response.json()
      setProfile(json.data ?? null)
      setName(json.data?.name ?? '')
      setNameSuccess('Profil yangilandi.')
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setNameLoading(false)
    }
  }

  async function handleTelegramSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTelegramError('')
    setTelegramSuccess('')

    const value = telegramId.trim()
    if (value && !/^\d{5,20}$/.test(value)) {
      setTelegramError('Telegram ID faqat raqamlardan iborat bo\'lishi kerak')
      return
    }

    setTelegramLoading(true)
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: value }),
      })

      if (!response.ok) throw new Error(await readApiError(response))

      const json: ApiResponse<SuperAdminProfile> = await response.json()
      setProfile(json.data ?? null)
      setTelegramId(json.data?.telegramId ?? '')
      setTelegramSuccess(json.message ?? 'Telegram ID yangilandi.')
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setTelegramLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Sozlamalar</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Bosh admin profili, xavfsizlik va tizim holati</p>
        </div>
        <Badge variant="secondary" className="h-6 w-fit rounded-md">
          Platforma nazorati
        </Badge>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin" />
          Yuklanmoqda...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="rounded-lg">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Profil</CardTitle>
              <CardDescription>Bosh admin hisob ma'lumotlari</CardDescription>
              <CardAction>
                <UserRound className="size-5 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile ? (
                <>
                  <form onSubmit={handleNameSubmit} className="space-y-3">
                    {nameError && (
                      <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                        {nameError}
                      </div>
                    )}
                    {nameSuccess && (
                      <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        <CheckCircle2 className="size-4" />
                        {nameSuccess}
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label htmlFor="admin-name" className="mb-1.5 block text-xs font-medium text-zinc-700">
                          Ism
                        </Label>
                        <Input
                          id="admin-name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={nameLoading}
                        className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
                      >
                        {nameLoading ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />}
                        Saqlash
                      </Button>
                    </div>
                  </form>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Info label="Login" value={profile.login || '-'} mono />
                    <Info label="Rol" value={profile.role} />
                    <Info label="Telegram ID" value={profile.telegramId || '-'} mono />
                    <Info label="Yaratilgan" value={formatDate(profile.createdAt)} />
                    <Info label="Telegram ulangan" value={formatDate(profile.telegramVerifiedAt)} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-zinc-500">Profil topilmadi.</div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Tizim holati</CardTitle>
              <CardDescription>Vercel env vars va servis ulanishlari</CardDescription>
              <CardAction>
                <ServerCog className="size-5 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-zinc-100">
                {checks.map((check) => (
                  <div key={check.label} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-zinc-700">{check.label}</span>
                    <span
                      className={check.ok ? 'text-xs font-medium text-emerald-700' : 'text-xs font-medium text-red-700'}
                    >
                      {check.ok ? 'Sozlangan' : 'Kerak'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg lg:col-span-2">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Telegram ID</CardTitle>
              <CardDescription>Bot sizni ID orqali taniydi. Username kiritmang.</CardDescription>
              <CardAction>
                <Send className="size-5 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTelegramSubmit} className="max-w-xl space-y-4">
                {telegramError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {telegramError}
                  </div>
                )}
                {telegramSuccess && (
                  <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    {telegramSuccess}
                  </div>
                )}

                <div>
                  <Label htmlFor="admin-telegram-id" className="mb-1.5 block text-xs font-medium text-zinc-700">
                    Telegram ID
                  </Label>
                  <Input
                    id="admin-telegram-id"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="123456789"
                    value={telegramId}
                    onChange={(event) => setTelegramId(event.target.value)}
                    className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Botga /start yuborsangiz, aynan shu ID bo'yicha ruxsat tekshiriladi.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={telegramLoading}
                  className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
                >
                  {telegramLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Telegram ID saqlash
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-lg lg:col-span-2">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Parolni yangilash</CardTitle>
              <CardDescription>Joriy parolni tasdiqlab, yangi parol kiriting</CardDescription>
              <CardAction>
                <ShieldCheck className="size-5 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordSubmit} className="max-w-xl space-y-4">
                {passwordError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {passwordError}
                  </div>
                )}
                {passwordSuccess && (
                  <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    {passwordSuccess}
                  </div>
                )}

                <PasswordField
                  id="admin-current-password"
                  label="Joriy parol"
                  value={passwordForm.currentPassword}
                  onChange={(value) => setPasswordForm((form) => ({ ...form, currentPassword: value }))}
                />
                <PasswordField
                  id="admin-new-password"
                  label="Yangi parol"
                  value={passwordForm.newPassword}
                  onChange={(value) => setPasswordForm((form) => ({ ...form, newPassword: value }))}
                />
                <PasswordField
                  id="admin-confirm-password"
                  label="Yangi parolni tasdiqlash"
                  value={passwordForm.confirmPassword}
                  onChange={(value) => setPasswordForm((form) => ({ ...form, confirmPassword: value }))}
                />

                <Button
                  type="submit"
                  disabled={!canSubmitPassword}
                  className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
                >
                  {passwordLoading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  Parolni yangilash
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className={['mt-1 truncate text-sm font-semibold text-zinc-900', mono ? 'font-mono' : ''].join(' ')}>
        {value}
      </div>
    </div>
  )
}

function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-700">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        minLength={8}
        required
        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
      />
    </div>
  )
}
