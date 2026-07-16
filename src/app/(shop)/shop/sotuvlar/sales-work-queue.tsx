'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { uzDate } from '@/lib/dates'
import { formatUserFacingMoney } from '@/lib/currency'
import { useShopAccess } from '@/components/shop/shop-access-context'

interface SaleWorkItem {
  id: string
  model: string
  color: string | null
  storage: string | null
  imei: string
  status: 'SOLD_CASH' | 'SOLD_DEBT'
  sale: {
    id: string
    dueDate: string | null
    reminderEnabled: boolean
    contractCurrency: 'UZS' | 'USD'
    contractSalePrice: number
    contractRemainingAmount: number
    /** Owner-only margin; omitted from staff responses. */
    contractProfit?: number | null
    createdAt: string
    customer: { name: string; phone: string }
  } | null
}

export default function SalesWorkQueue() {
  const { memberKind } = useShopAccess()
  const showProfit = memberKind === 'SHOP_OWNER'
  const [search, setSearch] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const query = useQuery({
    queryKey: ['sales-work-queue', committedSearch],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ view: 'action-picker', purpose: 'sale', take: '50' })
      if (committedSearch) params.set('search', committedSearch)
      const response = await fetch(`/api/devices?${params}`, { signal, cache: 'no-store' })
      const json = await response.json() as { success?: boolean; data?: { items: SaleWorkItem[] }; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Sotuvlar yuklanmadi')
      return json.data.items.filter((item) => item.sale)
    },
  })

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Sotuvlar</h1>
        <p className="mt-1 text-sm text-zinc-500">Naqd va qarz sotuvlar</p>
      </div>
      <form className="flex max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); setCommittedSearch(search.trim()) }}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, IMEI, mijoz yoki telefon" />
        <Button type="submit" variant="outline" aria-label="Qidirish"><Search size={16} aria-hidden="true" /></Button>
      </form>
      {query.isError && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{query.error instanceof Error ? query.error.message : 'Xatolik'}</div>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500"><tr><th className="px-4 py-3">Qurilma</th><th className="px-4 py-3">Mijoz</th><th className="px-4 py-3">Sotuv</th>{showProfit && <th className="px-4 py-3">Foyda</th>}<th className="px-4 py-3">Qoldiq</th><th className="px-4 py-3">Muddat</th><th className="px-4 py-3">Eslatma</th><th className="px-4 py-3"><span className="sr-only">Amal</span></th></tr></thead>
          <tbody>
            {query.isPending ? (
              <tr><td colSpan={showProfit ? 8 : 7} className="p-8 text-center text-zinc-500">Yuklanmoqda...</td></tr>
            ) : query.data?.length ? query.data.map((item) => {
              const sale = item.sale!
              return (
                <tr key={sale.id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-3"><div className="font-medium text-zinc-900">{item.model}</div><div className="font-mono text-xs text-zinc-400">{item.imei}</div></td>
                  <td className="px-4 py-3"><div>{sale.customer.name}</div><div className="text-xs text-zinc-500">{formatUzPhoneDisplay(sale.customer.phone)}</div></td>
                  <td className="px-4 py-3 font-medium">{formatUserFacingMoney({ amount: sale.contractSalePrice, amountCurrency: sale.contractCurrency, displayCurrency: sale.contractCurrency })}</td>
                  {showProfit && <td className="px-4 py-3 font-medium text-emerald-600">{sale.contractProfit == null ? '—' : formatUserFacingMoney({ amount: sale.contractProfit, amountCurrency: sale.contractCurrency, displayCurrency: sale.contractCurrency })}</td>}
                  <td className="px-4 py-3 font-medium">{formatUserFacingMoney({ amount: sale.contractRemainingAmount, amountCurrency: sale.contractCurrency, displayCurrency: sale.contractCurrency })}</td>
                  <td className="px-4 py-3 text-zinc-600">{sale.dueDate ? uzDate(sale.dueDate) : '—'}</td>
                  <td className="px-4 py-3 text-zinc-600">{sale.reminderEnabled ? 'Yoqilgan' : "O'chirilgan"}</td>
                  <td className="px-4 py-3 text-right"><Button render={<Link href={`/shop/qurilmalar/${item.id}?purpose=sale`} />} nativeButton={false} variant="outline" size="sm">Ochish</Button></td>
                </tr>
              )
            }) : (
              <tr><td colSpan={showProfit ? 8 : 7} className="p-8 text-center text-zinc-500">Sotuv topilmadi</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
