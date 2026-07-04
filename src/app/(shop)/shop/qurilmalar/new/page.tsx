'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { convertUsdToUzs, currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { ArrowLeft, ImagePlus, Loader2, X } from 'lucide-react'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

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
  const { currency, currencyError } = useShopCurrency()
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
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const imagePreviews = useMemo(() => imageFiles.map((file) => URL.createObjectURL(file)), [imageFiles])

  useEffect(() => {
    return () => imagePreviews.forEach((preview) => URL.revokeObjectURL(preview))
  }, [imagePreviews])

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const isValid = form.model.trim() && form.color.trim() && form.purchasePrice.trim() && form.imei.trim()

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
      setError('USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko\'ring.')
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
          storage: form.storage,
          batteryHealth: form.battery ? Number(form.battery) : undefined,
          purchasePrice: Number(form.purchasePrice),
          inputCurrency: currency.currency,
          imei: form.imei,
          supplierName: form.supplierName || undefined,
          supplierPhone: form.supplierPhone || undefined,
          note: form.note || undefined,
          imageUrls,
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
      {currencyError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-3">
          {currencyError}
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
                Sotib olingan narx ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
              </label>
              <MoneyInput
                currency={currency.currency}
                value={form.purchasePrice}
                onChange={(v) => setForm((prev) => ({ ...prev, purchasePrice: v }))}
                placeholder={currency.currency === 'USD' ? '600.00' : '7500000'}
                className="h-9 text-sm border-zinc-200 rounded"
              />
              {currency.currency === 'USD' && currency.usdUzsRate && Number(form.purchasePrice) > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  Saqlanadi: {formatMoneyByCurrency(convertUsdToUzs(Number(form.purchasePrice), currency.usdUzsRate), 'UZS')}
                </p>
              )}
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
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <label className="block text-xs font-medium text-zinc-700">Rasmlar</label>
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  <ImagePlus size={14} />
                  Rasm tanlash
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={handleImageChange}
                    className="sr-only"
                  />
                </label>
              </div>
              {imagePreviews.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {imagePreviews.map((preview, index) => (
                    <div key={`${preview}-${index}`} className="relative aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50">
                      <Image
                        src={preview}
                        alt={`Qurilma rasmi ${index + 1}`}
                        fill
                        sizes="160px"
                        unoptimized
                        className="object-cover"
                      />
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
