'use client'

import { useMemo, useState } from 'react'
import { Copy, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  SHOP_PERMISSION_CATALOG,
  permissionRequiredFeatures,
  type ShopPermissionGroup,
  type ShopPermissionCode,
} from '@/lib/access-control'
import type { ShopStaffRoleDto } from '@/lib/shop-staff-role-contract'
import {
  NASIYA_ARCHIVE_PERMISSION_BUNDLE,
  STAFF_LOGS_PERMISSION,
  withNasiyaArchivePermissionBundle,
  type ShopStaffDto,
} from '@/lib/shop-staff-contract'
import { Button } from '@/components/ui/button'
import { AsyncButton } from '@/components/ui/async-button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { QueryActivity } from '@/components/query-activity'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import { commitNavigationMutation } from '@/lib/client-events'

const rolePermissions = SHOP_PERMISSION_CATALOG.filter((permission) => (
  !permission.ownerOnly && !permission.retired &&
  permission.code !== STAFF_LOGS_PERMISSION && permission.code !== 'NASIYA_REOPEN'
))

const rolePermissionGroupLabels: Record<ShopPermissionGroup, string> = {
  INVENTORY: 'Qurilmalar va ombor',
  SALES: 'Sotuv va qaytarish',
  NASIYA: 'Nasiya',
  OLIB: 'Olib-sotdim',
  CUSTOMERS: 'Mijozlar va pasport',
  INSIGHTS: 'Boshqaruv va hisobot',
  DATA: 'Import va eksport',
  STAFF: 'Xodimlarni boshqarish',
  SETTINGS: "Do'kon sozlamalari",
}

const rolePermissionGroups = Object.entries(rolePermissionGroupLabels).map(([group, label]) => ({
  group: group as ShopPermissionGroup,
  label,
  permissions: rolePermissions.filter((permission) => permission.group === group),
})).filter((section) => section.permissions.length > 0)

interface RoleForm {
  name: string
  description: string
  permissionCodes: ShopPermissionCode[]
  logsViewEnabled: boolean
  note: string
}

const emptyRoleForm: RoleForm = {
  name: '',
  description: '',
  permissionCodes: [],
  logsViewEnabled: false,
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

export function StaffRoleManagement({
  roles,
  staff,
  isOwner,
  isFetching,
  error,
  onRetry,
}: {
  roles: ShopStaffRoleDto[]
  staff: ShopStaffDto[]
  isOwner: boolean
  isFetching: boolean
  error: string | null
  onRetry: () => void
}) {
  const { enabledFeatures } = useShopAccess()
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ShopStaffRoleDto | null>(null)
  const [form, setForm] = useState<RoleForm>(emptyRoleForm)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')

  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const member of staff) {
      if (!member.staffRole) continue
      counts.set(member.staffRole.id, (counts.get(member.staffRole.id) ?? 0) + 1)
    }
    return counts
  }, [staff])

  function openCreate(source?: ShopStaffRoleDto) {
    setEditing(null)
    setForm(source ? {
      name: `${source.name} nusxasi`.slice(0, 40),
      description: source.description ?? '',
      permissionCodes: withNasiyaArchivePermissionBundle(source.permissionCodes),
      logsViewEnabled: source.logsViewEnabled,
      note: '',
    } : emptyRoleForm)
    setSubmitted(false)
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(role: ShopStaffRoleDto) {
    setEditing(role)
    setForm({
      name: role.name,
      description: role.description ?? '',
      permissionCodes: withNasiyaArchivePermissionBundle(role.permissionCodes),
      logsViewEnabled: role.logsViewEnabled,
      note: '',
    })
    setSubmitted(false)
    setFormError('')
    setDialogOpen(true)
  }

  function togglePermission(code: ShopPermissionCode) {
    const definition = SHOP_PERMISSION_CATALOG.find((permission) => permission.code === code)
    const archiveBundle = code === 'NASIYA_ARCHIVE'
    const enabled = archiveBundle
      ? NASIYA_ARCHIVE_PERMISSION_BUNDLE.every((item) => form.permissionCodes.includes(item))
      : form.permissionCodes.includes(code)
    if (
      !enabled && definition && definition.risk !== 'ROUTINE' &&
      !window.confirm(`${definition.label} — ${definition.risk === 'FINANCIAL' ? 'moliyaviy' : 'muhim'} ruxsat. Davom etasizmi?`)
    ) return
    setForm((current) => ({
      ...current,
      permissionCodes: archiveBundle
        ? enabled
          ? current.permissionCodes.filter((item) => !NASIYA_ARCHIVE_PERMISSION_BUNDLE.includes(item as typeof NASIYA_ARCHIVE_PERMISSION_BUNDLE[number]))
          : withNasiyaArchivePermissionBundle([...current.permissionCodes, 'NASIYA_ARCHIVE'])
        : enabled
          ? current.permissionCodes.filter((item) => item !== code)
          : [...current.permissionCodes, code],
    }))
  }

  async function saveRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (form.name.trim().length < 2 || form.name.trim().length > 40 || (editing && form.note.trim().length < 5)) {
      setFormError('Majburiy maydonlarni tekshiring')
      return
    }
    const memberCount = editing ? memberCounts.get(editing.id) ?? 0 : 0
    const permissionsChanged = editing !== null && (
      [...form.permissionCodes].sort().join('\u0000') !== [...editing.permissionCodes].sort().join('\u0000') ||
      form.logsViewEnabled !== editing.logsViewEnabled
    )
    if (
      editing && permissionsChanged && memberCount > 0 &&
      !window.confirm(`${memberCount} ta xodimning ruxsatlari yangilanadi va ular qayta kiradi. Davom etasizmi?`)
    ) return

    setSaving(true)
    setFormError('')
    try {
      const response = await fetch(editing ? `/api/shop/staff/roles/${editing.id}` : '/api/shop/staff/roles', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { version: editing.version, note: form.note.trim() } : {}),
          name: form.name.trim(),
          description: form.description.trim(),
          permissionCodes: form.permissionCodes,
          logsViewEnabled: form.logsViewEnabled,
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

  async function archiveRole() {
    if (!editing || editing.kind === 'BUILT_IN' || form.note.trim().length < 5) {
      setSubmitted(true)
      setFormError('Arxivlash uchun kamida 5 belgili sabab kiriting')
      return
    }
    const memberCount = memberCounts.get(editing.id) ?? 0
    if (!window.confirm(
      memberCount > 0
        ? `Lavozim arxivlanadi. ${memberCount} ta xodimning joriy ruxsatlari saqlanadi, lekin yangi xodimga bu lavozim berilmaydi.`
        : 'Lavozim arxivlanadi. Davom etasizmi?',
    )) return
    setSaving(true)
    setFormError('')
    try {
      const response = await fetch(`/api/shop/staff/roles/${editing.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: editing.version, note: form.note.trim() }),
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

  return <>
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold text-zinc-900">Qayta ishlatiladigan lavozimlar</h2>
        <p className="text-sm text-zinc-500">“Shogirt” kabi lavozim yarating va bir xil ruxsatlarni bir nechta xodimga bering.</p>
      </div>
      {isOwner && <Button onClick={() => openCreate()} className="bg-zinc-900 text-white hover:bg-zinc-800">
        <Plus className="size-4" /> Lavozim yaratish
      </Button>}
    </div>

    <QueryActivity
      isFetching={isFetching}
      isInitialLoading={false}
      error={error}
      onRetry={onRetry}
      label="Lavozimlar yangilanmoqda"
      metricId="staff-roles"
    >
      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((role) => {
          const memberCount = memberCounts.get(role.id) ?? 0
          return <article key={role.id} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-zinc-900">{role.name}</h3>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                    {role.kind === 'BUILT_IN' ? 'Standart' : 'Maxsus'}
                  </span>
                </div>
                {role.description && <p className="mt-1 text-sm text-zinc-500">{role.description}</p>}
              </div>
              <ShieldCheck className="size-5 shrink-0 text-blue-600" />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              {role.permissionCodes.length + (role.logsViewEnabled ? 1 : 0)} ta ruxsat · {memberCount} ta xodim
            </p>
            {isOwner && <div className="mt-3 flex flex-wrap gap-2">
              {role.kind === 'CUSTOM' && <Button type="button" size="sm" variant="outline" onClick={() => openEdit(role)}>
                <Pencil className="size-3.5" /> Tahrirlash
              </Button>}
              <Button type="button" size="sm" variant="outline" onClick={() => openCreate(role)}>
                <Copy className="size-3.5" /> Nusxa olish
              </Button>
            </div>}
          </article>
        })}
      </div>
    </QueryActivity>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? 'Lavozimni tahrirlash' : 'Yangi lavozim'}</DialogTitle></DialogHeader>
        <form onSubmit={(event) => void saveRole(event)} className="space-y-4" noValidate>
          {formError && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
          <Field controlId="staff-role-name" label="Lavozim nomi" required error={submitted && (form.name.trim().length < 2 || form.name.trim().length > 40) ? 'Nom 2–40 ta belgidan iborat bo‘lishi kerak' : undefined}>
            <Input value={form.name} maxLength={40} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Masalan: Shogirt" />
          </Field>
          <Field controlId="staff-role-description" label="Izoh" help="Ixtiyoriy, 200 belgigacha">
            <Input value={form.description} maxLength={200} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </Field>

          <fieldset className="space-y-2 border-t border-zinc-200 pt-3">
            <legend className="text-sm font-semibold text-zinc-900">Lavozim ruxsatlari</legend>
            {rolePermissionGroups.map((section) => {
              const selectedCount = section.permissions.filter((permission) => form.permissionCodes.includes(permission.code)).length
              return <details key={section.group} className="rounded-lg border border-zinc-200">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-800">
                  {section.label}{selectedCount > 0 ? ` · ${selectedCount} ta tanlangan` : ''}
                </summary>
                <div className="grid gap-2 border-t border-zinc-100 p-2 sm:grid-cols-2">
                  {section.permissions.map((permission) => {
                    const packageEnabled = permissionRequiredFeatures(permission.code).every((feature) => enabledFeatures.has(feature))
                    const checked = permission.code === 'NASIYA_ARCHIVE'
                      ? NASIYA_ARCHIVE_PERMISSION_BUNDLE.every((code) => form.permissionCodes.includes(code))
                      : form.permissionCodes.includes(permission.code)
                    return <label key={permission.code} htmlFor={`role-permission-${permission.code.toLowerCase()}`} className={`flex items-start gap-2 rounded border p-2 text-sm ${packageEnabled ? 'cursor-pointer border-zinc-200' : 'cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-60'}`}>
                      <input
                        id={`role-permission-${permission.code.toLowerCase()}`}
                        type="checkbox"
                        checked={checked}
                        disabled={!packageEnabled}
                        onChange={() => togglePermission(permission.code)}
                        className="mt-0.5"
                      />
                      <span><span className="block font-medium text-zinc-800">{permission.label}</span><span className="text-xs text-zinc-500">{permission.description}{packageEnabled ? '' : ' · Paketda yoqilmagan'}</span></span>
                    </label>
                  })}
                </div>
              </details>
            })}
          </fieldset>

          <label htmlFor="staff-role-logs" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
            <span><span className="block font-medium">Faoliyat loglarini ko&apos;rish</span><span className="text-xs text-zinc-500">Maxfiy tarixga kirish; faqat egasi boshqaradi.</span></span>
            <input id="staff-role-logs" type="checkbox" checked={form.logsViewEnabled} onChange={(event) => {
              if (event.target.checked && !window.confirm('Faoliyat loglari maxfiy bo‘lishi mumkin. Davom etasizmi?')) return
              setForm((current) => ({ ...current, logsViewEnabled: event.target.checked }))
            }} />
          </label>

          {editing && <Field controlId="staff-role-note" label="O‘zgartirish sababi" required error={submitted && form.note.trim().length < 5 ? 'Sabab kamida 5 ta belgidan iborat bo‘lishi kerak' : undefined}>
            <Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Kamida 5 ta belgi" />
          </Field>}

          <DialogFooter>
            {editing && <AsyncButton type="button" variant="destructive" pending={saving} pendingLabel="Arxivlanmoqda..." onClick={archiveRole}>
              <Trash2 className="size-4" /> Arxivlash
            </AsyncButton>}
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>Bekor qilish</Button>
            <AsyncButton type="submit" pending={saving} pendingLabel="Saqlanmoqda..." className="bg-zinc-900 text-white hover:bg-zinc-800">Saqlash</AsyncButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
