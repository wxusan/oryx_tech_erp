'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, ShieldCheck, Trash2, UserRoundCog, UsersRound } from 'lucide-react'
import { commitNavigationMutation } from '@/lib/client-events'
import {
  SHOP_PERMISSION_CATALOG,
  permissionRequiredFeatures,
  type ShopPermissionGroup,
  type ShopPermissionCode,
} from '@/lib/access-control'
import {
  NASIYA_ARCHIVE_PERMISSION_BUNDLE,
  STAFF_LOGS_PERMISSION,
  withNasiyaArchivePermissionBundle,
  type ShopStaffDto,
} from '@/lib/shop-staff-contract'
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
import { AsyncButton } from '@/components/ui/async-button'
import { QueryActivity } from '@/components/query-activity'
import { markQueryIntent } from '@/lib/client-performance'
import type { ShopStaffRoleDto } from '@/lib/shop-staff-role-contract'
import { StaffRoleManagement } from '@/components/shop/staff-role-management'

const assignablePermissions = SHOP_PERMISSION_CATALOG.filter(
  (item) => !item.ownerOnly && !item.retired &&
    item.code !== STAFF_LOGS_PERMISSION && item.code !== 'NASIYA_REOPEN',
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
  ROUTINE: 'Oddiy amal',
  FINANCIAL: 'Moliyaviy amal',
  PRIVATE: 'Maxfiy ma’lumot',
  DESTRUCTIVE: 'Qaytarib bo‘lmaydigan amal',
  ADMINISTRATIVE: 'Ma’muriy amal',
} as const

const loginPattern = /^[a-zA-Z0-9_]+$/

interface StaffForm {
  name: string
  phone: string
  login: string
  password: string
  telegramId: string
  telegramNotificationsEnabled: boolean
  logsViewEnabled: boolean
  permissionCodes: ShopPermissionCode[]
  accessMode: 'ROLE' | 'INDIVIDUAL' | 'NONE'
  roleId: string | null
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
  accessMode: 'NONE',
  roleId: null,
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

export function StaffManagement({
  initialStaff,
  initialRoles,
}: {
  initialStaff: ShopStaffDto[]
  initialRoles: ShopStaffRoleDto[]
}) {
  const { can, enabledFeatures, memberKind } = useShopAccess()
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ShopStaffDto | null>(null)
  const [form, setForm] = useState<StaffForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [activeTab, setActiveTab] = useState<'EMPLOYEES' | 'ROLES'>('EMPLOYEES')
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
    initialData: hasRosterWorkflow ? initialStaff : undefined,
  })
  const rolesQuery = useQuery({
    queryKey: [...queryKeys.domain(scope, 'access'), 'staff-roles'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/shop/staff/roles', { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      const payload = await response.json()
      return (payload.data ?? []) as ShopStaffRoleDto[]
    },
    enabled: hasRosterWorkflow || canCreate || canManagePermissions,
    initialData: initialRoles,
  })
  const staff = staffQuery.data ?? []
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data])
  const loading = hasRosterWorkflow && staffQuery.isPending && !staffQuery.data
  const error = staffQuery.error instanceof Error ? staffQuery.error.message : null

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
  const assignableRoles = useMemo(() => roles.filter((role) => role.assignable && !role.isArchived), [roles])

  const valid = useMemo(() => {
    if ((!editing || canEditProfile) && (form.name.trim().length < 2 || !isValidPhone(form.phone))) return false
    const loginChanged = Boolean(editing && isOwner && form.login.trim() !== editing.login)
    if ((!editing || loginChanged) && (form.login.trim().length < 3 || !loginPattern.test(form.login.trim()))) return false
    if (!editing && form.password.length < 10) return false
    if (editing && canResetPassword && form.password && form.password.length < 10) return false
    if (editing && form.note.trim().length < 5) return false
    return true
  }, [canEditProfile, canResetPassword, editing, form, isOwner])

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
      permissionCodes: withNasiyaArchivePermissionBundle(member.permissionCodes ?? []),
      accessMode: member.staffRole
        ? 'ROLE'
        : (member.permissionCodes?.length || member.logsViewEnabled)
          ? 'INDIVIDUAL'
          : 'NONE',
      roleId: member.staffRole?.id ?? null,
      isActive: member.isActive ?? true,
      note: '',
    })
    setFormError('')
    setSubmitted(false)
    setDialogOpen(true)
  }

  function togglePermission(code: ShopPermissionCode) {
    const definition = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
    const isArchiveBundle = code === 'NASIYA_ARCHIVE'
    const enabling = isArchiveBundle
      ? !NASIYA_ARCHIVE_PERMISSION_BUNDLE.every((permission) => form.permissionCodes.includes(permission))
      : !form.permissionCodes.includes(code)
    if (
      enabling &&
      isOwner &&
      definition &&
      definition.risk !== 'ROUTINE' &&
      !window.confirm(`${definition.label}: ${riskLabels[definition.risk]} ruxsatini xodimga berishni tasdiqlaysizmi?`)
    ) return
    setForm((current) => ({
      ...current,
      accessMode: 'INDIVIDUAL',
      roleId: null,
      permissionCodes: isArchiveBundle
        ? enabling
          ? withNasiyaArchivePermissionBundle([...current.permissionCodes, 'NASIYA_ARCHIVE'])
          : current.permissionCodes.filter((item) => !NASIYA_ARCHIVE_PERMISSION_BUNDLE.includes(item as typeof NASIYA_ARCHIVE_PERMISSION_BUNDLE[number]))
        : current.permissionCodes.includes(code)
          ? current.permissionCodes.filter((item) => item !== code)
          : [...current.permissionCodes, code],
    }))
  }

  function selectAccess(value: string) {
    if (value === 'NONE') {
      setForm((current) => ({
        ...current,
        accessMode: 'NONE',
        roleId: null,
        permissionCodes: [],
        logsViewEnabled: false,
      }))
      return
    }
    if (value === 'INDIVIDUAL') {
      setForm((current) => ({ ...current, accessMode: 'INDIVIDUAL', roleId: null }))
      return
    }
    const role = assignableRoles.find((item) => item.id === value)
    if (!role) return
    setForm((current) => ({
      ...current,
      accessMode: 'ROLE',
      roleId: role.id,
      permissionCodes: withNasiyaArchivePermissionBundle(role.permissionCodes),
      logsViewEnabled: role.logsViewEnabled,
    }))
  }

  async function save(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setSubmitted(true)
    if (!valid) {
      setFormError("Majburiy maydonlarni tekshiring")
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    const loginChanged = Boolean(editing && isOwner && form.login.trim() !== editing.login)
    if (loginChanged && !window.confirm(`Login ${editing?.login} dan ${form.login.trim()} ga o'zgartiriladi. Xodim qayta kirishi kerak bo'ladi. Davom etasizmi?`)) {
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const updateBody: Record<string, unknown> = { note: form.note.trim() }
      if (canEditProfile) Object.assign(updateBody, { name: form.name.trim(), phone: form.phone })
      if (loginChanged) Object.assign(updateBody, { login: form.login.trim() })
      if (canResetPassword && form.password) updateBody.password = form.password
      if (canManageStatus) updateBody.isActive = form.isActive
      if (canManagePermissions) {
        const currentMode = editing?.staffRole
          ? 'ROLE'
          : (editing?.permissionCodes?.length || editing?.logsViewEnabled)
            ? 'INDIVIDUAL'
            : 'NONE'
        if (form.accessMode === 'ROLE') {
          if (currentMode !== 'ROLE' || editing?.staffRole?.id !== form.roleId) updateBody.roleId = form.roleId
        } else {
          const directCodesChanged = JSON.stringify([...form.permissionCodes].sort()) !==
            JSON.stringify([...(editing?.permissionCodes ?? [])].sort())
          const logsChanged = isOwner && form.logsViewEnabled !== Boolean(editing?.logsViewEnabled)
          if (currentMode === 'ROLE') updateBody.roleId = null
          if (directCodesChanged || logsChanged || currentMode !== form.accessMode) {
            updateBody.permissionCodes = form.accessMode === 'NONE' ? [] : form.permissionCodes
            if (isOwner) updateBody.logsViewEnabled = form.accessMode === 'NONE' ? false : form.logsViewEnabled
          }
        }
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
          telegramId: isOwner && enabledFeatures.has('TELEGRAM') && form.telegramNotificationsEnabled
            ? form.telegramId.trim() || undefined
            : undefined,
          telegramNotificationsEnabled: isOwner && enabledFeatures.has('TELEGRAM')
            ? form.telegramNotificationsEnabled
            : false,
          roleId: isOwner && form.accessMode === 'ROLE' ? form.roleId : null,
          logsViewEnabled: isOwner && form.accessMode === 'INDIVIDUAL' ? form.logsViewEnabled : false,
          permissionCodes: isOwner && form.accessMode === 'INDIVIDUAL' ? form.permissionCodes : [],
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
          <h1 className="text-xl font-bold text-zinc-900">Xodimlar va lavozimlar</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Xodim profillari bepul. Ular do&apos;kon paketining narxini oshirmaydi.
          </p>
        </div>
        {activeTab === 'EMPLOYEES' && canCreate && <Button onClick={openCreate} className="bg-zinc-900 text-white hover:bg-zinc-800">
          <Plus className="size-4" /> Xodim qo&apos;shish
        </Button>}
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <ShieldCheck className="mr-2 inline size-4" />
        Har bir ruxsat mustaqil ishlaydi. Telegram xabarlari yangi xodim uchun avvaldan o&apos;chirilgan bo&apos;ladi.
      </div>

      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1" role="tablist" aria-label="Xodim boshqaruvi">
        <button
          type="button"
          role="tab"
          id="staff-employees-tab"
          aria-controls="staff-employees-panel"
          aria-selected={activeTab === 'EMPLOYEES'}
          onClick={() => setActiveTab('EMPLOYEES')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${activeTab === 'EMPLOYEES' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'}`}
        >
          <UsersRound className="size-4" /> Xodimlar
        </button>
        <button
          type="button"
          role="tab"
          id="staff-roles-tab"
          aria-controls="staff-roles-panel"
          aria-selected={activeTab === 'ROLES'}
          onClick={() => setActiveTab('ROLES')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${activeTab === 'ROLES' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'}`}
        >
          <ShieldCheck className="size-4" /> Lavozimlar
        </button>
      </div>

      {activeTab === 'ROLES' && <div id="staff-roles-panel" role="tabpanel" aria-labelledby="staff-roles-tab">
        <StaffRoleManagement
          roles={roles}
          staff={staff}
          isOwner={isOwner}
          isFetching={rolesQuery.isFetching}
          error={rolesQuery.error instanceof Error ? rolesQuery.error.message : null}
          onRetry={() => { markQueryIntent('staff-roles'); void rolesQuery.refetch() }}
        />
      </div>}

      {activeTab === 'EMPLOYEES' && hasRosterWorkflow && <div id="staff-employees-panel" role="tabpanel" aria-labelledby="staff-employees-tab"><QueryActivity
        isFetching={staffQuery.isFetching}
        isInitialLoading={loading}
        error={error}
        onRetry={() => { markQueryIntent('staff'); void staffQuery.refetch() }}
        label="Xodimlar yangilanmoqda"
        metricId="staff"
      >
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
              disabled={!canUpdate && !canDelete}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition enabled:hover:border-zinc-400 enabled:hover:shadow-sm disabled:cursor-default"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-zinc-900">{member.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-zinc-500">{member.login}{member.phone ? ` · ${formatUzPhoneDisplay(member.phone)}` : ''}</div>
                </div>
                {member.isActive !== null && <span className={member.isActive ? 'bg-emerald-100 px-2 py-1 text-xs text-emerald-800' : 'bg-zinc-100 px-2 py-1 text-xs text-zinc-500'}>
                  {member.isActive ? 'Faol' : 'Bloklangan'}
                </span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                  {member.staffRole?.name ?? 'Individual'}
                  {member.staffRole?.isArchived ? ' · arxiv' : ''}
                </span>
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
      )}
      </QueryActivity></div>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Xodimni boshqarish' : "Yangi xodim qo'shish"}</DialogTitle></DialogHeader>
          <form onSubmit={(event) => void save(event)} className="space-y-4" autoComplete="off" noValidate>
          {formError && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field controlId="staff-name" label="Ism" required error={submitted && form.name.trim().length < 2 ? "Ism kamida 2 ta belgidan iborat bo'lishi kerak" : undefined}><Input disabled={Boolean(editing) && !canEditProfile} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field controlId="staff-phone" label="Telefon" required error={submitted && !isValidPhone(form.phone) ? "Telefon raqami noto'g'ri" : undefined}><PhoneInput disabled={Boolean(editing) && !canEditProfile} value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} /></Field>
            <Field controlId="staff-login" label="Login" required={!editing} help={editing && isOwner ? "Faqat do'kon egasi loginni o'zgartira oladi. Saqlangandan keyin xodim qayta kiradi." : undefined} error={submitted && ((!editing || (isOwner && form.login.trim() !== editing?.login)) && (form.login.trim().length < 3 || !loginPattern.test(form.login.trim()))) ? "Login 3-64 ta lotin harfi, raqam yoki _ belgisidan iborat bo'lishi kerak" : undefined}><Input autoComplete="off" disabled={Boolean(editing) && !isOwner} value={form.login} onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))} /></Field>
            <Field controlId="staff-password" label={editing ? 'Yangi parol (ixtiyoriy)' : 'Parol'} required={!editing} error={submitted && ((!editing && form.password.length < 10) || (Boolean(editing) && Boolean(form.password) && form.password.length < 10)) ? "Parol kamida 10 ta belgidan iborat bo'lishi kerak" : undefined}><Input autoComplete="new-password" disabled={Boolean(editing) && !canResetPassword} type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Kamida 10 ta belgi" /></Field>
            {!editing && isOwner && <Field
              controlId="staff-telegram-id"
              label="Telegram ID"
              help={!enabledFeatures.has('TELEGRAM')
                ? 'Do\'kon paketida Telegram yoqilmagan. ID biriktirib bo\'lmaydi.'
                : !form.telegramNotificationsEnabled
                  ? 'ID kiritishdan oldin xodim uchun Telegram xabarlarini yoqing.'
                  : 'Raqamli Telegram ID kiriting; xodim botga /start yuborib tasdiqlaydi.'}
            >
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={!enabledFeatures.has('TELEGRAM') || !form.telegramNotificationsEnabled}
                value={form.telegramId}
                onChange={(event) => setForm((current) => ({ ...current, telegramId: event.target.value.replace(/\D/g, '') }))}
              />
            </Field>}
          </div>

          {((!editing && isOwner) || (editing && canManagePermissions)) && <Field
            controlId="staff-access-mode"
            label="Lavozim va ruxsatlar"
            help="Lavozim ruxsatlarni birgalikda boshqaradi. Individual rejimda ruxsatlarni alohida tanlaysiz."
          >
            <select
              value={form.accessMode === 'ROLE' ? form.roleId ?? 'NONE' : form.accessMode}
              onChange={(event) => selectAccess(event.target.value)}
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
            >
              <option value="NONE">Ruxsatsiz</option>
              <optgroup label="Lavozimlar">
                {editing?.staffRole?.isArchived && !assignableRoles.some((role) => role.id === editing.staffRole?.id) && (
                  <option value={editing.staffRole.id} disabled>{editing.staffRole.name} · arxiv</option>
                )}
                {assignableRoles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}{role.kind === 'BUILT_IN' ? ' · standart' : ''}</option>
                ))}
              </optgroup>
              <option value="INDIVIDUAL">Individual ruxsatlar</option>
            </select>
          </Field>}

          {form.accessMode === 'ROLE' && form.roleId && (() => {
            const role = roles.find((item) => item.id === form.roleId) ?? editing?.staffRole
            return role ? <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <span className="font-semibold">{role.name}</span> · {form.permissionCodes.length + (form.logsViewEnabled ? 1 : 0)} ta ruxsat.
              Lavozim o&apos;zgarsa, unga biriktirilgan xodimlar xavfsiz tarzda qayta kiradi.
            </div> : null
          })()}

          {form.accessMode === 'INDIVIDUAL' && ((!editing && isOwner) || (editing && canManagePermissions)) && permissionGroups.map((section) => (
            <fieldset key={section.group} className="space-y-2 border-t border-zinc-200 pt-3">
              <legend className="text-sm font-semibold text-zinc-900">{section.label}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {section.permissions.map((permission) => {
                  const packageEnabled = permissionRequiredFeatures(permission.code).every((feature) => enabledFeatures.has(feature))
                  return (
                    <label key={permission.code} htmlFor={`staff-permission-${permission.code.toLowerCase()}`} className={`flex items-start gap-2 border border-zinc-200 p-2 text-sm ${packageEnabled ? 'cursor-pointer hover:bg-zinc-50' : 'cursor-not-allowed bg-zinc-50 opacity-60'}`}>
                      <input id={`staff-permission-${permission.code.toLowerCase()}`} type="checkbox" disabled={!packageEnabled} checked={permission.code === 'NASIYA_ARCHIVE' ? NASIYA_ARCHIVE_PERMISSION_BUNDLE.every((code) => form.permissionCodes.includes(code)) : form.permissionCodes.includes(permission.code)} onChange={() => togglePermission(permission.code)} className="mt-0.5" />
                      <span className="min-w-0"><span className="block font-medium text-zinc-800">{permission.label}</span><span className="block text-xs text-zinc-500">{permission.description} · {riskLabels[permission.risk]}{packageEnabled ? '' : ' · Paketda yoqilmagan'}</span></span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))}

          {form.accessMode === 'INDIVIDUAL' && isOwner && ((!editing) || canManagePermissions) && <label htmlFor="staff-logs-enabled" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Loglarni ko&apos;rish</span><span className="text-xs text-zinc-500">Egasi xodim uchun alohida boshqaradi. Moliyaviy hisobotlar berilmaydi.</span></span>
            <input id="staff-logs-enabled" type="checkbox" checked={form.logsViewEnabled} onChange={(event) => {
              if (event.target.checked && !window.confirm("Faoliyat loglari maxfiy ma'lumot bo'lishi mumkin. Ruxsatni yoqishni tasdiqlaysizmi?")) return
              setForm((current) => ({ ...current, accessMode: 'INDIVIDUAL', roleId: null, logsViewEnabled: event.target.checked }))
            }} />
          </label>}

          {((!editing && isOwner) || (editing && canManageNotifications)) && <label htmlFor="staff-telegram-enabled" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Telegram xabarlari</span><span className="text-xs text-zinc-500">{enabledFeatures.has('TELEGRAM') ? 'Egasi xodim uchun alohida boshqaradi' : 'Paketda yoqilmagan'}</span></span>
            <input id="staff-telegram-enabled" type="checkbox" disabled={!enabledFeatures.has('TELEGRAM')} checked={form.telegramNotificationsEnabled} onChange={(event) => setForm((current) => ({
              ...current,
              telegramNotificationsEnabled: event.target.checked,
              ...(!event.target.checked ? { telegramId: '' } : {}),
            }))} />
          </label>}
          {(!editing || canManageStatus) && <label htmlFor="staff-account-active" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Hisob holati</span><span className="text-xs text-zinc-500">Faol xodim kira oladi; bloklangan xodimning sessiyalari bekor qilinadi.</span></span>
            <input id="staff-account-active" type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
          </label>}
          {editing && (
            <>
              <Field controlId="staff-change-note" label="Sabab" required help="Xodim ruxsati yoki profili o'zgarishi uchun audit sababi." error={submitted && form.note.trim().length < 5 ? "Sabab kamida 5 ta belgidan iborat bo'lishi kerak" : undefined}><Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Kamida 5 ta belgi" /></Field>
            </>
          )}
          <DialogFooter>
            {editing && canDelete && <AsyncButton type="button" variant="destructive" pending={saving} pendingLabel="O'chirilmoqda..." onClick={deleteStaff}><Trash2 className="size-4" /> O&apos;chirish</AsyncButton>}
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>Bekor qilish</Button>
            {(!editing || canUpdate) && <AsyncButton type="submit" pending={saving} pendingLabel="Saqlanmoqda..." className="bg-zinc-900 text-white hover:bg-zinc-800">
              Saqlash
            </AsyncButton>}
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
