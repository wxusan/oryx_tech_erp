'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Search, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useShopAccess } from '@/components/shop/shop-access-context'

interface DeviceActionItem {
  id: string
  model: string
  color: string | null
  storage: string | null
  imei: string
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA' | 'RETURNED'
}

const statusLabels: Record<DeviceActionItem['status'], string> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Sotilgan',
  SOLD_DEBT: 'Qarzga sotilgan',
  SOLD_NASIYA: 'Nasiyada',
  RETURNED: 'Qaytarilgan',
}

export default function DeviceActionQueue() {
  const { can } = useShopAccess()
  const [search, setSearch] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const query = useQuery({
    queryKey: ['device-action-queue', committedSearch],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ view: 'action-picker', purpose: 'device', take: '50' })
      if (committedSearch) params.set('search', committedSearch)
      const response = await fetch(`/api/devices?${params}`, { signal, cache: 'no-store' })
      const json = await response.json() as { success?: boolean; data?: { items: DeviceActionItem[] }; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Qurilmalar yuklanmadi')
      return json.data.items
    },
  })
  const actions = [
    ...(can('DEVICE_EDIT') ? [{ icon: Pencil, label: 'Tahrirlash' }] : []),
    ...(can('DEVICE_DELETE') ? [{ icon: Trash2, label: "O'chirish" }] : []),
    ...(can('DEVICE_RESTOCK') ? [{ icon: Undo2, label: 'Omborga qaytarish' }] : []),
    ...(can('SALE_RETURN_REFUND') ? [{ icon: Undo2, label: 'Sotuvni qaytarish' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Qurilma amallari</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
          {actions.map(({ icon: Icon, label }) => <span key={label} className="inline-flex items-center gap-1"><Icon size={13} aria-hidden="true" />{label}</span>)}
        </div>
      </div>
      <form className="flex max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); setCommittedSearch(search.trim()) }}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model yoki IMEI" />
        <Button type="submit" variant="outline" aria-label="Qidirish"><Search size={16} aria-hidden="true" /></Button>
      </form>
      {query.isError && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{query.error instanceof Error ? query.error.message : 'Xatolik'}</div>}
      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
        {query.isPending ? (
          <div className="p-8 text-center text-sm text-zinc-500">Yuklanmoqda...</div>
        ) : query.data?.length ? query.data.map((device) => (
          <div key={device.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-zinc-900">{device.model}</div>
              <div className="mt-1 text-xs text-zinc-500">{[device.color, device.storage, statusLabels[device.status]].filter(Boolean).join(' · ')}</div>
              <div className="mt-1 font-mono text-xs text-zinc-400">{device.imei}</div>
            </div>
            <Button render={<Link href={`/shop/qurilmalar/${device.id}?purpose=device`} />} nativeButton={false} variant="outline">Amalni ochish</Button>
          </div>
        )) : (
          <div className="p-8 text-center text-sm text-zinc-500">Mos qurilma topilmadi</div>
        )}
      </div>
    </div>
  )
}
