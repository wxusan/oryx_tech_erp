'use client'

import { type FormEvent, useState } from 'react'
import { CheckCircle2, UserRound } from 'lucide-react'
import { SettingsInfo as Info } from '@/components/shop/settings-info'
import { AsyncButton } from '@/components/ui/async-button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { commitNavigationMutation } from '@/lib/client-events'
import { isValidPhone } from '@/lib/phone'
import type { ShopAdminProfileDto } from '@/lib/shop-settings-contract'
import type { ApiResponse } from '@/types'
import { formatSettingsDate, readSettingsApiError } from './settings-shared'

export function SettingsAccountSection({
  profile,
  isStaff,
  onProfileChange,
}: {
  profile: ShopAdminProfileDto
  isStaff: boolean
  onProfileChange: (profile: ShopAdminProfileDto) => void
}) {
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (name.trim().length < 2) {
      setError("Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      requestAnimationFrame(() => document.getElementById('account-name')?.focus())
      return
    }
    if (!isValidPhone(phone)) {
      setError("Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67")
      requestAnimationFrame(() => document.getElementById('account-phone')?.focus())
      return
    }

    setPending(true)
    try {
      const response = await fetch('/api/shop-admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      })
      if (!response.ok) throw new Error(await readSettingsApiError(response))
      const json: ApiResponse<ShopAdminProfileDto> = await response.json()
      if (!json.data) throw new Error(json.error || 'Profil topilmadi')
      await commitNavigationMutation({ kind: 'shopAdmin.profileUpdated' })
      onProfileChange(json.data)
      setName(json.data.name)
      setPhone(json.data.phone)
      setSuccess('Profil yangilandi.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Xatolik yuz berdi')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b border-zinc-100">
        <CardTitle>Profil</CardTitle>
        <CardDescription>{isStaff ? 'Sizning shaxsiy hisob ma’lumotlaringiz' : "Hisob va do'kon ma'lumotlari"}</CardDescription>
        <CardAction>
          <UserRound className="size-5 text-zinc-400" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {isStaff ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Info label="Ism" value={profile.name} />
              <Info label="Telefon" value={profile.phone} />
              <Info label="Login" value={profile.login} mono />
            </div>
            <p className="text-xs text-zinc-500">
              Ism va telefonni do&apos;kon egasi yangilaydi. Parolingizni quyidagi bo&apos;limdan o&apos;zgartirishingiz mumkin.
            </p>
            <div className="text-xs text-zinc-500">
              Parol oxirgi yangilangan: {formatSettingsDate(profile.passwordChangedAt)}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            {success && (
              <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" />
                {success}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Ism" required controlId="account-name">
                <Input
                  id="account-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                />
              </Field>
              <Field label="Telefon" required controlId="account-phone">
                <PhoneInput
                  id="account-phone"
                  value={phone}
                  onChange={setPhone}
                  className="h-9 rounded-md border-zinc-200 text-sm focus-visible:ring-zinc-900"
                />
              </Field>
              <Info label="Login" value={profile.login} mono />
              <Info label="Do'kon raqami" value={profile.shop?.shopNumber ?? '-'} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-500">
                Parol oxirgi yangilangan: {formatSettingsDate(profile.passwordChangedAt)}
              </div>
              <AsyncButton
                type="submit"
                pending={pending}
                pendingLabel="Saqlanmoqda..."
                className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
              >
                <UserRound className="size-4" />
                Saqlash
              </AsyncButton>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
