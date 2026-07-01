'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft } from 'lucide-react'

interface FormData {
  model: string
  color: string
  storage: string
  battery: string
  purchasePrice: string
  imei: string
  supplierName: string
  supplierPhone: string
  note: string
}

export default function NewDevicePage() {
  const router = useRouter()
  const [form, setForm] = useState<FormData>({
    model: '',
    color: '',
    storage: '',
    battery: '',
    purchasePrice: '',
    imei: '',
    supplierName: '',
    supplierPhone: '',
    note: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const isValid = form.model.trim() && form.color.trim() && form.purchasePrice.trim() && form.imei.trim()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: form.model,
          color: form.color,
          storage: form.storage,
          batteryHealth: form.battery ? Number(form.battery) : undefined,
          purchasePrice: Number(form.purchasePrice),
          imei: form.imei,
          supplierName: form.supplierName || undefined,
          supplierPhone: form.supplierPhone || undefined,
          note: form.note || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        router.push('/shop/qurilmalar')
      } else {
        setError(json.error || 'Saqlashda xatolik yuz berdi')
      }
    } catch {
      setError('Saqlashda xatolik yuz berdi')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <Link href="/shop/qurilmalar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Qurilmalarga qaytish
      </Link>

      <div>
        <h1 className="text-xl font-bold text-zinc-900">Yangi qurilma qo'shish</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Omborga yangi qurilma kiriting</p>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Asosiy ma'lumotlar</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Model <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.model}
                onChange={set('model')}
                placeholder="iPhone 14 Pro"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Rang <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.color}
                onChange={set('color')}
                placeholder="Qora, Oq, Ko'k..."
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Xotira (GB)
              </label>
              <Input
                value={form.storage}
                onChange={set('storage')}
                placeholder="128, 256, 512..."
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Akkumulyator %
              </label>
              <Input
                type="number"
                min="1"
                max="100"
                value={form.battery}
                onChange={set('battery')}
                placeholder="85"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Sotib olingan narx <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={form.purchasePrice}
                onChange={set('purchasePrice')}
                placeholder="7500000"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                IMEI <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.imei}
                onChange={set('imei')}
                placeholder="351234560012345"
                className="h-9 text-sm border-zinc-200 rounded font-mono"
              />
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Yetkazib beruvchi</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Yetkazib beruvchi ismi
              </label>
              <Input
                value={form.supplierName}
                onChange={set('supplierName')}
                placeholder="To'liq ism"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Yetkazib beruvchi tel
              </label>
              <Input
                value={form.supplierPhone}
                onChange={set('supplierPhone')}
                placeholder="+998 90 000 00 00"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qo'shimcha</span>
          </div>
          <div className="p-4">
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
            <Textarea
              value={form.note}
              onChange={set('note')}
              placeholder="Qurilma haqida qo'shimcha ma'lumot..."
              className="text-sm border-zinc-200 rounded min-h-[80px]"
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={!isValid || loading}
          className="w-full h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
        >
          {loading ? 'Saqlanmoqda...' : 'Qurilmani saqlash'}
        </Button>
      </form>
    </div>
  )
}
