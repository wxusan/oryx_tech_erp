'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { signOut } from 'next-auth/react'
import { CheckCircle2, Copy, KeyRound, Link2, Loader2, ShieldCheck, UserRound } from 'lucide-react'
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

interface ShopAdminProfile {
  id: string
  name: string
  phone: string
  login: string
  telegramId: string | null
  telegramVerifiedAt: string | null
  telegramLinkCode: string | null
  passwordChangedAt: string
  shop: {
    id: string
    name: string
    shopNumber: string
  }
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ShopSettingsPage() {
  const [profile, setProfile] = useState<ShopAdminProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(emptyPasswordForm)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    fetch('/api/shop-admin/profile')
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response))
        const json: ApiResponse<ShopAdminProfile> = await response.json()
        if (mounted) setProfile(json.data ?? null)
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

  const telegramStatus = useMemo(() => {
    if (!profile) return { label: '-', tone: 'secondary' as const }
    if (profile.telegramVerifiedAt) return { label: 'Ulangan', tone: 'default' as const }
    if (profile.telegramLinkCode) return { label: 'Ulanmagan', tone: 'outline' as const }
    return { label: "Kod yo'q", tone: 'secondary' as const }
  }, [profile])

  const linkCommand = profile?.telegramLinkCode ? `/link ${profile.telegramLinkCode}` : ''
  const canSubmitPassword =
    passwordForm.currentPassword.length > 0 &&
    passwordForm.newPassword.length >= 6 &&
    passwordForm.confirmPassword.length >= 6 &&
    !passwordLoading

  async function copyLinkCommand() {
    if (!linkCommand) return
    await navigator.clipboard.writeText(linkCommand)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

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
      const response = await fetch('/api/shop-admin/profile', {
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
        void signOut({ callbackUrl: '/login?callbackUrl=/shop/settings' })
      }, 900)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="max-w-5xl space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Sozlamalar</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Profil, Telegram ulanishi va parol xavfsizligi</p>
        </div>
        {profile && (
          <Badge variant="outline" className="h-6 w-fit rounded-md border-zinc-200 text-zinc-600">
            {profile.shop.name}
          </Badge>
        )}
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
      ) : profile ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="rounded-lg">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Profil</CardTitle>
              <CardDescription>Hisob va do'kon ma'lumotlari</CardDescription>
              <CardAction>
                <UserRound className="size-5 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="Ism" value={profile.name} />
                <Info label="Telefon" value={profile.phone} />
                <Info label="Login" value={profile.login} mono />
                <Info label="Do'kon raqami" value={profile.shop.shopNumber} />
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-medium text-zinc-500">Parol oxirgi yangilangan</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">
                  {formatDate(profile.passwordChangedAt)}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Telegram</CardTitle>
              <CardDescription>Bot orqali xabar olish holati</CardDescription>
              <CardAction>
                <Badge variant={telegramStatus.tone} className="rounded-md">
                  {telegramStatus.label}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="Telegram ID" value={profile.telegramId || '-'} mono />
                <Info label="Ulangan vaqt" value={formatDate(profile.telegramVerifiedAt)} />
              </div>

              {profile.telegramVerifiedAt ? (
                <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  Telegram hisobingiz tasdiqlangan. Bildirishnomalar shu hisobga yuboriladi.
                </div>
              ) : linkCommand ? (
                <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-xs font-medium text-zinc-500">Ulash kodi</div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="min-h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900">
                      {linkCommand}
                    </code>
                    <Button type="button" variant="outline" className="h-9 rounded-md" onClick={copyLinkCommand}>
                      <Copy className="size-4" />
                      {copied ? 'Nusxalandi' : 'Nusxa olish'}
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-zinc-600">
                    <Link2 className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    Telegram botga kiring va xabar sifatida <span className="font-mono font-semibold">{linkCommand}</span>{' '}
                    yuboring.
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Telegram ulash kodi topilmadi. Super admin bilan bog'laning.
                </div>
              )}
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
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {passwordSuccess}
                  </div>
                )}

                <PasswordField
                  id="current-password"
                  label="Joriy parol"
                  value={passwordForm.currentPassword}
                  onChange={(value) => setPasswordForm((form) => ({ ...form, currentPassword: value }))}
                />
                <PasswordField
                  id="new-password"
                  label="Yangi parol"
                  value={passwordForm.newPassword}
                  onChange={(value) => setPasswordForm((form) => ({ ...form, newPassword: value }))}
                />
                <PasswordField
                  id="confirm-password"
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
      ) : null}
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
        minLength={6}
        required
        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
      />
    </div>
  )
}
