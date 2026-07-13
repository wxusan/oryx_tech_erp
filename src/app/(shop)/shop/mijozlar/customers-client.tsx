'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { formatUzPhoneDisplay, isValidPhone } from '@/lib/phone'
import { commitNavigationMutation } from '@/lib/client-events'
import { replaceListUrlState } from '@/lib/list-url-state'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { uzDate } from '@/lib/dates'
import { X } from 'lucide-react'
import { TrustBadge, type TrustTier, type TrustBadgeData } from '@/components/shop/trust-badge'
import {
  Select as TrustSelect,
  SelectContent as TrustSelectContent,
  SelectItem as TrustSelectItem,
  SelectTrigger as TrustSelectTrigger,
  SelectValue as TrustSelectValue,
} from '@/components/ui/select'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { customerSearchRequest } from '@/lib/customer-search-transport'

const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  NEW: 'Yangi mijoz',
  LOW: 'Past ishonch',
  MEDIUM: "O'rtacha ishonch",
  HIGH: 'Ishonchli',
  VERY_HIGH: 'Juda ishonchli',
}

interface CustomerTrust extends TrustBadgeData {
  reasons?: string[]
}

interface Customer {
  id: string
  name: string
  phone: string
  phoneNormalizationNeedsReview?: boolean
  additionalPhones?: string[]
  note: string | null
  createdAt: string
  trustOverride?: TrustTier | null
  trust?: CustomerTrust
  passportMasked?: string | null
  hasPassportPhoto?: boolean
  _count?: { sales: number; nasiya: number }
}

// Item 2 — real page/skip/take pagination (matches /api/logs' established envelope).
const PER_PAGE = 25

export default function CustomersClient({ initialPage }: { initialPage: number }) {
  const scope = useAuthenticatedQueryScope()
  const { can } = useShopAccess()
  const canManageCustomers = can('CUSTOMER_MANAGE')
  const canExport = can('EXPORT_DATA')
  const [page, setPage] = useState(initialPage)
  const [search, setSearch] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [additionalPhones, setAdditionalPhones] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [trustOverride, setTrustOverride] = useState<TrustTier | ''>('')
  const [passportIdentifier, setPassportIdentifier] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const passportSelection = useImageSelection({
    mode: 'single',
    uploadEndpoint: '/api/uploads/passport',
  })
  const customersQuery = useQuery({
    queryKey: queryKeys.list(scope, 'customers', {
      surface: 'list',
      requestRevision: searchRevision,
      page,
      take: PER_PAGE,
      sort: 'createdAt-desc',
    }),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        '/api/customers/search',
        customerSearchRequest({
          search: committedSearch,
          skip: (page - 1) * PER_PAGE,
          take: PER_PAGE,
        }, signal),
      )
      const json = await response.json() as { success: boolean; data?: { items: Customer[]; total: number }; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Mijozlar yuklanmadi')
      return json.data
    },
    placeholderData: keepPreviousData,
  })

  function loadPage(pageNum: number) {
    replaceListUrlState({ q: null, page: pageNum })
    setPage(pageNum)
  }

  useEffect(() => {
    // Remove legacy q values without ever writing the active search to the
    // address bar or browser history.
    replaceListUrlState({ q: null, page })
  }, [page])

  function submitSearch() {
    setCommittedSearch(search.trim())
    setSearchRevision((revision) => revision + 1)
    loadPage(1)
  }

  const customers = customersQuery.data?.items ?? []
  const total = customersQuery.data?.total ?? 0
  const loading = customersQuery.isPending && !customersQuery.data
  const error = customersQuery.error instanceof Error ? customersQuery.error.message : ''
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  function openEdit(customer: Customer) {
    setCreating(false)
    setEditing(customer)
    setName(customer.name)
    setPhone(customer.phone)
    setAdditionalPhones(customer.additionalPhones ?? [])
    setNote(customer.note ?? '')
    setReason('')
    setTrustOverride(customer.trustOverride ?? '')
    setPassportIdentifier('')
    passportSelection.clear()
    setSaveError('')
    // The list badge omits `reasons` to keep the list payload small — fetch
    // the full explanation once the dialog for this customer is open.
    fetch(`/api/customers/${customer.id}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data?.trust) {
          setEditing((prev) => (prev && prev.id === customer.id ? { ...prev, trust: json.data.trust } : prev))
        }
      })
      .catch(() => {})
  }

  function openCreate() {
    setEditing(null)
    setCreating(true)
    setName('')
    setPhone('')
    setAdditionalPhones([])
    setNote('')
    setReason('')
    setTrustOverride('')
    setPassportIdentifier('')
    passportSelection.clear()
    setSaveError('')
  }

  async function saveCustomer() {
    if ((!editing && !creating) || saving) return
    setSaving(true)
    setSaveError('')
    try {
      const [passportPhotoUrl] = await passportSelection.uploadAll()
      const identityChanged = Boolean(editing && (name !== editing.name || phone !== editing.phone))
      const res = await fetch(editing ? `/api/customers/${editing.id}` : '/api/customers', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          additionalPhones,
          note,
          reason: identityChanged ? reason : undefined,
          trustOverride: trustOverride || null,
          passportIdentifier: passportIdentifier.trim() || undefined,
          passportPhotoUrl,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Saqlashda xatolik')
      await commitNavigationMutation({ kind: 'customer.updated' })
      setEditing(null)
      setCreating(false)
      setReason('')
      passportSelection.clear()
      void customersQuery.refetch()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Saqlashda xatolik')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Mijozlar</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Savdo va nasiya mijozlari tarixi</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageCustomers && <Button type="button" onClick={openCreate}>Yangi mijoz</Button>}
          {canExport && (
            <button
              type="button"
              onClick={() => window.location.assign('/api/export/customers')}
              className="inline-flex h-9 items-center justify-center rounded bg-zinc-900 px-4 text-sm text-white hover:bg-zinc-800"
            >
              CSV eksport
            </button>
          )}
        </div>
      </div>

      <div className="flex max-w-md gap-2">
        <Input
          name="customer-search"
          aria-label="Mijoz qidiruvi"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Ism, telefon yoki pasport bo'yicha qidirish..."
          className="h-9 text-sm border-zinc-200 rounded"
        />
        <Button onClick={submitSearch} className="h-9 rounded bg-zinc-900 px-4 text-sm text-white">
          Qidirish
        </Button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}

      {/* Desktop table */}
      <div className="hidden sm:block border border-zinc-200 rounded overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              {['Ism', 'Telefon', 'Ishonch', 'Sotuvlar', 'Nasiyalar', 'Sana', ''].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Yuklanmoqda...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Mijoz topilmadi</td></tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    <Link href={`/shop/mijozlar/${customer.id}`} className="hover:underline">{customer.name}</Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-600">
                    <div>{formatUzPhoneDisplay(customer.phone)}</div>
                    {customer.phoneNormalizationNeedsReview && (
                      <span className="mt-1 inline-flex rounded bg-amber-50 px-2 py-0.5 font-sans text-[11px] font-medium text-amber-800" title="Eski telefon raqamini tekshirib, to'g'ri formatda saqlang">
                        Telefon tekshirilsin
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{customer.trust && <TrustBadge trust={customer.trust} />}</td>
                  <td className="px-4 py-3 text-zinc-600">{customer._count?.sales ?? 0}</td>
                  <td className="px-4 py-3 text-zinc-600">{customer._count?.nasiya ?? 0}</td>
                  <td className="px-4 py-3 text-zinc-500">{uzDate(customer.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {canManageCustomers && (
                      <Button variant="outline" onClick={() => openEdit(customer)} className="h-8 rounded border-zinc-200 px-3 text-xs">
                        Tahrirlash
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Item 1 — mobile card view: same data as the table, actions directly visible (not hidden in an overflow menu). */}
      <div className="sm:hidden space-y-3">
        {loading ? (
          <div className="border border-zinc-200 rounded px-4 py-8 text-center text-sm text-zinc-500">Yuklanmoqda...</div>
        ) : customers.length === 0 ? (
          <div className="border border-zinc-200 rounded px-4 py-8 text-center text-sm text-zinc-500">Mijoz topilmadi</div>
        ) : (
          customers.map((customer) => (
            <div key={customer.id} className="border border-zinc-200 rounded p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/shop/mijozlar/${customer.id}`} className="font-medium text-zinc-900 hover:underline">{customer.name}</Link>
                  <div className="text-xs font-mono text-zinc-500 mt-0.5">{formatUzPhoneDisplay(customer.phone)}</div>
                  {customer.phoneNormalizationNeedsReview && (
                    <span className="mt-1 inline-flex rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      Telefon tekshirilsin
                    </span>
                  )}
                </div>
                {customer.trust && <TrustBadge trust={customer.trust} />}
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>{customer._count?.sales ?? 0} ta sotuv</span>
                <span>{customer._count?.nasiya ?? 0} ta nasiya</span>
                <span>{uzDate(customer.createdAt)}</span>
              </div>
              {canManageCustomers && (
                <Button
                  variant="outline"
                  onClick={() => openEdit(customer)}
                  className="h-8 w-full rounded border-zinc-200 text-xs"
                >
                  Tahrirlash
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            {total} ta mijozdan {Math.min((page - 1) * PER_PAGE + 1, total)}-{Math.min(page * PER_PAGE, total)} ko&apos;rsatilmoqda
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => loadPage(Math.max(1, page - 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Oldingi
            </Button>
            <span className="text-xs">{page} / {totalPages}</span>
            <Button
              variant="outline"
              disabled={page === totalPages}
              onClick={() => loadPage(Math.min(totalPages, page + 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Keyingi
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!editing || creating} onOpenChange={(open) => {
        if (!open) {
          setEditing(null)
          setCreating(false)
        }
      }}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle>{creating ? 'Yangi mijoz' : 'Mijozni tahrirlash'}</DialogTitle>
          </DialogHeader>
          {saveError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</div>}
          <div className="space-y-3">
            <div>
              <label htmlFor="customer-name" className="block text-xs font-medium text-zinc-700 mb-1.5">Ism</label>
              <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm border-zinc-200 rounded" />
            </div>
            <div>
              <label htmlFor="customer-phone" className="block text-xs font-medium text-zinc-700 mb-1.5">Telefon</label>
              <PhoneInput id="customer-phone" value={phone} onChange={setPhone} className="h-9 text-sm border-zinc-200 rounded" />
            </div>
            <fieldset>
              <legend className="block text-xs font-medium text-zinc-700 mb-1.5">Qo&apos;shimcha raqamlar</legend>
              <div className="space-y-2">
                {additionalPhones.map((extra, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <PhoneInput
                      aria-label={`Qo'shimcha telefon ${i + 1}`}
                      value={extra}
                      onChange={(value) => {
                        setAdditionalPhones((prev) => prev.map((p, idx) => (idx === i ? value : p)))
                      }}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                    <button
                      type="button"
                      aria-label="Raqamni o'chirish"
                      onClick={() => setAdditionalPhones((prev) => prev.filter((_, idx) => idx !== i))}
                      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-red-600"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAdditionalPhones((prev) => [...prev, ''])}
                  className="h-8 rounded border-zinc-200 px-3 text-xs"
                >
                  + Raqam qo&apos;shish
                </Button>
              </div>
            </fieldset>
            {editing && (name !== editing.name || phone !== editing.phone) && (
              <div>
                <label htmlFor="customer-reason" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  O'zgartirish sababi <span className="text-red-500">*</span>
                </label>
                <Textarea
                  id="customer-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Masalan: mijoz telefon raqamini yangiladi"
                  className="text-sm border-zinc-200 rounded min-h-[70px]"
                />
              </div>
            )}
            <div>
              <label htmlFor="customer-note" className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
              <Textarea id="customer-note" value={note} onChange={(e) => setNote(e.target.value)} className="text-sm border-zinc-200 rounded min-h-[80px]" />
            </div>
            <div>
              <label htmlFor="customer-passport-identifier" className="block text-xs font-medium text-zinc-700 mb-1.5">Pasport seriya/raqami</label>
              <Input
                id="customer-passport-identifier"
                value={passportIdentifier}
                onChange={(event) => setPassportIdentifier(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={editing?.passportMasked ? `${editing.passportMasked} — o'zgartirish uchun yangisini kiriting` : 'AA 1234567'}
                className="h-9 font-mono text-sm border-zinc-200 rounded"
              />
              <p className="mt-1 text-xs text-zinc-500">To‘liq raqam ro‘yxat yoki profil javobida qaytarilmaydi.</p>
            </div>
            <ImageSelectionField
              inputId="customer-passport-image"
              label={editing?.hasPassportPhoto ? "Pasport rasmini almashtirish (ixtiyoriy)" : "Pasport rasmi (ixtiyoriy)"}
              mode="single"
              selection={passportSelection}
              disabled={saving}
              help={editing?.hasPassportPhoto
                ? "Yangi rasm tanlanmasa, mavjud private rasm saqlanib qoladi. JPG, PNG yoki WEBP, 5 MB gacha."
                : "Private saqlanadi; Telegram qurilma rasmlariga qo‘shilmaydi. JPG, PNG yoki WEBP, 5 MB gacha."}
            />
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="customer-trust" className="block text-xs font-medium text-zinc-700">Ishonch darajasi</label>
                {editing?.trust && <TrustBadge trust={editing.trust} />}
              </div>
              {editing?.trust?.reasons && editing.trust.reasons.length > 0 && (
                <ul className="mb-2 space-y-0.5 text-xs text-zinc-500">
                  {editing.trust.reasons.map((r, i) => (
                    <li key={i}>· {r}</li>
                  ))}
                </ul>
              )}
              <TrustSelect value={trustOverride || 'AUTO'} onValueChange={(v) => setTrustOverride(v === 'AUTO' ? '' : (v as TrustTier))}>
                <TrustSelectTrigger id="customer-trust" className="h-9 text-sm border-zinc-200 rounded">
                  <TrustSelectValue />
                </TrustSelectTrigger>
                <TrustSelectContent>
                  <TrustSelectItem value="AUTO">Avtomatik hisoblash</TrustSelectItem>
                  {(Object.keys(TRUST_TIER_LABELS) as TrustTier[]).map((tier) => (
                    <TrustSelectItem key={tier} value={tier}>
                      {TRUST_TIER_LABELS[tier]} (qo&apos;lda)
                    </TrustSelectItem>
                  ))}
                </TrustSelectContent>
              </TrustSelect>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEditing(null); setCreating(false) }} className="border-zinc-200 rounded">Bekor qilish</Button>
            <Button
              disabled={
                saving ||
                passportSelection.hasBlockingErrors ||
                name.trim().length < 2 ||
                !isValidPhone(phone) ||
                (!!editing && (name !== editing.name || phone !== editing.phone) && reason.trim().length < 5)
              }
              onClick={saveCustomer}
              className="bg-zinc-900 text-white rounded"
            >
              {saving ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
