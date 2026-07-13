'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StorageInput } from '@/components/ui/storage-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyLabel } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { navigateAfterMutation } from '@/lib/client-events'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { patchDeviceUpsert } from '@/lib/device-query-cache'
import type { DeviceListItem } from '@/lib/device-list-contract'
import { DeviceImagePicker } from '@/components/shop/device-image-picker'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'

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
  const { can } = useShopAccess()
  if (!can('INVENTORY_MANAGE')) return <ShopAccessDenied />
  return <AuthorizedNewDevicePage />
}

function AuthorizedNewDevicePage() {
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
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Field label="Model" required>
              <Input
                value={form.model}
                onChange={set('model')}
                placeholder="iPhone 14 Pro"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field label="Rang" required>
              <Input
                value={form.color}
                onChange={set('color')}
                placeholder="Qora, Oq, Ko'k..."
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <StorageInput
              id="device-storage"
              amount={form.storage}
              unit={form.storageUnit}
              onAmountChange={(value) => setForm((prev) => ({ ...prev, storage: value }))}
              onUnitChange={(value) => setForm((prev) => ({ ...prev, storageUnit: value }))}
              required
              inputClassName="h-9 rounded"
            />
            <Field label="Akkumulyator %">
              <Input
                type="number"
                min="1"
                max="100"
                value={form.battery}
                onChange={set('battery')}
                placeholder="85"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field label={`Sotib olingan narx (${currencyLabel(currency.currency)})`} required>
              <MoneyInput
                currency={currency.currency}
                value={form.purchasePrice}
                onChange={(v) => setForm((prev) => ({ ...prev, purchasePrice: v }))}
                placeholder={currency.currency === 'USD' ? '600.00' : '7500000'}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field
              label="Asosiy IMEI"
              required
              help="15 ta raqam"
              error={form.imei && !/^\d{15}$/.test(form.imei) ? 'IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
            >
              <Input
                value={form.imei}
                onChange={set('imei')}
                placeholder="351234560012345"
                inputMode="numeric"
                maxLength={15}
                className="h-9 text-sm border-zinc-200 rounded font-mono"
              />
            </Field>
            <Field
              label="Ikkinchi IMEI"
              help="Ixtiyoriy, 15 ta raqam"
              error={form.secondaryImei && !/^\d{15}$/.test(form.secondaryImei) ? 'Ikkinchi IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
            >
              <Input value={form.secondaryImei} onChange={set('secondaryImei')} placeholder="351234560012346" inputMode="numeric" maxLength={15} className="h-9 text-sm border-zinc-200 rounded font-mono" />
            </Field>
            <div>
              <label htmlFor="device-condition" className="mb-1.5 block text-xs font-medium text-zinc-700">
                Holati <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <Select value={form.conditionCode} onValueChange={(value) => value && setForm((prev) => ({ ...prev, conditionCode: value as 'NEW' | 'USED' }))}>
                <SelectTrigger id="device-condition" aria-required="true" className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">B/U</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Yetkazib beruvchi</span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Field label="Yetkazib beruvchi ismi">
              <Input
                value={form.supplierName}
                onChange={set('supplierName')}
                placeholder="To'liq ism"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field label="Yetkazib beruvchi tel">
              <PhoneInput
                value={form.supplierPhone}
                onChange={(supplierPhone) => setForm((prev) => ({ ...prev, supplierPhone }))}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qo'shimcha</span>
          </div>
          <div className="p-4 space-y-4">
            <DeviceImagePicker inputId="device-images" previews={imagePreviews} onChange={handleImageChange} onRemove={removeImage} />

            <Field label="Izoh">
              <Textarea
                value={form.note}
                onChange={set('note')}
                placeholder="Qurilma haqida qo'shimcha ma'lumot..."
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </Field>
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
