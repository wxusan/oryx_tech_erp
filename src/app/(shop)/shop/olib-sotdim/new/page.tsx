'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { navigateAfterMutation } from '@/lib/client-events'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { isValidPhone, PHONE_ERROR } from '@/lib/phone'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { ArrowLeft, ImagePlus, Loader2, X, Check } from 'lucide-react'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'

export default function NewOlibSotdimPage() {
  const router = useRouter()
  const { currency } = useShopCurrency()
  const today = tashkentTodayInputValue()
  const [step, setStep] = useState<1 | 2>(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Section 1 — device
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [storage, setStorage] = useState('')
  const [battery, setBattery] = useState('')
  const [condition, setCondition] = useState('')
  const [imei, setImei] = useState('')
  const [deviceNote, setDeviceNote] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const imagePreviews = useMemo(() => imageFiles.map((file) => URL.createObjectURL(file)), [imageFiles])
  useEffect(() => {
    return () => imagePreviews.forEach((preview) => URL.revokeObjectURL(preview))
  }, [imagePreviews])

  // Section 2 — supplier ("kimdan olindi")
  const [supplierName, setSupplierName] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [supplierPhoneError, setSupplierPhoneError] = useState('')
  const [supplierLocation, setSupplierLocation] = useState('')
  const [supplierNote, setSupplierNote] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [supplierPaidNow, setSupplierPaidNow] = useState<boolean | null>(null)
  const [supplierPaymentMethod, setSupplierPaymentMethod] = useState<PaymentMethod | ''>('')
  const [supplierPaidDate, setSupplierPaidDate] = useState(today)
  const [supplierDueDate, setSupplierDueDate] = useState('')
  const [supplierReminderEnabled, setSupplierReminderEnabled] = useState(true)
  const [earlyReminder, setEarlyReminder] = useState(false)
  const [earlyReminderDays, setEarlyReminderDays] = useState('3')

  // Section 3 — customer ("kimga sotildi")
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerPhoneError, setCustomerPhoneError] = useState('')
  const customerPhoneRef = useRef<HTMLInputElement>(null)

  // Section 4 — sale to the customer
  const [salePrice, setSalePrice] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [fullyPaid, setFullyPaid] = useState<boolean | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialDate, setPartialDate] = useState('')
  const [customerReminderEnabled, setCustomerReminderEnabled] = useState(false)
  const [note, setNote] = useState('')

  const fmt = (n: number) => formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const invalidType = files.find((file) => !ALLOWED_IMAGE_TYPES.has(file.type))
    if (invalidType) {
      setSubmitError('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin')
      return
    }
    const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE)
    if (oversized) {
      setSubmitError('Har bir rasm hajmi 5 MB dan oshmasligi kerak')
      return
    }
    setSubmitError('')
    setImageFiles((prev) => [...prev, ...files])
  }

  function removeImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const profit = Number(salePrice || 0) - Number(purchasePrice || 0)
  const priceWarning = purchasePrice && salePrice && Number(salePrice) < Number(purchasePrice)

  const step1Valid =
    model.trim().length > 0 &&
    supplierName.trim().length >= 2 &&
    isValidPhone(supplierPhone) &&
    purchasePrice.trim().length > 0 &&
    Number(purchasePrice) > 0 &&
    supplierPaidNow !== null &&
    (!supplierPaidNow || !!supplierPaymentMethod) &&
    (supplierPaidNow || supplierDueDate.trim().length > 0) &&
    (!earlyReminder || (Number(earlyReminderDays) >= 1 && Number(earlyReminderDays) <= 60)) &&
    customerName.trim().length >= 2 &&
    isValidPhone(customerPhone) &&
    salePrice.trim().length > 0 &&
    Number(salePrice) > 0 &&
    !!paymentMethod &&
    fullyPaid !== null &&
    (fullyPaid || (partialAmount.trim().length > 0 && partialDate.trim().length > 0))

  function handleContinue() {
    if (!isValidPhone(supplierPhone)) {
      setSupplierPhoneError(PHONE_ERROR)
      return
    }
    if (!isValidPhone(customerPhone)) {
      setCustomerPhoneError(PHONE_ERROR)
      customerPhoneRef.current?.focus()
      return
    }
    if (!step1Valid) return
    setStep(2)
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
        if (!res.ok || !json.success) throw new Error(json.error || 'Qurilma rasmini yuklashda xatolik')
        return json.data.key as string
      }),
    )
  }

  async function handleSave() {
    if (!step1Valid || submitting) return
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setSubmitError("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const imageUrls = await uploadDeviceImages()
      const res = await fetch('/api/olib-sotdim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.trim(),
          color: color.trim() || undefined,
          storage: storage.trim() || undefined,
          batteryHealth: battery ? Number(battery) : undefined,
          condition: condition.trim() || undefined,
          imei: imei.trim() || undefined,
          deviceNote: deviceNote.trim() || undefined,
          imageUrls,
          supplierName: supplierName.trim(),
          supplierPhone: supplierPhone.trim(),
          supplierLocation: supplierLocation.trim() || undefined,
          supplierNote: supplierNote.trim() || undefined,
          purchasePrice: Number(purchasePrice),
          supplierPaidNow: !!supplierPaidNow,
          supplierPaymentMethod: supplierPaidNow ? supplierPaymentMethod : undefined,
          supplierPaidDate: supplierPaidNow ? supplierPaidDate : undefined,
          supplierDueDate: !supplierPaidNow ? supplierDueDate : undefined,
          supplierReminderEnabled: !supplierPaidNow ? supplierReminderEnabled : undefined,
          earlyReminderEnabled: !supplierPaidNow ? earlyReminder : undefined,
          earlyReminderDays: !supplierPaidNow && earlyReminder ? Number(earlyReminderDays) : undefined,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          salePrice: Number(salePrice),
          paymentMethod,
          paidFully: fullyPaid,
          amountPaid: fullyPaid ? undefined : Number(partialAmount),
          dueDate: fullyPaid ? undefined : partialDate,
          customerReminderEnabled: fullyPaid ? false : customerReminderEnabled,
          note: note.trim() || undefined,
          inputCurrency: currency.currency,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Saqlashda xatolik')
      await navigateAfterMutation(router, '/shop/olib-sotdim', {
        kind: 'olibSotdim.created',
        deviceId: json.data?.deviceId,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Saqlashda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <Link href="/shop/yangi-operatsiya" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Orqaga
      </Link>

      <div>
        <h1 className="text-xl font-bold text-zinc-900">Olib-sotdim</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Omborda yo&apos;q qurilmani boshqa do&apos;kondan olib, mijozga soting</p>
      </div>

      {submitError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{submitError}</div>}

      {step === 1 && (
        <div className="space-y-4">
          {/* Section 1: Device */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">1. Qurilma ma&apos;lumotlari</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Model <span className="text-red-500">*</span>
                </label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="iPhone 13 Pro"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Rang</label>
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Qora, Oq..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Xotira (GB)</label>
                <Input
                  value={storage}
                  onChange={(e) => setStorage(e.target.value)}
                  placeholder="128, 256..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Akkumulyator %</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={battery}
                  onChange={(e) => setBattery(e.target.value)}
                  placeholder="85"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Holati</label>
                <Input
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="Yangi, A klass..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">IMEI</label>
                <Input
                  value={imei}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder="Mavjud bo'lsa kiriting"
                  className="h-9 text-sm border-zinc-200 rounded font-mono"
                />
                <p className="mt-1 text-xs text-zinc-400">Bo&apos;sh qoldirilsa &quot;Kiritilmagan&quot; deb ko&apos;rsatiladi</p>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="block text-xs font-medium text-zinc-700">Rasm (ixtiyoriy)</label>
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                    <ImagePlus size={14} />
                    Rasm tanlash
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageChange} className="sr-only" />
                  </label>
                </div>
                {imagePreviews.length > 0 && (
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
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
                <Textarea
                  value={deviceNote}
                  onChange={(e) => setDeviceNote(e.target.value)}
                  placeholder="Qurilma haqida qo'shimcha ma'lumot..."
                  className="text-sm border-zinc-200 rounded min-h-[60px]"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Supplier */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">2. Kimdan olindi</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Ism / do&apos;kon <span className="text-red-500">*</span>
                </label>
                <Input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Ali aka, 21-do'kon..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Tel raqami <span className="text-red-500">*</span>
                </label>
                <PhoneInput
                  value={supplierPhone}
                  onChange={(value) => {
                    setSupplierPhone(value)
                    if (supplierPhoneError) setSupplierPhoneError('')
                  }}
                  aria-invalid={!!supplierPhoneError}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
                {supplierPhoneError && <p className="mt-1 text-xs text-red-600">{supplierPhoneError}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Manzil / joylashuv</label>
                <Input
                  value={supplierLocation}
                  onChange={(e) => setSupplierLocation(e.target.value)}
                  placeholder="Abu Saxiy 3-qator, Malika Bazar..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
                <Textarea
                  value={supplierNote}
                  onChange={(e) => setSupplierNote(e.target.value)}
                  className="text-sm border-zinc-200 rounded min-h-[50px]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Olingan narx ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  currency={currency.currency}
                  value={purchasePrice}
                  onChange={setPurchasePrice}
                  placeholder={currency.currency === 'USD' ? '500.00' : '6500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>

              <div className="sm:col-span-2 pt-2 border-t border-zinc-100">
                <label className="block text-xs font-medium text-zinc-700 mb-2">
                  Yetkazib beruvchiga to&apos;lov <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSupplierPaidNow(true)}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${supplierPaidNow === true ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Hozir to&apos;landi
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupplierPaidNow(false)}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${supplierPaidNow === false ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Keyin to&apos;lanadi
                  </button>
                </div>
              </div>

              {supplierPaidNow === true && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      To&apos;lov usuli <span className="text-red-500">*</span>
                    </label>
                    <Select value={supplierPaymentMethod} onValueChange={(v) => v && setSupplierPaymentMethod(v as PaymentMethod)}>
                      <SelectTrigger className="h-9 text-sm border-zinc-200 rounded">
                        <SelectValue placeholder="Tanlang" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Naqd</SelectItem>
                        <SelectItem value="CARD">Karta</SelectItem>
                        <SelectItem value="TRANSFER">Bank o&apos;tkazma</SelectItem>
                        <SelectItem value="OTHER">Boshqa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">To&apos;lov sanasi</label>
                    <Input
                      type="date"
                      value={supplierPaidDate}
                      onChange={(e) => setSupplierPaidDate(e.target.value)}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                </>
              )}

              {supplierPaidNow === false && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      To&apos;lov muddati <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="date"
                      value={supplierDueDate}
                      onChange={(e) => setSupplierDueDate(e.target.value)}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="supplier-reminder"
                      checked={supplierReminderEnabled}
                      onChange={(e) => setSupplierReminderEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300"
                    />
                    <label htmlFor="supplier-reminder" className="text-sm text-zinc-700 cursor-pointer">
                      Eslatma yuborish
                    </label>
                  </div>
                  {supplierReminderEnabled && (
                    <div className="sm:col-span-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="supplier-early-reminder"
                        checked={earlyReminder}
                        onChange={(e) => setEarlyReminder(e.target.checked)}
                        className="w-4 h-4 rounded border-zinc-300"
                      />
                      <label htmlFor="supplier-early-reminder" className="text-sm text-zinc-700 cursor-pointer">
                        Ertaroq eslatilsinmi?
                      </label>
                    </div>
                  )}
                  {supplierReminderEnabled && earlyReminder && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        Necha kun oldin? <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        value={earlyReminderDays}
                        onChange={(e) => setEarlyReminderDays(e.target.value)}
                        placeholder="3"
                        className="h-9 text-sm border-zinc-200 rounded"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Section 3: Customer */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">3. Kimga sotildi</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Mijoz ismi <span className="text-red-500">*</span>
                </label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="To'liq ism"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Mijoz tel raqami <span className="text-red-500">*</span>
                </label>
                <PhoneInput
                  ref={customerPhoneRef}
                  value={customerPhone}
                  onChange={(value) => {
                    setCustomerPhone(value)
                    if (customerPhoneError) setCustomerPhoneError('')
                  }}
                  aria-invalid={!!customerPhoneError}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
                {customerPhoneError && <p className="mt-1 text-xs text-red-600">{customerPhoneError}</p>}
              </div>
            </div>
          </div>

          {/* Section 4: Prices / payment to customer */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">4. Narxlar va to&apos;lov</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Sotilgan narx ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  currency={currency.currency}
                  value={salePrice}
                  onChange={setSalePrice}
                  placeholder={currency.currency === 'USD' ? '600.00' : '7500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  To&apos;lov usuli <span className="text-red-500">*</span>
                </label>
                <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger className="h-9 text-sm border-zinc-200 rounded">
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Naqd</SelectItem>
                    <SelectItem value="CARD">Karta</SelectItem>
                    <SelectItem value="TRANSFER">Bank o&apos;tkazma</SelectItem>
                    <SelectItem value="OTHER">Boshqa</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {priceWarning && (
                <div className="sm:col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Sotuv narxi olingan narxdan past
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-2">
                  To&apos;liq to&apos;ladimi? <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFullyPaid(true)}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${fullyPaid === true ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Ha
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullyPaid(false)}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${fullyPaid === false ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Yo&apos;q
                  </button>
                </div>
              </div>

              {fullyPaid === false && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      Qancha to&apos;ladi ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                    </label>
                    <MoneyInput
                      currency={currency.currency}
                      value={partialAmount}
                      onChange={setPartialAmount}
                      placeholder={currency.currency === 'USD' ? '200.00' : '2500000'}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      Qachon to&apos;laydi <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="date"
                      value={partialDate}
                      onChange={(e) => setPartialDate(e.target.value)}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="customer-reminder"
                      checked={customerReminderEnabled}
                      onChange={(e) => setCustomerReminderEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300"
                    />
                    <label htmlFor="customer-reminder" className="text-sm text-zinc-700 cursor-pointer">
                      Mijozga eslatma yuborish
                    </label>
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Qo'shimcha ma'lumot..."
                  className="text-sm border-zinc-200 rounded min-h-[60px]"
                />
              </div>
            </div>
          </div>

          <Button
            type="button"
            disabled={!step1Valid}
            onClick={handleContinue}
            className="w-full h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
          >
            Ko&apos;rib chiqish
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900">5. Tasdiqlash</span>
              <button type="button" onClick={() => setStep(1)} className="text-xs text-zinc-400 hover:text-zinc-700">
                O&apos;zgartirish
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <div className="text-xs font-semibold text-zinc-500 mb-1.5">Qurilma</div>
                <div className="text-zinc-900">
                  {model} {color && `· ${color}`} {storage && `· ${storage}GB`}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">IMEI: {imei.trim() || 'Kiritilmagan'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 mb-1.5">Kimdan olindi</div>
                <div className="text-zinc-900">
                  {supplierName} · {supplierPhone}
                </div>
                {supplierLocation && <div className="text-xs text-zinc-500 mt-0.5">{supplierLocation}</div>}
                <div className="text-xs text-zinc-500 mt-0.5">
                  Olingan narx: {fmt(Number(purchasePrice))} · {supplierPaidNow ? "Hozir to'landi" : `Keyin to'lanadi (${supplierDueDate})`}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 mb-1.5">Kimga sotildi</div>
                <div className="text-zinc-900">
                  {customerName} · {customerPhone}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">Sotilgan narx: {fmt(Number(salePrice))}</div>
              </div>
              <div className="pt-3 border-t border-zinc-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">{supplierPaidNow ? 'Foyda' : 'Kutilayotgan foyda'}</span>
                <span className={`text-base font-bold ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmt(profit)}</span>
              </div>
              {!supplierPaidNow && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Yetkazib beruvchiga hali to&apos;lanmagan — foyda qarz to&apos;langandan keyin real hisoblanadi.
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)} className="border-zinc-200 text-zinc-700 rounded">
              Orqaga
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="flex-1 h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={15} className="animate-spin" />
                  Saqlanmoqda...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Check size={15} />
                  Olib-sotishni saqlash
                </span>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
