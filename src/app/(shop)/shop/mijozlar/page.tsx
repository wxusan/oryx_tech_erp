'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { uzDate } from '@/lib/dates'

interface Customer {
  id: string
  name: string
  phone: string
  note: string | null
  createdAt: string
  _count?: { sales: number; nasiya: number }
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  function loadCustomers(query = search) {
    setLoading(true)
    fetch(`/api/customers?search=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setCustomers(json.data)
        else setError(json.error || 'Mijozlar yuklanmadi')
      })
      .catch(() => setError('Mijozlar yuklanmadi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let ignore = false
    fetch('/api/customers?search=')
      .then((res) => res.json())
      .then((json) => {
        if (ignore) return
        if (json.success) setCustomers(json.data)
        else setError(json.error || 'Mijozlar yuklanmadi')
      })
      .catch(() => {
        if (!ignore) setError('Mijozlar yuklanmadi')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [])

  function openEdit(customer: Customer) {
    setEditing(customer)
    setName(customer.name)
    setPhone(customer.phone)
    setNote(customer.note ?? '')
    setReason('')
    setSaveError('')
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
          note,
          reason: identityChanged ? reason : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Saqlashda xatolik')
      setEditing(null)
      setReason('')
      loadCustomers()
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
          placeholder="Ism yoki telefon bo'yicha qidirish..."
          className="h-9 text-sm border-zinc-200 rounded"
        />
        <Button onClick={() => loadCustomers()} className="h-9 rounded bg-zinc-900 px-4 text-sm text-white">
          Qidirish
        </Button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}

      <div className="border border-zinc-200 rounded overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              {['Ism', 'Telefon', 'Sotuvlar', 'Nasiyalar', 'Sana', ''].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Yuklanmoqda...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Mijoz topilmadi</td></tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{customer.name}</td>
                  <td className="px-4 py-3 font-mono text-zinc-600">{customer.phone}</td>
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
              <Input id="customer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 text-sm border-zinc-200 rounded" />
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
