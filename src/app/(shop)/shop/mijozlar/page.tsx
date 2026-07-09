'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
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
  additionalPhones?: string[]
  note: string | null
  createdAt: string
  trustOverride?: TrustTier | null
  trust?: CustomerTrust
  _count?: { sales: number; nasiya: number }
}

// Item 2 — real page/skip/take pagination (matches /api/logs' established envelope).
const PER_PAGE = 25

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [additionalPhones, setAdditionalPhones] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [trustOverride, setTrustOverride] = useState<TrustTier | ''>('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  function loadCustomers(query: string, pageNum: number) {
    const params = new URLSearchParams({
      search: query,
      skip: String((pageNum - 1) * PER_PAGE),
      take: String(PER_PAGE),
    })
    fetch(`/api/customers?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setCustomers(json.data.items)
          setTotal(json.data.total)
        } else {
          setError(json.error || 'Mijozlar yuklanmadi')
        }
      })
      .catch(() => setError('Mijozlar yuklanmadi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadCustomers(search, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  function submitSearch() {
    setPage(1)
    loadCustomers(search, 1)
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  function openEdit(customer: Customer) {
    setEditing(customer)
    setName(customer.name)
    setPhone(customer.phone)
    setAdditionalPhones(customer.additionalPhones ?? [])
    setNote(customer.note ?? '')
    setReason('')
    setTrustOverride(customer.trustOverride ?? '')
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

  async function saveCustomer() {
    if (!editing || saving) return
    setSaving(true)
    setSaveError('')
    try {
      const identityChanged = name !== editing.name || phone !== editing.phone
      const res = await fetch(`/api/customers/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          additionalPhones,
          note,
          reason: identityChanged ? reason : undefined,
          trustOverride: trustOverride || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Saqlashda xatolik')
      setEditing(null)
      setReason('')
      loadCustomers(search, page)
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
        <button
          type="button"
          onClick={() => window.location.assign('/api/export/customers')}
          className="inline-flex h-9 items-center justify-center rounded bg-zinc-900 px-4 text-sm text-white hover:bg-zinc-800"
        >
          CSV eksport
        </button>
      </div>

      <div className="flex max-w-md gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
          placeholder="Ism yoki telefon bo'yicha qidirish..."
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
                  <td className="px-4 py-3 font-medium text-zinc-900">{customer.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-600">{customer.phone}</td>
                  <td className="px-4 py-3">{customer.trust && <TrustBadge trust={customer.trust} />}</td>
                  <td className="px-4 py-3 text-zinc-600">{customer._count?.sales ?? 0}</td>
                  <td className="px-4 py-3 text-zinc-600">{customer._count?.nasiya ?? 0}</td>
                  <td className="px-4 py-3 text-zinc-500">{uzDate(customer.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" onClick={() => openEdit(customer)} className="h-8 rounded border-zinc-200 px-3 text-xs">
                      Tahrirlash
                    </Button>
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
                  <div className="font-medium text-zinc-900">{customer.name}</div>
                  <div className="text-xs font-mono text-zinc-500 mt-0.5">{customer.phone}</div>
                </div>
                {customer.trust && <TrustBadge trust={customer.trust} />}
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>{customer._count?.sales ?? 0} ta sotuv</span>
                <span>{customer._count?.nasiya ?? 0} ta nasiya</span>
                <span>{uzDate(customer.createdAt)}</span>
              </div>
              <Button
                variant="outline"
                onClick={() => openEdit(customer)}
                className="h-8 w-full rounded border-zinc-200 text-xs"
              >
                Tahrirlash
              </Button>
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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Oldingi
            </Button>
            <span className="text-xs">{page} / {totalPages}</span>
            <Button
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Keyingi
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle>Mijozni tahrirlash</DialogTitle>
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
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Qo&apos;shimcha raqamlar</label>
              <div className="space-y-2">
                {additionalPhones.map((extra, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <PhoneInput
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
            </div>
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-zinc-700">Ishonch darajasi</label>
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
                <TrustSelectTrigger className="h-9 text-sm border-zinc-200 rounded">
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
            <Button variant="outline" onClick={() => setEditing(null)} className="border-zinc-200 rounded">Bekor qilish</Button>
            <Button
              disabled={
                saving ||
                name.trim().length < 2 ||
                phone.trim().length < 9 ||
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
