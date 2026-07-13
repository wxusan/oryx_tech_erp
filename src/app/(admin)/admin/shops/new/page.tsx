'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { navigateAfterMutation } from '@/lib/client-events'
import { isValidPhone } from '@/lib/phone'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'

interface AdminForm {
  id: string
  name: string
  phone: string
  telegramId: string
  login: string
  password: string
}

function makeAdmin(): AdminForm {
  return {
    id: Math.random().toString(36).slice(2),
    name: '',
    phone: '',
    telegramId: '',
    login: '',
    password: '',
  }
}

export default function NewShopPage() {
  const router = useRouter()

  // Shop fields
  const [shopName, setShopName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [shopNumber, setShopNumber] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')

  // Admins
  const [admins, setAdmins] = useState<AdminForm[]>([makeAdmin()])

  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const updateAdmin = (id: string, field: keyof AdminForm, value: string) => {
    setAdmins((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)))
  }

  const removeAdmin = (id: string) => {
    if (admins.length <= 1) return
    setAdmins((prev) => prev.filter((a) => a.id !== id))
  }

  const addAdmin = () => {
    setAdmins((prev) => [...prev, makeAdmin()])
  }

  const err = (val: string) => submitted && val.trim() === ''

  const formValid =
    shopName.trim() !== '' &&
    ownerName.trim() !== '' &&
    isValidPhone(ownerPhone) &&
    shopNumber.trim() !== '' &&
    admins.every((admin) =>
      admin.name.trim() !== '' &&
      isValidPhone(admin.phone) &&
      admin.login.trim() !== '' &&
      admin.password.length >= 10
    )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setFormError(null)

    if (!formValid) return

    setSaving(true)
    try {
      const res = await fetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: shopName.trim(),
          ownerName: ownerName.trim(),
          ownerPhone: ownerPhone.trim(),
          shopNumber: shopNumber.trim(),
          address: address.trim() || undefined,
          note: note.trim() || undefined,
          admins: admins.map((admin) => ({
            name: admin.name.trim(),
            phone: admin.phone.trim(),
            telegramId: admin.telegramId.trim() || undefined,
            login: admin.login.trim(),
            password: admin.password,
          })),
        }),
      })
      const json = await res.json()

      if (res.ok && json.success) {
        await navigateAfterMutation(router, '/admin/shops', {
          kind: 'admin.shopCreated',
          shopId: json.data?.id,
        })
      } else {
        setFormError(json.error ?? "Do'kon yaratishda xatolik")
      }
    } catch {
      setFormError('Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back */}
      <Link
        href="/admin/shops"
        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 mb-6 transition-colors"
      >
        ← Do&apos;konlar ro&apos;yxatiga qaytish
      </Link>

      <h1 className="text-xl font-semibold text-zinc-900 mb-1">
        Yangi do&apos;kon qo&apos;shish
      </h1>
      <p className="text-sm text-zinc-400 mb-6">
        <span className="text-red-500">*</span> belgili maydonlar majburiy
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {formError && (
          <div className="p-3 border border-red-200 bg-red-50 text-sm text-red-600">
            {formError}
          </div>
        )}

        {/* Section 1: Shop info */}
        <section className="border border-zinc-200 bg-white">
          <div className="px-5 py-4 border-b border-zinc-200">
            <h2 className="text-sm font-semibold text-zinc-900">Do&apos;kon ma&apos;lumotlari</h2>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Do'kon nomi" required error={err(shopName) ? "Bu maydon to'ldirilishi shart" : undefined}>
              <Input
                placeholder="Masalan: Malika Electronics"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className={[
                  'h-8 text-sm rounded-none border-zinc-200',
                  err(shopName) ? 'border-red-400' : '',
                ].join(' ')}
              />
            </Field>
            <Field label="Egasining ismi" required error={err(ownerName) ? "Bu maydon to'ldirilishi shart" : undefined}>
              <Input
                placeholder="To'liq ism"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className={[
                  'h-8 text-sm rounded-none border-zinc-200',
                  err(ownerName) ? 'border-red-400' : '',
                ].join(' ')}
              />
            </Field>
            <Field label="Tel raqami" required error={submitted && !isValidPhone(ownerPhone) ? "Telefon raqami noto'g'ri" : undefined}>
              <PhoneInput
                value={ownerPhone}
                onChange={setOwnerPhone}
                className={[
                  'h-8 text-sm rounded-none border-zinc-200',
                  err(ownerPhone) ? 'border-red-400' : '',
                ].join(' ')}
              />
            </Field>
            <Field label="Do'kon raqami" required error={err(shopNumber) ? "Bu maydon to'ldirilishi shart" : undefined}>
              <Input
                placeholder="Masalan: 42"
                value={shopNumber}
                onChange={(e) => setShopNumber(e.target.value)}
                className={[
                  'h-8 text-sm rounded-none border-zinc-200',
                  err(shopNumber) ? 'border-red-400' : '',
                ].join(' ')}
              />
            </Field>
            <Field label="Manzil" className="sm:col-span-2">
              <Input
                placeholder="Tuman, ko'cha, uy raqami"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="h-8 text-sm rounded-none border-zinc-200"
              />
            </Field>
            <Field label="Izoh" className="sm:col-span-2">
              <Textarea
                placeholder="Qo'shimcha ma'lumot..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[70px] text-sm rounded-none border-zinc-200 resize-none"
              />
            </Field>
          </div>
        </section>

        {/* Section 2: Admins */}
        <section className="border border-zinc-200 bg-white">
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Adminlar</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Kamida 1 ta admin qo&apos;shilishi kerak</p>
            </div>
            <button
              type="button"
              onClick={addAdmin}
              className="text-xs text-zinc-600 hover:text-zinc-900 border border-zinc-200 px-2.5 py-1.5 hover:bg-zinc-50 transition-colors"
            >
              + Yana admin qo&apos;shish
            </button>
          </div>

          <div className="divide-y divide-zinc-100">
            {admins.map((admin, idx) => (
              <div key={admin.id} className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-medium text-zinc-600">Admin #{idx + 1}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAdmin(admin.id)}
                    disabled={admins.length <= 1}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    O&apos;chirish
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Ism" required error={err(admin.name) ? "Bu maydon to'ldirilishi shart" : undefined}>
                    <Input
                      placeholder="To'liq ism"
                      value={admin.name}
                      onChange={(e) => updateAdmin(admin.id, 'name', e.target.value)}
                      className={[
                        'h-8 text-sm rounded-none border-zinc-200',
                        err(admin.name) ? 'border-red-400' : '',
                      ].join(' ')}
                    />
                  </Field>
                  <Field label="Tel" required error={submitted && !isValidPhone(admin.phone) ? "Telefon raqami noto'g'ri" : undefined}>
                    <PhoneInput
                      value={admin.phone}
                      onChange={(phone) => updateAdmin(admin.id, 'phone', phone)}
                      className={[
                        'h-8 text-sm rounded-none border-zinc-200',
                        err(admin.phone) ? 'border-red-400' : '',
                      ].join(' ')}
                    />
                  </Field>
                  <Field label="Telegram ID">
                    <Input
                      placeholder="@username"
                      value={admin.telegramId}
                      onChange={(e) => updateAdmin(admin.id, 'telegramId', e.target.value)}
                      className="h-8 text-sm rounded-none border-zinc-200"
                    />
                  </Field>
                  <Field label="Login" required error={err(admin.login) ? "Bu maydon to'ldirilishi shart" : undefined}>
                    <Input
                      placeholder="login"
                      value={admin.login}
                      onChange={(e) => updateAdmin(admin.id, 'login', e.target.value)}
                      className={[
                        'h-8 text-sm rounded-none border-zinc-200',
                        err(admin.login) ? 'border-red-400' : '',
                      ].join(' ')}
                    />
                  </Field>
                  <Field label="Parol" required error={submitted && admin.password.length < 10 ? "Parol kamida 10 ta belgidan iborat bo'lishi kerak" : undefined} className="sm:col-span-2">
                    <Input
                      type="password"
                      placeholder="Kamida 10 ta belgi"
                      value={admin.password}
                      onChange={(e) => updateAdmin(admin.id, 'password', e.target.value)}
                      className={[
                        'h-8 text-sm rounded-none border-zinc-200',
                        err(admin.password) ? 'border-red-400' : '',
                      ].join(' ')}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Submit */}
        <button
          type="submit"
          disabled={saving}
          className="w-full h-10 bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition-colors"
        >
          {saving ? 'Saqlanmoqda...' : "Do'konni yaratish"}
        </button>
      </form>
    </div>
  )
}
