'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { CheckCircle2, Link2, Send } from 'lucide-react'
import { SettingsInfo as Info } from '@/components/shop/settings-info'
import { AsyncButton } from '@/components/ui/async-button'
import { Badge } from '@/components/ui/badge'
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
import { commitNavigationMutation } from '@/lib/client-events'
import type { ShopAdminProfileDto } from '@/lib/shop-settings-contract'
import type { ApiResponse } from '@/types'
import { formatSettingsDate, readSettingsApiError } from './settings-shared'

export function SettingsTelegramSection({
  profile,
  onProfileChange,
}: {
  profile: ShopAdminProfileDto
  onProfileChange: (profile: ShopAdminProfileDto) => void
}) {
  const [telegramId, setTelegramId] = useState(profile.telegramId ?? '')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pending, setPending] = useState(false)
  const status = useMemo(() => {
    if (profile.telegramVerifiedAt) return { label: 'Ulangan', tone: 'default' as const }
    if (profile.telegramId) return { label: 'Tasdiqlanmagan', tone: 'outline' as const }
    return { label: 'Ulanmagan', tone: 'secondary' as const }
  }, [profile.telegramId, profile.telegramVerifiedAt])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    const value = telegramId.trim()
    if (value && !/^\d{5,20}$/.test(value)) {
      setError("Telegram ID faqat raqamlardan iborat bo'lishi kerak")
      return
    }

    setPending(true)
    try {
      const response = await fetch('/api/shop-admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: value }),
      })
      if (!response.ok) throw new Error(await readSettingsApiError(response))
      const json: ApiResponse<ShopAdminProfileDto> = await response.json()
      if (!json.data) throw new Error(json.error || 'Profil topilmadi')
      await commitNavigationMutation({ kind: 'shopAdmin.profileUpdated' })
      onProfileChange(json.data)
      setTelegramId(json.data.telegramId ?? '')
      setSuccess(json.message ?? 'Telegram ulanishi yangilandi.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Xatolik yuz berdi')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b border-zinc-100">
        <CardTitle>Telegram</CardTitle>
        <CardDescription>Bot orqali xabar olish uchun Telegram ID</CardDescription>
        <CardAction><Badge variant={status.tone} className="rounded-md">{status.label}</Badge></CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Info label="Telegram ID" value={profile.telegramId || '-'} mono />
          <Info label="Ulangan vaqt" value={formatSettingsDate(profile.telegramVerifiedAt)} />
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {success && (
            <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" />
              {success}
            </div>
          )}
          <div>
            <Label htmlFor="shop-telegram-id" className="mb-1.5 block text-xs font-medium text-zinc-700">Telegram ID</Label>
            <Input
              id="shop-telegram-id"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="123456789"
              value={telegramId}
              onChange={(event) => setTelegramId(event.target.value)}
              className="h-9 rounded-md border-zinc-200 bg-white text-sm focus-visible:ring-zinc-900"
            />
            <p className="mt-1 text-xs text-zinc-500">Username emas, faqat raqamli Telegram ID kiriting, keyin botga /start yuboring.</p>
          </div>
          <AsyncButton
            type="submit"
            pending={pending}
            pendingLabel="Saqlanmoqda..."
            className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
          >
            <Send className="size-4" />
            Telegram ID saqlash
          </AsyncButton>
        </form>
        {profile.telegramVerifiedAt ? (
          <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            Telegram ID tasdiqlangan. Bildirishnomalar shu ID ga yuboriladi.
          </div>
        ) : profile.telegramId ? (
          <div className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
            <Link2 className="mt-0.5 size-4 shrink-0 text-zinc-400" />
            Telegram ID saqlandi. Tasdiqlash uchun botga <span className="font-mono font-semibold">/start</span> yuboring.
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Telegram ID kiritilmagan. Yuqorida ID kiriting, so&apos;ng botga <span className="font-mono font-semibold">/start</span> yuboring.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
