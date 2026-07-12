'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyLabel } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { ArrowLeft, ImagePlus, Loader2, X } from 'lucide-react'
import { navigateAfterMutation } from '@/lib/client-events'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { patchDeviceUpsert } from '@/lib/device-query-cache'
import type { DeviceListItem } from '@/lib/device-list-contract'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface FormData {
  model: string
  color: string
  storage: string
  storageUnit: 'GB' | 'TB'
  conditionCode: 'NEW' | 'USED' | ''
  battery: string
  purchasePrice: string
  imei: string
  secondaryImei: string
  supplierName: string
  supplierPhone: string
  note: string
}

export default function NewDevicePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const queryScope = useAuthenticatedQueryScope()
  const { currency, currencyError } = useShopCurrency()
  const [form, setForm] = useState<FormData>({
    model: '',
    color: '',
    storage: '',
    storageUnit: 'GB',
    conditionCode: '',
    battery: '',
    purchasePrice: '',
    imei: '',
    secondaryImei: '',
    supplierName: '',
    supplierPhone: '',
    note: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const imagePreviews = useMemo(() => imageFiles.map((file) => URL.createObjectURL(file)), [imageFiles])

  useEffect(() => {
    return () => imagePreviews.forEach((preview) => URL.revokeObjectURL(preview))
  }, [imagePreviews])

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const isValid = form.model.trim() && form.color.trim() && form.storage.trim() && form.conditionCode && form.purchasePrice.trim() && /^\d{15}$/.test(form.imei) && (!form.secondaryImei || /^\d{15}$/.test(form.secondaryImei))

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return

    const invalidType = files.find((file) => !ALLOWED_IMAGE_TYPES.has(file.type))
    if (invalidType) {
      setError('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin')
      return
    }

    const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE)
    if (oversized) {
      setError('Har bir rasm hajmi 5 MB dan oshmasligi kerak')
      return
    }

    setError('')
    setImageFiles((prev) => [...prev, ...files])
  }

  function removeImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function uploadDeviceImages() {
    if (imageFiles.length === 0) return []

    return Promise.all(
      imageFiles.map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)

        const res = await fetch('/api/uploads/device', {
          method: 'POST',
          body: formData,
        })
        const json = await res.json()

        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Qurilma rasmini yuklashda xatolik')
        }

        return json.data.key as string
      }),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || loading) return
    setLoading(true)
    setError('')
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setError("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      setLoading(false)
      return
    }
    try {
      const imageUrls = await uploadDeviceImages()
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: form.model,
          color: form.color,
          storage: `${form.storage}${form.storageUnit}`,
          storageAmount: Number(form.storage),
          storageUnit: form.storageUnit,
          conditionCode: form.conditionCode,
          batteryHealth: form.battery ? Number(form.battery) : undefined,
          purchasePrice: Number(form.purchasePrice),
          inputCurrency: currency.currency,
          imei: form.imei,
          secondaryImei: form.secondaryImei || undefined,
          supplierName: form.supplierName || undefined,
          supplierPhone: form.supplierPhone || undefined,
          note: form.note || undefined,
          imageUrls,
        }),
      })
      const json = await res.json() as {
        success?: boolean
        error?: string
        data?: { id: string; item: DeviceListItem; changeCursor: string }
      }
      if (res.ok && json.success) {
        if (json.data?.item) patchDeviceUpsert(queryClient, queryScope, json.data.item)
        await navigateAfterMutation(router, '/shop/qurilmalar', {
          kind: 'device.created',
          deviceId: json.data?.id,
        })
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

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}
      {currencyError && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-3">{currencyError}</div>}

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
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Xotira <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                <Input type="number" min="0.01" step="0.01" value={form.storage} onChange={set('storage')} placeholder="256" className="h-9 text-sm border-zinc-200 rounded" />
                <Select value={form.storageUnit} onValueChange={(value) => value && setForm((prev) => ({ ...prev, storageUnit: value as 'GB' | 'TB' }))}>
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="GB">GB</SelectItem><SelectItem value="TB">TB</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Akkumulyator %</label>
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
                Sotib olingan narx ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
              </label>
              <MoneyInput
                currency={currency.currency}
                value={form.purchasePrice}
                onChange={(v) => setForm((prev) => ({ ...prev, purchasePrice: v }))}
                placeholder={currency.currency === 'USD' ? '600.00' : '7500000'}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Asosiy IMEI <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.imei}
                onChange={set('imei')}
                placeholder="351234560012345"
                inputMode="numeric"
                maxLength={15}
                className="h-9 text-sm border-zinc-200 rounded font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Ikkinchi IMEI</label>
              <Input value={form.secondaryImei} onChange={set('secondaryImei')} placeholder="351234560012346" inputMode="numeric" maxLength={15} className="h-9 text-sm border-zinc-200 rounded font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Holati <span className="text-red-500">*</span></label>
              <Select value={form.conditionCode} onValueChange={(value) => value && setForm((prev) => ({ ...prev, conditionCode: value as 'NEW' | 'USED' }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">B/U</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Yetkazib beruvchi</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Yetkazib beruvchi ismi</label>
              <Input
                value={form.supplierName}
                onChange={set('supplierName')}
                placeholder="To'liq ism"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Yetkazib beruvchi tel</label>
              <PhoneInput
                value={form.supplierPhone}
                onChange={(supplierPhone) => setForm((prev) => ({ ...prev, supplierPhone }))}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qo'shimcha</span>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <label className="block text-xs font-medium text-zinc-700">Rasmlar</label>
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  <ImagePlus size={14} />
                  Rasm tanlash
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageChange} className="sr-only" />
                </label>
              </div>
              {imagePreviews.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {imagePreviews.map((preview, index) => (
                    <div
                      key={`${preview}-${index}`}
                      className="relative aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50"
                    >
                      <Image src={preview} alt={`Qurilma rasmi ${index + 1}`} fill sizes="160px" unoptimized className="object-cover" />
                      <button
                        type="button"
                        aria-label="Rasmni olib tashlash"
                        onClick={() => removeImage(index)}
                        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded bg-white/90 text-zinc-700 shadow-sm hover:bg-white hover:text-red-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-xs text-zinc-500">
                  JPG, PNG yoki WEBP, 5 MB gacha
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
              <Textarea
                value={form.note}
                onChange={set('note')}
                placeholder="Qurilma haqida qo'shimcha ma'lumot..."
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={!isValid || loading}
          className="w-full h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" />
              Saqlanmoqda...
            </span>
          ) : (
            'Qurilmani saqlash'
          )}
        </Button>
      </form>
    </div>
  )
}
