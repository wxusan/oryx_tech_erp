'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, ShieldCheck, UserRoundCog } from 'lucide-react'
import { commitNavigationMutation } from '@/lib/client-events'
import {
  SHOP_PERMISSION_CATALOG,
  type ShopPermissionCode,
} from '@/lib/access-control'
import type { ShopStaffDto } from '@/lib/shop-staff-contract'
import { formatUzPhoneDisplay, isValidPhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Field } from '@/components/ui/field'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const assignablePermissions = SHOP_PERMISSION_CATALOG.filter((item) => !item.ownerOnly)

interface StaffForm {
  name: string
  phone: string
  login: string
  password: string
  telegramId: string
  telegramNotificationsEnabled: boolean
  permissionCodes: ShopPermissionCode[]
  isActive: boolean
  note: string
}

const emptyForm: StaffForm = {
  name: '',
  phone: '',
  login: '',
  password: '',
  telegramId: '',
  telegramNotificationsEnabled: false,
  permissionCodes: [],
  isActive: true,
  note: '',
}

async function apiError(response: Response) {
  try {
    const payload = await response.json()
    return payload.error ?? 'Xatolik yuz berdi'
  } catch {
    return 'Xatolik yuz berdi'
  }
}

export function StaffManagement() {
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ShopStaffDto | null>(null)
  const [form, setForm] = useState<StaffForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const staffQuery = useQuery({
    queryKey: [...queryKeys.domain(scope, 'access'), 'staff'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/shop/staff', { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      const payload = await response.json()
      return (payload.data ?? []) as ShopStaffDto[]
    },
  })
  const staff = staffQuery.data ?? []
  const loading = staffQuery.isPending && !staffQuery.data
  const error = staffQuery.error instanceof Error ? staffQuery.error.message : ''

  const valid = useMemo(() => {
    if (form.name.trim().length < 2 || !isValidPhone(form.phone)) return false
    if (!editing && (form.login.trim().length < 3 || form.password.length < 10)) return false
    if (editing && form.password && form.password.length < 10) return false
    if (editing && form.note.trim().length < 5) return false
    return true
  }, [editing, form])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(member: ShopStaffDto) {
    setEditing(member)
    setForm({
      name: member.name,
      phone: member.phone,
      login: member.login,
      password: '',
      telegramId: member.telegramId ?? '',
      telegramNotificationsEnabled: member.telegramNotificationsEnabled,
      permissionCodes: member.permissionCodes,
      isActive: member.isActive,
      note: '',
    })
    setFormError('')
    setDialogOpen(true)
  }

  function togglePermission(code: ShopPermissionCode) {
    setForm((current) => ({
      ...current,
      permissionCodes: current.permissionCodes.includes(code)
        ? current.permissionCodes.filter((item) => item !== code)
        : [...current.permissionCodes, code],
    }))
  }

  async function save() {
    if (!valid) return
    setSaving(true)
    setFormError('')
    try {
      const response = await fetch(editing ? `/api/shop/staff/${editing.id}` : '/api/shop/staff', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? {
          name: form.name.trim(),
          phone: form.phone,
          password: form.password || undefined,
          telegramNotificationsEnabled: form.telegramNotificationsEnabled,
          permissionCodes: form.permissionCodes,
          isActive: form.isActive,
          note: form.note.trim(),
        } : {
          name: form.name.trim(),
          phone: form.phone,
          login: form.login.trim(),
          password: form.password,
          telegramId: form.telegramId.trim() || undefined,
          telegramNotificationsEnabled: form.telegramNotificationsEnabled,
          permissionCodes: form.permissionCodes,
        }),
      })
      if (!response.ok) throw new Error(await apiError(response))
      await commitNavigationMutation({ kind: 'shop.staffUpdated' })
      setDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.domain(scope, 'access') })
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Xodimlar</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Xodim profillari bepul. Ular do&apos;kon paketining narxini oshirmaydi.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-zinc-900 text-white hover:bg-zinc-800">
          <Plus className="size-4" /> Xodim qo&apos;shish
        </Button>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <ShieldCheck className="mr-2 inline size-4" />
        Faqat siz belgilagan amallar ishlaydi. Hisobot, log, sozlama va xodim boshqaruvi xodimlarga berilmaydi.
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" /> Yuklanmoqda...</div>
      ) : staff.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <UserRoundCog className="mx-auto mb-3 size-8 text-zinc-300" />
          <p className="font-medium text-zinc-800">Hozircha xodim profili yo&apos;q</p>
          <p className="mt-1 text-sm text-zinc-500">Do&apos;kon faqat egasi profili bilan ishlaydi.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {staff.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => openEdit(member)}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition hover:border-zinc-400 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-zinc-900">{member.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-zinc-500">{member.login} · {formatUzPhoneDisplay(member.phone)}</div>
                </div>
                <span className={member.isActive ? 'bg-emerald-100 px-2 py-1 text-xs text-emerald-800' : 'bg-zinc-100 px-2 py-1 text-xs text-zinc-500'}>
                  {member.isActive ? 'Faol' : 'Nofaol'}
                </span>
              </div>
              <div className="mt-3 text-xs text-zinc-500">
                {member.permissionCodes.length} ta ruxsat · Telegram {member.telegramNotificationsEnabled ? 'yoqilgan' : "o'chirilgan"}
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Xodimni boshqarish' : "Yangi xodim qo'shish"}</DialogTitle></DialogHeader>
          {formError && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ism" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field label="Telefon" required><PhoneInput value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} /></Field>
            <Field label="Login" required={!editing}><Input disabled={Boolean(editing)} value={form.login} onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))} /></Field>
            <Field label={editing ? 'Yangi parol (ixtiyoriy)' : 'Parol'} required={!editing}><Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Kamida 10 ta belgi" /></Field>
            {!editing && <Field label="Telegram ID"><Input inputMode="numeric" value={form.telegramId} onChange={(event) => setForm((current) => ({ ...current, telegramId: event.target.value.replace(/\D/g, '') }))} /></Field>}
          </div>

          <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3">
            <legend className="px-1 text-sm font-semibold text-zinc-900">Operatsion ruxsatlar</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {assignablePermissions.map((permission) => (
                <label key={permission.code} htmlFor={`staff-permission-${permission.code.toLowerCase()}`} className="flex cursor-pointer items-start gap-2 rounded border border-zinc-100 p-2 text-sm hover:bg-zinc-50">
                  <input id={`staff-permission-${permission.code.toLowerCase()}`} type="checkbox" checked={form.permissionCodes.includes(permission.code)} onChange={() => togglePermission(permission.code)} className="mt-0.5" />
                  <span>{permission.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label htmlFor="staff-telegram-enabled" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Telegram xabarlari</span><span className="text-xs text-zinc-500">Egasi xodim uchun alohida boshqaradi</span></span>
            <input id="staff-telegram-enabled" type="checkbox" checked={form.telegramNotificationsEnabled} onChange={(event) => setForm((current) => ({ ...current, telegramNotificationsEnabled: event.target.checked }))} />
          </label>
          {editing && (
            <>
              <label htmlFor="staff-account-active" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
                <span className="font-medium">Xodim faol</span>
                <input id="staff-account-active" type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
              </label>
              <Field label="O'zgarish sababi" required><Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Kamida 5 ta belgi" /></Field>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Bekor qilish</Button>
            <Button disabled={!valid || saving} onClick={() => void save()} className="bg-zinc-900 text-white hover:bg-zinc-800">
              {saving && <Loader2 className="size-4 animate-spin" />} Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
