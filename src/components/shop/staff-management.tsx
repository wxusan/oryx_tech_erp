'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, ShieldCheck, Trash2, UserRoundCog } from 'lucide-react'
import { commitNavigationMutation } from '@/lib/client-events'
import {
  SHOP_PERMISSION_CATALOG,
  permissionRequiredFeatures,
  type ShopPermissionGroup,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { STAFF_LOGS_PERMISSION, type ShopStaffDto } from '@/lib/shop-staff-contract'
import { formatUzPhoneDisplay, isValidPhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Field } from '@/components/ui/field'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import { useShopAccess } from '@/components/shop/shop-access-context'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const assignablePermissions = SHOP_PERMISSION_CATALOG.filter(
  (item) => !item.ownerOnly && !item.retired && item.code !== STAFF_LOGS_PERMISSION,
)

const groupLabels: Record<ShopPermissionGroup, string> = {
  INVENTORY: 'Qurilmalar va ombor',
  SALES: 'Sotuv va qaytarish',
  NASIYA: 'Nasiya',
  OLIB: 'Olib-sotdim',
  CUSTOMERS: 'Mijozlar va pasport',
  INSIGHTS: 'Boshqaruv, hisobot va loglar',
  DATA: 'Import va eksport',
  STAFF: 'Xodimlarni boshqarish',
  SETTINGS: "Do'kon sozlamalari",
}

const riskLabels = {
  ROUTINE: 'Oddiy',
  FINANCIAL: 'Moliyaviy',
  PRIVATE: 'Maxfiy',
  DESTRUCTIVE: 'Muhim',
  ADMINISTRATIVE: 'Admin',
} as const

interface StaffForm {
  name: string
  phone: string
  login: string
  password: string
  telegramId: string
  telegramNotificationsEnabled: boolean
  logsViewEnabled: boolean
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
  logsViewEnabled: false,
  permissionCodes: [],
  isActive: true,
  note: '',
}

const staffPermissionPresets: ReadonlyArray<{
  id: string
  label: string
  permissionCodes: readonly ShopPermissionCode[]
}> = [
  { id: 'cashier', label: 'Kassir', permissionCodes: ['SALE_CREATE', 'SALE_PAYMENT_RECEIVE', 'RECEIVABLES_VIEW', 'CUSTOMER_CREATE'] },
  { id: 'inventory', label: 'Omborchi', permissionCodes: ['INVENTORY_VIEW', 'DEVICE_CREATE', 'DEVICE_EDIT'] },
  { id: 'nasiya-collector', label: 'Nasiya undiruvchi', permissionCodes: ['RECEIVABLES_VIEW', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER', 'NASIYA_REMINDER_MANAGE'] },
  { id: 'supervisor', label: 'Nazoratchi', permissionCodes: ['INVENTORY_VIEW', 'SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE', 'NASIYA_VIEW', 'NASIYA_EDIT', 'NASIYA_REMINDER_MANAGE', 'OLIB_VIEW', 'CUSTOMER_VIEW', 'DASHBOARD_OPERATIONAL_VIEW'] },
  { id: 'accountant', label: 'Hisobchi', permissionCodes: ['DASHBOARD_FINANCIAL_VIEW', 'REPORT_VIEW', 'EXPORT_SALES', 'EXPORT_NASIYA', 'EXPORT_OLIB', 'EXPORT_RETURNS', 'EXPORT_REPORTS'] },
]

async function apiError(response: Response) {
  try {
    const payload = await response.json()
    return payload.error ?? 'Xatolik yuz berdi'
  } catch {
    return 'Xatolik yuz berdi'
  }
}

export function StaffManagement() {
  const { can, enabledFeatures, memberKind } = useShopAccess()
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ShopStaffDto | null>(null)
  const [form, setForm] = useState<StaffForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const canCreate = can('STAFF_CREATE')
  const canEditProfile = can('STAFF_EDIT_PROFILE')
  const canResetPassword = can('STAFF_RESET_PASSWORD')
  const canManageStatus = can('STAFF_STATUS_MANAGE')
  const canManagePermissions = can('STAFF_PERMISSION_MANAGE')
  const canManageNotifications = can('STAFF_NOTIFICATION_MANAGE')
  const canDelete = can('STAFF_DELETE')
  const canUpdate = canEditProfile || canResetPassword || canManageStatus ||
    canManagePermissions || canManageNotifications
  const hasRosterWorkflow = can('STAFF_VIEW') || canUpdate || canDelete
  const staffQuery = useQuery({
    queryKey: [...queryKeys.domain(scope, 'access'), 'staff'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/shop/staff', { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      const payload = await response.json()
      return (payload.data ?? []) as ShopStaffDto[]
    },
    enabled: hasRosterWorkflow,
  })
  const staff = staffQuery.data ?? []
  const loading = hasRosterWorkflow && staffQuery.isPending && !staffQuery.data
  const error = staffQuery.error instanceof Error ? staffQuery.error.message : ''

  const isOwner = memberKind === 'SHOP_OWNER'
  const permissionGroups = useMemo(() => {
    const visible = assignablePermissions.filter((permission) => (
      isOwner || permission.staffManagerDelegable
    ))
    return Object.entries(groupLabels).map(([group, label]) => ({
      group: group as ShopPermissionGroup,
      label,
      permissions: visible.filter((permission) => permission.group === group),
    })).filter((section) => section.permissions.length > 0)
  }, [isOwner])
  const availablePresetPermissions = useMemo(() => new Set(
    assignablePermissions
      .filter((permission) => isOwner || permission.staffManagerDelegable)
      .filter((permission) => permissionRequiredFeatures(permission.code).every((feature) => enabledFeatures.has(feature)))
      .map((permission) => permission.code),
  ), [enabledFeatures, isOwner])
  const presetOptions = useMemo(() => staffPermissionPresets.map((preset) => ({
    ...preset,
    permissionCodes: preset.permissionCodes.filter((code) => availablePresetPermissions.has(code)),
  })), [availablePresetPermissions])

  const valid = useMemo(() => {
    if ((!editing || canEditProfile) && (form.name.trim().length < 2 || !isValidPhone(form.phone))) return false
    if (!editing && (form.login.trim().length < 3 || form.password.length < 10)) return false
    if (editing && canResetPassword && form.password && form.password.length < 10) return false
    if (editing && form.note.trim().length < 5) return false
    return true
  }, [canEditProfile, canResetPassword, editing, form])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setSubmitted(false)
    setDialogOpen(true)
  }

  function openEdit(member: ShopStaffDto) {
    setEditing(member)
    setForm({
      name: member.name,
      phone: member.phone ?? '',
      login: member.login,
      password: '',
      telegramId: member.telegramId ?? '',
      telegramNotificationsEnabled: Boolean(
        member.telegramNotificationsEnabled && enabledFeatures.has('TELEGRAM'),
      ),
      logsViewEnabled: member.logsViewEnabled ?? false,
      permissionCodes: member.permissionCodes ?? [],
      isActive: member.isActive ?? true,
      note: '',
    })
    setFormError('')
    setSubmitted(false)
    setDialogOpen(true)
  }

  function togglePermission(code: ShopPermissionCode) {
    const definition = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
    const enabling = !form.permissionCodes.includes(code)
    if (
      enabling &&
      isOwner &&
      definition &&
      definition.risk !== 'ROUTINE' &&
      !window.confirm(`${definition.label}: ${riskLabels[definition.risk]} ruxsatini xodimga berishni tasdiqlaysizmi?`)
    ) return
    setForm((current) => ({
      ...current,
      permissionCodes: current.permissionCodes.includes(code)
        ? current.permissionCodes.filter((item) => item !== code)
        : [...current.permissionCodes, code],
    }))
  }

  function applyPreset(permissionCodes: readonly ShopPermissionCode[]) {
    const sensitiveAdditions = permissionCodes.filter((code) => {
      const definition = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
      return !form.permissionCodes.includes(code) && definition?.risk !== 'ROUTINE'
    })
    if (
      isOwner && sensitiveAdditions.length > 0 &&
      !window.confirm(`${sensitiveAdditions.length} ta muhim ruxsatni yoqishni tasdiqlaysizmi?`)
    ) return
    setForm((current) => ({ ...current, permissionCodes: [...permissionCodes] }))
  }

  async function save(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setSubmitted(true)
    if (!valid) {
      setFormError("Majburiy maydonlarni tekshiring")
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const updateBody: Record<string, unknown> = { note: form.note.trim() }
      if (canEditProfile) Object.assign(updateBody, { name: form.name.trim(), phone: form.phone })
      if (canResetPassword && form.password) updateBody.password = form.password
      if (canManageStatus) updateBody.isActive = form.isActive
      if (canManagePermissions) {
        updateBody.permissionCodes = form.permissionCodes
        if (isOwner) updateBody.logsViewEnabled = form.logsViewEnabled
      }
      if (canManageNotifications && enabledFeatures.has('TELEGRAM')) {
        updateBody.telegramNotificationsEnabled = form.telegramNotificationsEnabled
      }
      const response = await fetch(editing ? `/api/shop/staff/${editing.id}` : '/api/shop/staff', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? updateBody : {
          name: form.name.trim(),
          phone: form.phone,
          login: form.login.trim(),
          password: form.password,
          telegramId: form.telegramId.trim() || undefined,
          telegramNotificationsEnabled: isOwner && enabledFeatures.has('TELEGRAM')
            ? form.telegramNotificationsEnabled
            : false,
          logsViewEnabled: isOwner ? form.logsViewEnabled : false,
          permissionCodes: isOwner ? form.permissionCodes : [],
          isActive: form.isActive,
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

  async function deleteStaff() {
    if (!editing || form.note.trim().length < 5) {
      setSubmitted(true)
      setFormError("O'chirish uchun kamida 5 belgili sabab kiriting")
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const response = await fetch(`/api/shop/staff/${editing.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: form.note.trim() }),
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
        {canCreate && <Button onClick={openCreate} className="bg-zinc-900 text-white hover:bg-zinc-800">
          <Plus className="size-4" /> Xodim qo&apos;shish
        </Button>}
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <ShieldCheck className="mr-2 inline size-4" />
        Har bir ruxsat mustaqil ishlaydi. Telegram xabarlari yangi xodim uchun avvaldan o&apos;chirilgan bo&apos;ladi.
      </div>

      {hasRosterWorkflow && error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {hasRosterWorkflow && (loading ? (
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
              disabled={!canUpdate && !canDelete}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition enabled:hover:border-zinc-400 enabled:hover:shadow-sm disabled:cursor-default"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-zinc-900">{member.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-zinc-500">{member.login}{member.phone ? ` · ${formatUzPhoneDisplay(member.phone)}` : ''}</div>
                </div>
                {member.isActive !== null && <span className={member.isActive ? 'bg-emerald-100 px-2 py-1 text-xs text-emerald-800' : 'bg-zinc-100 px-2 py-1 text-xs text-zinc-500'}>
                  {member.isActive ? 'Faol' : 'Nofaol'}
                </span>}
              </div>
              {(member.permissionCodes !== null || member.logsViewEnabled !== null || member.telegramNotificationsEnabled !== null) && <div className="mt-3 text-xs text-zinc-500">
                {[
                  member.permissionCodes !== null ? `${member.permissionCodes.length} ta ruxsat` : null,
                  member.logsViewEnabled !== null ? `Loglar ${member.logsViewEnabled ? 'yoqilgan' : "o'chirilgan"}` : null,
                  member.telegramNotificationsEnabled !== null ? `Telegram ${member.telegramNotificationsEnabled ? 'yoqilgan' : "o'chirilgan"}` : null,
                ].filter(Boolean).join(' · ')}
              </div>}
            </button>
          ))}
        </div>
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Xodimni boshqarish' : "Yangi xodim qo'shish"}</DialogTitle></DialogHeader>
          <form onSubmit={(event) => void save(event)} className="space-y-4" autoComplete="off" noValidate>
          {formError && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field controlId="staff-name" label="Ism" required error={submitted && form.name.trim().length < 2 ? "Ism kamida 2 ta belgidan iborat bo'lishi kerak" : undefined}><Input disabled={Boolean(editing) && !canEditProfile} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field controlId="staff-phone" label="Telefon" required error={submitted && !isValidPhone(form.phone) ? "Telefon raqami noto'g'ri" : undefined}><PhoneInput disabled={Boolean(editing) && !canEditProfile} value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} /></Field>
            <Field controlId="staff-login" label="Login" required={!editing} error={submitted && !editing && form.login.trim().length < 3 ? "Login kamida 3 ta belgidan iborat bo'lishi kerak" : undefined}><Input autoComplete="off" disabled={Boolean(editing)} value={form.login} onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))} /></Field>
            <Field controlId="staff-password" label={editing ? 'Yangi parol (ixtiyoriy)' : 'Parol'} required={!editing} error={submitted && ((!editing && form.password.length < 10) || (Boolean(editing) && Boolean(form.password) && form.password.length < 10)) ? "Parol kamida 10 ta belgidan iborat bo'lishi kerak" : undefined}><Input autoComplete="new-password" disabled={Boolean(editing) && !canResetPassword} type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Kamida 10 ta belgi" /></Field>
            {!editing && <Field label="Telegram ID"><Input inputMode="numeric" value={form.telegramId} onChange={(event) => setForm((current) => ({ ...current, telegramId: event.target.value.replace(/\D/g, '') }))} /></Field>}
          </div>

          {((!editing && isOwner) || (editing && canManagePermissions)) && (
            <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-3" aria-label="Ruxsat andozalari">
              {presetOptions.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={preset.permissionCodes.length === 0}
                  onClick={() => applyPreset(preset.permissionCodes)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          )}

          {((!editing && isOwner) || (editing && canManagePermissions)) && permissionGroups.map((section) => (
            <fieldset key={section.group} className="space-y-2 border-t border-zinc-200 pt-3">
              <legend className="text-sm font-semibold text-zinc-900">{section.label}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {section.permissions.map((permission) => {
                  const packageEnabled = permissionRequiredFeatures(permission.code).every((feature) => enabledFeatures.has(feature))
                  return (
                    <label key={permission.code} htmlFor={`staff-permission-${permission.code.toLowerCase()}`} className={`flex items-start gap-2 border border-zinc-200 p-2 text-sm ${packageEnabled ? 'cursor-pointer hover:bg-zinc-50' : 'cursor-not-allowed bg-zinc-50 opacity-60'}`}>
                      <input id={`staff-permission-${permission.code.toLowerCase()}`} type="checkbox" disabled={!packageEnabled} checked={form.permissionCodes.includes(permission.code)} onChange={() => togglePermission(permission.code)} className="mt-0.5" />
                      <span className="min-w-0"><span className="block font-medium text-zinc-800">{permission.label}</span><span className="block text-xs text-zinc-500">{permission.description} · {riskLabels[permission.risk]}{packageEnabled ? '' : ' · Paketda yoqilmagan'}</span></span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))}

          {isOwner && ((!editing) || canManagePermissions) && <label htmlFor="staff-logs-enabled" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Loglarni ko&apos;rish</span><span className="text-xs text-zinc-500">Egasi xodim uchun alohida boshqaradi. Moliyaviy hisobotlar berilmaydi.</span></span>
            <input id="staff-logs-enabled" type="checkbox" checked={form.logsViewEnabled} onChange={(event) => {
              if (event.target.checked && !window.confirm("Faoliyat loglari maxfiy ma'lumot bo'lishi mumkin. Ruxsatni yoqishni tasdiqlaysizmi?")) return
              setForm((current) => ({ ...current, logsViewEnabled: event.target.checked }))
            }} />
          </label>}

          {((!editing && isOwner) || (editing && canManageNotifications)) && <label htmlFor="staff-telegram-enabled" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Telegram xabarlari</span><span className="text-xs text-zinc-500">{enabledFeatures.has('TELEGRAM') ? 'Egasi xodim uchun alohida boshqaradi' : 'Paketda yoqilmagan'}</span></span>
            <input id="staff-telegram-enabled" type="checkbox" disabled={!enabledFeatures.has('TELEGRAM')} checked={form.telegramNotificationsEnabled} onChange={(event) => setForm((current) => ({ ...current, telegramNotificationsEnabled: event.target.checked }))} />
          </label>}
          {(!editing || canManageStatus) && <label htmlFor="staff-account-active" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span className="font-medium">Xodim faol</span>
            <input id="staff-account-active" type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
          </label>}
          {editing && (
            <>
              <Field controlId="staff-change-note" label="Sabab" required help="Xodim ruxsati yoki profili o'zgarishi uchun audit sababi." error={submitted && form.note.trim().length < 5 ? "Sabab kamida 5 ta belgidan iborat bo'lishi kerak" : undefined}><Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Kamida 5 ta belgi" /></Field>
            </>
          )}
          <DialogFooter>
            {editing && canDelete && <Button type="button" variant="destructive" disabled={saving} onClick={() => void deleteStaff()}><Trash2 className="size-4" /> O&apos;chirish</Button>}
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Bekor qilish</Button>
            {(!editing || canUpdate) && <Button type="submit" disabled={saving} className="bg-zinc-900 text-white hover:bg-zinc-800">
              {saving && <Loader2 className="size-4 animate-spin" />} Saqlash
            </Button>}
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
