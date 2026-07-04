'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { signOut } from 'next-auth/react'
import { CheckCircle2, KeyRound, Link2, Loader2, Send, ShieldCheck, UserRound } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { uzDateTime } from '@/lib/dates'
import type { ApiResponse } from '@/types'

interface ShopAdminProfile {
  id: string
  name: string
  phone: string
  login: string
  telegramId: string | null
  telegramVerifiedAt: string | null
  passwordChangedAt: string
  shop: {
    id: string
    name: string
    shopNumber: string
  }
}

interface ShopProfile {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  address: string
  note: string | null
  status: string
  subscriptionDue: string
  preferredCurrency: 'UZS' | 'USD'
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
  return uzDateTime(value)
}

export default function ShopSettingsPage() {
  const [profile, setProfile] = useState<ShopAdminProfile | null>(null)
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

  // Own account (name/phone) editing
  const [accountName, setAccountName] = useState('')
  const [accountPhone, setAccountPhone] = useState('')
  const [accountError, setAccountError] = useState('')
  const [accountSuccess, setAccountSuccess] = useState('')
  const [accountLoading, setAccountLoading] = useState(false)

  // Shop profile editing
  const [shop, setShop] = useState<ShopProfile | null>(null)
  const [shopForm, setShopForm] = useState({ name: '', ownerName: '', ownerPhone: '', address: '', note: '', preferredCurrency: 'UZS' as 'UZS' | 'USD' })
  const [shopError, setShopError] = useState('')
  const [shopSuccess, setShopSuccess] = useState('')
  const [shopSaving, setShopSaving] = useState(false)

  useEffect(() => {
    let mounted = true

    Promise.all([
      fetch('/api/shop-admin/profile').then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response))
        return (await response.json()) as ApiResponse<ShopAdminProfile>
      }),
      fetch('/api/shop/profile').then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as ApiResponse<ShopProfile>
      }),
    ])
      .then(([profileJson, shopJson]) => {
        if (!mounted) return
        setProfile(profileJson.data ?? null)
        setTelegramId(profileJson.data?.telegramId ?? '')
        setAccountName(profileJson.data?.name ?? '')
        setAccountPhone(profileJson.data?.phone ?? '')
        if (shopJson?.data) {
          setShop(shopJson.data)
          setShopForm({
            name: shopJson.data.name,
            ownerName: shopJson.data.ownerName,
            ownerPhone: shopJson.data.ownerPhone,
            address: shopJson.data.address ?? '',
            note: shopJson.data.note ?? '',
            preferredCurrency: shopJson.data.preferredCurrency ?? 'UZS',
          })
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

  const telegramStatus = useMemo(() => {
    if (!profile) return { label: '-', tone: 'secondary' as const }
    if (profile.telegramVerifiedAt) return { label: 'Ulangan', tone: 'default' as const }
    if (profile.telegramId) return { label: 'Tasdiqlanmagan', tone: 'outline' as const }
    return { label: 'Ulanmagan', tone: 'secondary' as const }
  }, [profile])

  const canSubmitPassword =
    passwordForm.currentPassword.length > 0 &&
    passwordForm.newPassword.length >= 8 &&
    passwordForm.confirmPassword.length >= 8 &&
    !passwordLoading

  async function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAccountError('')
    setAccountSuccess('')

    if (accountName.trim().length < 2) {
      setAccountError("Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      return
    }
    if (accountPhone.trim().length < 9) {
      setAccountError("Telefon raqam kamida 9 ta raqam bo'lishi kerak")
      return
    }

    setAccountLoading(true)
    try {
      const response = await fetch('/api/shop-admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: accountName.trim(), phone: accountPhone.trim() }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const json: ApiResponse<ShopAdminProfile> = await response.json()
      setProfile(json.data ?? null)
      setAccountSuccess('Profil yangilandi.')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setAccountLoading(false)
    }
  }

  async function handleShopSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShopError('')
    setShopSuccess('')

    if (shopForm.name.trim().length < 2) {
      setShopError("Do'kon nomi kamida 2 ta harfdan iborat bo'lishi kerak")
      return
    }
    if (shopForm.ownerName.trim().length < 2) {
      setShopError("Egasi ismi kamida 2 ta harfdan iborat bo'lishi kerak")
      return
    }
    if (shopForm.ownerPhone.trim().length < 9) {
      setShopError("Telefon raqam kamida 9 ta raqam bo'lishi kerak")
      return
    }

    setShopSaving(true)
    try {
      const response = await fetch('/api/shop/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: shopForm.name.trim(),
          ownerName: shopForm.ownerName.trim(),
          ownerPhone: shopForm.ownerPhone.trim(),
          address: shopForm.address.trim(),
          note: shopForm.note.trim(),
          preferredCurrency: shopForm.preferredCurrency,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const json: ApiResponse<ShopProfile> = await response.json()
      if (json.data) setShop(json.data)
      setShopSuccess("Do'kon ma'lumotlari yangilandi.")
    } catch (err) {
      setShopError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setShopSaving(false)
    }
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
        void signOut({ callbackUrl: '/shop/login?callbackUrl=/shop/settings' })
      }, 900)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setPasswordLoading(false)
    }
  }

  async function handleTelegramSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTelegramError('')
    setTelegramSuccess('')

    const value = telegramId.trim()
    if (value && !/^\d{5,20}$/.test(value)) {
      setTelegramError("Telegram ID faqat raqamlardan iborat bo'lishi kerak")
      return
    }

    setTelegramLoading(true)
    try {
      const response = await fetch('/api/shop-admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: value }),
      })

      if (!response.ok) throw new Error(await readApiError(response))

      const json: ApiResponse<ShopAdminProfile> = await response.json()
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
              <form onSubmit={handleAccountSubmit} className="space-y-3">
                {accountError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {accountError}
                  </div>
                )}
                {accountSuccess && (
                  <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    {accountSuccess}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="account-name" className="mb-1.5 block text-xs font-medium text-zinc-700">
                      Ism
                    </Label>
                    <Input
                      id="account-name"
                      value={accountName}
                      onChange={(event) => setAccountName(event.target.value)}
                      className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                    />
                  </div>
                  <div>
                    <Label htmlFor="account-phone" className="mb-1.5 block text-xs font-medium text-zinc-700">
                      Telefon
                    </Label>
                    <Input
                      id="account-phone"
                      value={accountPhone}
                      onChange={(event) => setAccountPhone(event.target.value)}
                      className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                    />
                  </div>
                  <Info label="Login" value={profile.login} mono />
                  <Info label="Do'kon raqami" value={profile.shop.shopNumber} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-zinc-500">
                    Parol oxirgi yangilangan: {formatDate(profile.passwordChangedAt)}
                  </div>
                  <Button
                    type="submit"
                    disabled={accountLoading}
                    className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
                  >
                    {accountLoading ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />}
                    Saqlash
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {shop && (
            <Card className="rounded-lg lg:col-span-2">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Do'kon ma'lumotlari</CardTitle>
                <CardDescription>Do'kon nomi, aloqa ma'lumotlari va pul ko'rinishini tahrirlash</CardDescription>
                <CardAction>
                  <Badge variant="outline" className="rounded-md border-zinc-200 text-zinc-600">
                    #{shop.shopNumber}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleShopSubmit} className="space-y-4">
                  {shopError && (
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                      {shopError}
                    </div>
                  )}
                  {shopSuccess && (
                    <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      <CheckCircle2 className="size-4" />
                      {shopSuccess}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="shop-name" className="mb-1.5 block text-xs font-medium text-zinc-700">
                        Do'kon nomi
                      </Label>
                      <Input
                        id="shop-name"
                        value={shopForm.name}
                        onChange={(e) => setShopForm((f) => ({ ...f, name: e.target.value }))}
                        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                      />
                    </div>
                    <div>
                      <Label htmlFor="shop-owner" className="mb-1.5 block text-xs font-medium text-zinc-700">
                        Egasi ismi
                      </Label>
                      <Input
                        id="shop-owner"
                        value={shopForm.ownerName}
                        onChange={(e) => setShopForm((f) => ({ ...f, ownerName: e.target.value }))}
                        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                      />
                    </div>
                    <div>
                      <Label htmlFor="shop-owner-phone" className="mb-1.5 block text-xs font-medium text-zinc-700">
                        Egasi telefoni
                      </Label>
                      <Input
                        id="shop-owner-phone"
                        value={shopForm.ownerPhone}
                        onChange={(e) => setShopForm((f) => ({ ...f, ownerPhone: e.target.value }))}
                        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                      />
                    </div>
                    <div>
                      <Label htmlFor="shop-address" className="mb-1.5 block text-xs font-medium text-zinc-700">
                        Manzil
                      </Label>
                      <Input
                        id="shop-address"
                        value={shopForm.address}
                        onChange={(e) => setShopForm((f) => ({ ...f, address: e.target.value }))}
                        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                      />
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-xs font-medium text-zinc-700">
                        Pul ko'rinishi
                      </Label>
                      <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 bg-white">
                        {(['UZS', 'USD'] as const).map((currency) => (
                          <button
                            key={currency}
                            type="button"
                            onClick={() => setShopForm((f) => ({ ...f, preferredCurrency: currency }))}
                            className={[
                              'h-9 px-4 text-sm font-medium transition-colors',
                              shopForm.preferredCurrency === currency
                                ? 'bg-zinc-900 text-white'
                                : 'text-zinc-600 hover:bg-zinc-50',
                            ].join(' ')}
                          >
                            {currency}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs text-zinc-500">
                        UZS bazaviy hisob bo'lib qoladi; USD faqat ko'rish va kiritish uchun.
                      </p>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="shop-note" className="mb-1.5 block text-xs font-medium text-zinc-700">
                      Izoh
                    </Label>
                    <Textarea
                      id="shop-note"
                      value={shopForm.note}
                      onChange={(e) => setShopForm((f) => ({ ...f, note: e.target.value }))}
                      className="min-h-[70px] rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={shopSaving}
                    className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
                  >
                    {shopSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                    Do'kon ma'lumotlarini saqlash
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card className="rounded-lg">
            <CardHeader className="border-b border-zinc-100">
              <CardTitle>Telegram</CardTitle>
              <CardDescription>Bot orqali xabar olish uchun Telegram ID</CardDescription>
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

              <form onSubmit={handleTelegramSubmit} className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
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
                  <Label htmlFor="shop-telegram-id" className="mb-1.5 block text-xs font-medium text-zinc-700">
                    Telegram ID
                  </Label>
                  <Input
                    id="shop-telegram-id"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="123456789"
                    value={telegramId}
                    onChange={(event) => setTelegramId(event.target.value)}
                    className="h-9 rounded-md border-zinc-200 bg-white text-sm focus-visible:ring-zinc-900"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Username emas, faqat raqamli Telegram ID kiriting, keyin botga /start yuboring.
                  </p>
                </div>
                <Button type="submit" disabled={telegramLoading} className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800">
                  {telegramLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Telegram ID saqlash
                </Button>
              </form>

              {profile.telegramVerifiedAt ? (
                <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  Telegram ID tasdiqlangan. Bildirishnomalar shu ID ga yuboriladi.
                </div>
              ) : profile.telegramId ? (
                <div className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                  <Link2 className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                  Telegram ID saqlandi. Tasdiqlash uchun botga <span className="font-mono font-semibold">/start</span>{' '}
                  yuboring.
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Telegram ID kiritilmagan. Yuqorida ID kiriting, so'ng botga <span className="font-mono font-semibold">/start</span> yuboring.
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
        minLength={8}
        required
        className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
      />
    </div>
  )
}
