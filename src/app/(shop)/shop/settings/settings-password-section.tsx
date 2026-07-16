'use client'

import { type FormEvent, useState } from 'react'
import { signOut } from 'next-auth/react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { SettingsPasswordField as PasswordField } from '@/components/shop/settings-password-field'
import { AsyncButton } from '@/components/ui/async-button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { readSettingsApiError } from './settings-shared'

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

export function SettingsPasswordSection() {
  const [form, setForm] = useState<PasswordForm>(emptyPasswordForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pending, setPending] = useState(false)
  const canSubmit = form.currentPassword.length > 0 && form.newPassword.length >= 10 && form.confirmPassword.length >= 10

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (form.newPassword !== form.confirmPassword) {
      setError('Yangi parol va tasdiq bir xil emas')
      requestAnimationFrame(() => document.getElementById('confirm-password')?.focus())
      return
    }

    setPending(true)
    try {
      const response = await fetch('/api/shop-admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      })
      if (!response.ok) throw new Error(await readSettingsApiError(response))
      setForm(emptyPasswordForm)
      setSuccess("Parol yangilandi. Qayta kirish oynasiga yo'naltirilasiz.")
      window.setTimeout(() => {
        void signOut({ callbackUrl: '/shop/login?callbackUrl=/shop/settings' })
      }, 900)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Xatolik yuz berdi')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="rounded-lg lg:col-span-2">
      <CardHeader className="border-b border-zinc-100">
        <CardTitle>Parolni yangilash</CardTitle>
        <CardDescription>Joriy parolni tasdiqlab, yangi parol kiriting</CardDescription>
        <CardAction><ShieldCheck className="size-5 text-zinc-400" /></CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {success && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>}
          <PasswordField
            id="current-password"
            label="Joriy parol"
            value={form.currentPassword}
            onChange={(currentPassword) => setForm((current) => ({ ...current, currentPassword }))}
          />
          <PasswordField
            id="new-password"
            label="Yangi parol"
            value={form.newPassword}
            onChange={(newPassword) => setForm((current) => ({ ...current, newPassword }))}
          />
          <PasswordField
            id="confirm-password"
            label="Yangi parolni tasdiqlash"
            value={form.confirmPassword}
            onChange={(confirmPassword) => setForm((current) => ({ ...current, confirmPassword }))}
          />
          <AsyncButton
            type="submit"
            disabled={!canSubmit}
            pending={pending}
            pendingLabel="Yangilanmoqda..."
            className="h-9 rounded-md bg-zinc-900 text-white hover:bg-zinc-800"
          >
            <KeyRound className="size-4" />
            Parolni yangilash
          </AsyncButton>
        </form>
      </CardContent>
    </Card>
  )
}
