'use client'

import { type FormEvent, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { AsyncButton } from '@/components/ui/async-button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PhoneInput } from '@/components/ui/phone-input'
import { Textarea } from '@/components/ui/textarea'
import { commitNavigationMutation } from '@/lib/client-events'
import { isValidPhone } from '@/lib/phone'
import type { ShopProfileDto } from '@/lib/shop-settings-contract'
import { useShopCurrency } from '@/lib/use-shop-currency'
import type { ApiResponse } from '@/types'
import { readSettingsApiError } from './settings-shared'

export function SettingsShopSection({
  shop,
  canEditShopProfile,
  canManageCurrency,
  canManageShopTelegram,
  onShopChange,
}: {
  shop: ShopProfileDto
  canEditShopProfile: boolean
  canManageCurrency: boolean
  canManageShopTelegram: boolean
  onShopChange: (shop: ShopProfileDto) => void
}) {
  const { setCurrency } = useShopCurrency()
  const [form, setForm] = useState(() => ({
    name: shop.name,
    ownerName: shop.ownerName,
    ownerPhone: shop.ownerPhone,
    address: shop.address,
    note: shop.note ?? '',
    preferredCurrency: shop.preferredCurrency,
    telegramNotificationsEnabled: shop.telegramNotificationsEnabled,
  }))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (canEditShopProfile && form.name.trim().length < 2) {
      setError("Do'kon nomi kamida 2 ta harfdan iborat bo'lishi kerak")
      requestAnimationFrame(() => document.getElementById('shop-name')?.focus())
      return
    }
    if (canEditShopProfile && form.ownerName.trim().length < 2) {
      setError("Egasi ismi kamida 2 ta harfdan iborat bo'lishi kerak")
      requestAnimationFrame(() => document.getElementById('shop-owner')?.focus())
      return
    }
    if (canEditShopProfile && !isValidPhone(form.ownerPhone)) {
      setError("Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67")
      requestAnimationFrame(() => document.getElementById('shop-owner-phone')?.focus())
      return
    }

    setPending(true)
    try {
      const response = await fetch('/api/shop/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(canEditShopProfile ? {
            name: form.name.trim(),
            ownerName: form.ownerName.trim(),
            ownerPhone: form.ownerPhone.trim(),
            address: form.address.trim(),
            note: form.note.trim(),
          } : {}),
          ...(canManageCurrency ? { preferredCurrency: form.preferredCurrency } : {}),
          ...(canManageShopTelegram ? { telegramNotificationsEnabled: form.telegramNotificationsEnabled } : {}),
        }),
      })
      if (!response.ok) throw new Error(await readSettingsApiError(response))
      const json: ApiResponse<ShopProfileDto> = await response.json()
      if (!json.data) throw new Error(json.error || "Do'kon topilmadi")
      const currencyChanged = json.data.preferredCurrency !== shop.preferredCurrency
      await commitNavigationMutation({
        kind: currencyChanged ? 'shop.currencyUpdated' : 'shop.profileUpdated',
      })
      onShopChange(json.data)
      setCurrency({
        currency: json.data.preferredCurrency,
        usdUzsRate: json.data.usdUzsRate,
        usdUzsRateSource: json.data.usdUzsRateSource,
        usdUzsRateFetchedAt: json.data.usdUzsRateFetchedAt,
        fxQuote: json.data.fxQuote,
      })
      setForm({
        name: json.data.name,
        ownerName: json.data.ownerName,
        ownerPhone: json.data.ownerPhone,
        address: json.data.address,
        note: json.data.note ?? '',
        preferredCurrency: json.data.preferredCurrency,
        telegramNotificationsEnabled: json.data.telegramNotificationsEnabled,
      })
      setSuccess("Do'kon ma'lumotlari yangilandi.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Xatolik yuz berdi')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="rounded-lg lg:col-span-2">
      <CardHeader className="border-b border-zinc-100">
        <CardTitle>Do'kon ma'lumotlari</CardTitle>
        <CardDescription>Do'kon nomi, aloqa ma'lumotlari va pul ko'rinishini tahrirlash</CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-md border-zinc-200 text-zinc-600">#{shop.shopNumber}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {success && (
            <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" />
              {success}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Do'kon nomi" required controlId="shop-name">
              <Input
                id="shop-name"
                disabled={!canEditShopProfile}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </Field>
            <Field label="Egasi ismi" required controlId="shop-owner">
              <Input
                id="shop-owner"
                disabled={!canEditShopProfile}
                value={form.ownerName}
                onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))}
                className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </Field>
            <Field label="Egasi telefoni" required controlId="shop-owner-phone">
              <PhoneInput
                id="shop-owner-phone"
                disabled={!canEditShopProfile}
                value={form.ownerPhone}
                onChange={(ownerPhone) => setForm((current) => ({ ...current, ownerPhone }))}
                className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </Field>
            <div>
              <Label htmlFor="shop-address" className="mb-1.5 block text-xs font-medium text-zinc-700">Manzil</Label>
              <Input
                id="shop-address"
                disabled={!canEditShopProfile}
                value={form.address}
                onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
              />
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-xs font-medium text-zinc-700">Pul ko&apos;rinishi</legend>
              <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 bg-white">
                {(['UZS', 'USD'] as const).map((currency) => (
                  <button
                    key={currency}
                    type="button"
                    disabled={!canManageCurrency}
                    aria-pressed={form.preferredCurrency === currency}
                    onClick={() => setForm((current) => ({ ...current, preferredCurrency: currency }))}
                    className={[
                      'h-9 px-4 text-sm font-medium transition-colors',
                      form.preferredCurrency === currency ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50',
                    ].join(' ')}
                  >
                    {currency}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">UZS bazaviy hisob bo'lib qoladi; USD faqat ko'rish va kiritish uchun.</p>
            </fieldset>
            <label htmlFor="shop-telegram-notifications" className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3 text-sm">
              <span>
                <span className="block font-medium text-zinc-800">Do&apos;kon Telegram xabarlari</span>
                <span className="mt-0.5 block text-xs text-zinc-500">Barcha ruxsat berilgan oluvchilar uchun umumiy kalit</span>
              </span>
              <input
                id="shop-telegram-notifications"
                type="checkbox"
                disabled={!canManageShopTelegram}
                checked={form.telegramNotificationsEnabled}
                onChange={(event) => setForm((current) => ({ ...current, telegramNotificationsEnabled: event.target.checked }))}
              />
            </label>
          </div>
          <div>
            <Label htmlFor="shop-note" className="mb-1.5 block text-xs font-medium text-zinc-700">Izoh</Label>
            <Textarea
              id="shop-note"
              disabled={!canEditShopProfile}
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              className="min-h-[70px] rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
            />
          </div>
          <AsyncButton
            type="submit"
            pending={pending}
            pendingLabel="Saqlanmoqda..."
            className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
          >
            Do'kon ma'lumotlarini saqlash
          </AsyncButton>
        </form>
      </CardContent>
    </Card>
  )
}
