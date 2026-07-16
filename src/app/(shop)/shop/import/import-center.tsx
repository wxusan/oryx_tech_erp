'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { FileUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { parseCustomerImportCsv, type CustomerImportRow } from '@/lib/csv-import'
import { isValidPhone } from '@/lib/phone'

const EMPTY_ROW: CustomerImportRow = { name: '', phone: '', note: '' }

export default function ImportCenter() {
  const { can } = useShopAccess()
  const canImportCustomers = can('IMPORT_CUSTOMERS')
  const canImportNasiya = can('IMPORT_OLD_NASIYA')
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<CustomerImportRow[]>([{ ...EMPTY_ROW }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  function updateRow(index: number, key: keyof CustomerImportRow, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }

  async function readCsv(file: File) {
    setError('')
    setResult('')
    if (file.size > 1024 * 1024) {
      setError('CSV fayl 1 MB dan oshmasligi kerak')
      return
    }
    try {
      setRows(parseCustomerImportCsv(await file.text()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSV fayl o'qilmadi")
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit() {
    const customers = rows.map((row) => ({
      name: row.name.trim(),
      phone: row.phone.trim(),
      ...(row.note?.trim() ? { note: row.note.trim() } : {}),
    })).filter((row) => row.name || row.phone || row.note)
    const invalid = customers.findIndex((row) => row.name.length < 2 || !isValidPhone(row.phone))
    if (!customers.length) {
      setError('Kamida bitta mijoz kiriting')
      return
    }
    if (invalid >= 0) {
      setError(`${invalid + 1}-qatordagi ism yoki telefon noto'g'ri`)
      return
    }
    setSaving(true)
    setError('')
    setResult('')
    try {
      const response = await fetch('/api/import/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customers }),
      })
      const json = await response.json() as {
        success?: boolean
        error?: string
        data?: { created: number; updated: number; total: number }
      }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Import amalga oshmadi')
      setResult(`${json.data.total} ta mijoz: ${json.data.created} ta yangi, ${json.data.updated} ta yangilandi`)
      setRows([{ ...EMPTY_ROW }])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import amalga oshmadi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Import</h1>
        <p className="mt-1 text-sm text-zinc-500">Ruxsat berilgan ma&apos;lumotlarni kiritish</p>
      </div>

      {canImportCustomers && (
        <section className="space-y-4 border-t border-zinc-200 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-zinc-900">Mijozlar</h2>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void readCsv(file)
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp size={15} aria-hidden="true" /> CSV tanlash
              </Button>
              <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, { ...EMPTY_ROW }])}>
                <Plus size={15} aria-hidden="true" /> Qator
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                <tr><th className="px-3 py-2">Ism</th><th className="px-3 py-2">Telefon</th><th className="px-3 py-2">Izoh</th><th className="w-12 px-3 py-2"><span className="sr-only">Amal</span></th></tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b border-zinc-100 last:border-0">
                    <td className="p-2"><Input aria-label={`${index + 1}-qator ism`} value={row.name} onChange={(event) => updateRow(index, 'name', event.target.value)} /></td>
                    <td className="p-2"><Input aria-label={`${index + 1}-qator telefon`} value={row.phone} onChange={(event) => updateRow(index, 'phone', event.target.value)} placeholder="+998901234567" /></td>
                    <td className="p-2"><Input aria-label={`${index + 1}-qator izoh`} value={row.note ?? ''} onChange={(event) => updateRow(index, 'note', event.target.value)} /></td>
                    <td className="p-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${index + 1}-qatorni o'chirish`}
                        disabled={rows.length === 1}
                        onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {result && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{result}</div>}
          <Button type="button" disabled={saving} onClick={() => void submit()}>{saving ? 'Import qilinmoqda...' : 'Mijozlarni import qilish'}</Button>
        </section>
      )}

      {canImportNasiya && (
        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Eski nasiya</h2>
            <p className="mt-1 text-sm text-zinc-500">Bitta eski nasiya shartnomasini kiritish</p>
          </div>
          <Button render={<Link href="/shop/nasiyalar/import" />} nativeButton={false}>Eski nasiya kiritish</Button>
        </section>
      )}
    </div>
  )
}
