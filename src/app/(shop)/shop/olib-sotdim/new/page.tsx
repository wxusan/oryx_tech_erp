'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { navigateAfterMutation } from '@/lib/client-events'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StorageInput } from '@/components/ui/storage-input'
import { DateInput } from '@/components/ui/date-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyLabel, formatUserFacingMoney } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { isValidPhone, PHONE_ERROR } from '@/lib/phone'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { ArrowLeft, Loader2, Check } from 'lucide-react'
import type { PaymentMethod } from '@/lib/domain-types'

type CustomerPaymentMode = 'FULL' | 'PARTIAL' | 'LATER'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { CustomerCombobox, type CustomerPickerOption } from '@/components/shop/customer-combobox'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'

export default function NewOlibSotdimPage() {
  const { can } = useShopAccess()
  if (!can('OLIB_CREATE')) return <ShopAccessDenied />
  return <AuthorizedNewOlibSotdimPage />
}

function AuthorizedNewOlibSotdimPage() {
  const saleCommand = useLogicalCommandIdempotency()
  const router = useRouter()
  const { currency } = useShopCurrency()
  const { can, memberKind } = useShopAccess()
  const canSeeOwnerFinancials = memberKind === 'SHOP_OWNER'
  const today = tashkentTodayInputValue()
  const [step, setStep] = useState<1 | 2>(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Section 1 — device
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [storage, setStorage] = useState('')
  const [storageUnit, setStorageUnit] = useState<'GB' | 'TB'>('GB')
  const [battery, setBattery] = useState('')
  const [conditionCode, setConditionCode] = useState<'NEW' | 'USED' | ''>('')
  const [imei, setImei] = useState('')
  const [secondaryImei, setSecondaryImei] = useState('')
  const [deviceNote, setDeviceNote] = useState('')
  const imageSelection = useImageSelection({
    mode: 'multiple',
    uploadEndpoint: '/api/uploads/device',
    maxFiles: 10,
  })

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
  const [customerMode, setCustomerMode] = useState<'PICK' | 'EXISTING' | 'NEW'>('PICK')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPickerOption | null>(null)
  const [customerPhoneError, setCustomerPhoneError] = useState('')
  const customerPhoneRef = useRef<HTMLInputElement>(null)

  // Section 4 — sale to the customer
  const [salePrice, setSalePrice] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [customerPaymentMode, setCustomerPaymentMode] = useState<CustomerPaymentMode | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialDate, setPartialDate] = useState('')
  const [customerReminderEnabled, setCustomerReminderEnabled] = useState(false)
  const [note, setNote] = useState('')

  const fmt = (n: number) => formatUserFacingMoney({ amount: n, amountCurrency: currency.currency, displayCurrency: currency.currency, rate: currency.usdUzsRate })

  const profit = Number(salePrice || 0) - Number(purchasePrice || 0)
  const priceWarning = purchasePrice && salePrice && Number(salePrice) < Number(purchasePrice)

  const step1Valid =
    model.trim().length > 0 &&
    Number(storage) > 0 &&
    !!conditionCode &&
    /^\d{15}$/.test(imei) &&
    (!secondaryImei || /^\d{15}$/.test(secondaryImei)) &&
    supplierName.trim().length >= 2 &&
    isValidPhone(supplierPhone) &&
    purchasePrice.trim().length > 0 &&
    Number(purchasePrice) > 0 &&
    supplierPaidNow !== null &&
    (!supplierPaidNow || !!supplierPaymentMethod) &&
    (supplierPaidNow || supplierDueDate.trim().length > 0) &&
    (!earlyReminder || (Number(earlyReminderDays) >= 1 && Number(earlyReminderDays) <= 60)) &&
    (customerMode === 'EXISTING' ? Boolean(selectedCustomer) : customerMode === 'NEW' && customerName.trim().length >= 2 && isValidPhone(customerPhone)) &&
    salePrice.trim().length > 0 &&
    Number(salePrice) > 0 &&
    customerPaymentMode !== null &&
    (customerPaymentMode === 'LATER' || !!paymentMethod) &&
    (customerPaymentMode === 'FULL' || partialDate.trim().length > 0) &&
    (customerPaymentMode !== 'PARTIAL' || (partialAmount.trim().length > 0 && Number(partialAmount) > 0)) &&
    !imageSelection.hasBlockingErrors

  function handleContinue() {
    if (!isValidPhone(supplierPhone)) {
      setSupplierPhoneError(PHONE_ERROR)
      return
    }
    if (customerMode === 'NEW' && !isValidPhone(customerPhone)) {
      setCustomerPhoneError(PHONE_ERROR)
      customerPhoneRef.current?.focus()
      return
    }
    if (!step1Valid) return
    setStep(2)
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
      const paidFully = customerPaymentMode === 'FULL'
      const imageUrls = await imageSelection.uploadAll()
      const payload = {
        model: model.trim(),
        color: color.trim() || undefined,
        storageAmount: Number(storage),
        storageUnit,
        batteryHealth: battery ? Number(battery) : undefined,
        conditionCode,
        imei: imei.trim(),
        secondaryImei: secondaryImei.trim() || undefined,
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
        customerMode: customerMode === 'EXISTING' ? 'EXISTING' as const : 'NEW' as const,
        customerId: selectedCustomer?.id,
        customerName: customerMode === 'NEW' ? customerName.trim() : undefined,
        customerPhone: customerMode === 'NEW' ? customerPhone.trim() : undefined,
        salePrice: Number(salePrice),
        paymentMethod: customerPaymentMode === 'LATER' ? undefined : paymentMethod,
        paidFully,
        amountPaid: paidFully ? undefined : customerPaymentMode === 'LATER' ? 0 : Number(partialAmount),
        dueDate: paidFully ? undefined : partialDate,
        customerReminderEnabled: paidFully ? false : customerReminderEnabled,
        note: note.trim() || undefined,
        inputCurrency: currency.currency,
      }
      const res = await fetch('/api/olib-sotdim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': saleCommand.keyFor(payload) },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        saleCommand.rejected(res.status)
        throw new Error(json.error || 'Saqlashda xatolik')
      }
      saleCommand.committed()
      await navigateAfterMutation(router, can('OLIB_VIEW') || can('SUPPLIER_PAYMENT_MARK_PAID') ? '/shop/olib-sotdim' : '/shop/yangi-operatsiya', {
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
              <Field label="Model" required>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="iPhone 13 Pro"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Rang">
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Qora, Oq..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <StorageInput
                id="olib-storage"
                amount={storage}
                unit={storageUnit}
                onAmountChange={setStorage}
                onUnitChange={setStorageUnit}
                required
                inputClassName="h-9 rounded"
              />
              <Field label="Akkumulyator %">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={battery}
                  onChange={(e) => setBattery(e.target.value)}
                  placeholder="85"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              {customerPaymentMode !== 'LATER' && <div>
                <label htmlFor="olib-condition" className="block text-xs font-medium text-zinc-700 mb-1.5">Holati <span aria-hidden="true" className="text-red-500">*</span></label>
                <Select value={conditionCode} onValueChange={(value) => value && setConditionCode(value as 'NEW' | 'USED')}>
                  <SelectTrigger id="olib-condition" aria-required="true" className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">B/U</SelectItem></SelectContent>
                </Select>
              </div>}
              <Field
                label="Asosiy IMEI"
                required
                help="15 ta raqam"
                error={imei && !/^\d{15}$/.test(imei) ? 'IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
              >
                <Input
                  value={imei}
                  onChange={(e) => setImei(e.target.value)}
                  placeholder="351234560012345"
                  inputMode="numeric"
                  maxLength={15}
                  className="h-9 text-sm border-zinc-200 rounded font-mono"
                />
              </Field>
              <Field
                label="Ikkinchi IMEI"
                help="Ixtiyoriy, 15 ta raqam"
                error={secondaryImei && !/^\d{15}$/.test(secondaryImei) ? 'Ikkinchi IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
              >
                <Input value={secondaryImei} onChange={(e) => setSecondaryImei(e.target.value)} placeholder="351234560012346" inputMode="numeric" maxLength={15} className="h-9 text-sm border-zinc-200 rounded font-mono" />
              </Field>
              <ImageSelectionField
                inputId="olib-images"
                label="Qurilma rasmlari (ixtiyoriy)"
                mode="multiple"
                selection={imageSelection}
                disabled={submitting}
                className="sm:col-span-2"
              />
              <Field label="Izoh" className="sm:col-span-2">
                <Textarea
                  value={deviceNote}
                  onChange={(e) => setDeviceNote(e.target.value)}
                  placeholder="Qurilma haqida qo'shimcha ma'lumot..."
                  className="text-sm border-zinc-200 rounded min-h-[60px]"
                />
              </Field>
            </div>
          </div>

          {/* Section 2: Supplier */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">2. Kimdan olindi</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={<>Ism / do&apos;kon</>} required>
                <Input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Ali aka, 21-do'kon..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Tel raqami" required error={supplierPhoneError || undefined}>
                <PhoneInput
                  value={supplierPhone}
                  onChange={(value) => {
                    setSupplierPhone(value)
                    if (supplierPhoneError) setSupplierPhoneError('')
                  }}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Manzil / joylashuv" className="sm:col-span-2">
                <Input
                  value={supplierLocation}
                  onChange={(e) => setSupplierLocation(e.target.value)}
                  placeholder="Abu Saxiy 3-qator, Malika Bazar..."
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Izoh" className="sm:col-span-2">
                <Textarea
                  value={supplierNote}
                  onChange={(e) => setSupplierNote(e.target.value)}
                  className="text-sm border-zinc-200 rounded min-h-[50px]"
                />
              </Field>
              <Field label={`Olingan narx (${currencyLabel(currency.currency)})`} required>
                <MoneyInput
                  currency={currency.currency}
                  value={purchasePrice}
                  onChange={setPurchasePrice}
                  placeholder={currency.currency === 'USD' ? '500.00' : '6500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>

              <fieldset className="sm:col-span-2 pt-2 border-t border-zinc-100">
                <legend className="block text-xs font-medium text-zinc-700 mb-2">
                  Yetkazib beruvchiga to&apos;lov <span aria-hidden="true" className="text-red-500">*</span>
                </legend>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={supplierPaidNow === true}
                    onClick={() => setSupplierPaidNow(true)}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${supplierPaidNow === true ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Hozir to&apos;landi
                  </button>
                  <button
                    type="button"
                    aria-pressed={supplierPaidNow === false}
                    onClick={() => setSupplierPaidNow(false)}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${supplierPaidNow === false ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Keyin to&apos;lanadi
                  </button>
                </div>
              </fieldset>

              {supplierPaidNow === true && (
                <>
                  <div>
                    <label htmlFor="supplier-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">
                      To&apos;lov usuli <span aria-hidden="true" className="text-red-500">*</span>
                    </label>
                    <Select value={supplierPaymentMethod} onValueChange={(v) => v && setSupplierPaymentMethod(v as PaymentMethod)}>
                      <SelectTrigger id="supplier-payment-method" aria-required="true" className="h-9 w-full text-sm border-zinc-200 rounded">
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
                  <Field label={<>To&apos;lov sanasi</>}>
                    <DateInput
                      value={supplierPaidDate}
                      onValueChange={setSupplierPaidDate}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </Field>
                </>
              )}

              {supplierPaidNow === false && (
                <>
                  <Field label={<>To&apos;lov muddati</>} required>
                    <DateInput
                      value={supplierDueDate}
                      onValueChange={setSupplierDueDate}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </Field>
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
                    <Field label="Necha kun oldin?" required>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        value={earlyReminderDays}
                        onChange={(e) => setEarlyReminderDays(e.target.value)}
                        placeholder="3"
                        className="h-9 text-sm border-zinc-200 rounded"
                      />
                    </Field>
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
            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="olib-customer-picker" className="mb-1.5 block text-xs font-medium text-zinc-700">
                  Mavjud mijozni tanlang yoki yangisini yarating <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <CustomerCombobox
                  inputId="olib-customer-picker"
                  selected={selectedCustomer}
                  onSelect={(customer) => {
                    setSelectedCustomer(customer)
                    setCustomerMode('EXISTING')
                    setCustomerName(customer.name)
                    setCustomerPhone(customer.phone)
                    setCustomerPhoneError('')
                  }}
                  onClear={() => {
                    setSelectedCustomer(null)
                    setCustomerMode('PICK')
                    setCustomerName('')
                    setCustomerPhone('')
                  }}
                  onCreateNew={(searchText) => {
                    setSelectedCustomer(null)
                    setCustomerMode('NEW')
                    if (/\d/.test(searchText)) setCustomerPhone(searchText)
                    else setCustomerName(searchText)
                  }}
                  disabled={submitting}
                />
              </div>
              {customerMode === 'NEW' && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Mijoz ismi" required>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="To'liq ism"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Mijoz tel raqami" required error={customerPhoneError || undefined}>
                <PhoneInput
                  ref={customerPhoneRef}
                  value={customerPhone}
                  onChange={(value) => {
                    setCustomerPhone(value)
                    if (customerPhoneError) setCustomerPhoneError('')
                  }}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              </div>}
            </div>
          </div>

          {/* Section 4: Prices / payment to customer */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">4. Narxlar va to&apos;lov</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={`Sotilgan narx (${currencyLabel(currency.currency)})`} required>
                <MoneyInput
                  currency={currency.currency}
                  value={salePrice}
                  onChange={setSalePrice}
                  placeholder={currency.currency === 'USD' ? '600.00' : '7500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <div>
                <label htmlFor="customer-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  To&apos;lov usuli <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger id="customer-payment-method" aria-required="true" className="h-9 w-full text-sm border-zinc-200 rounded">
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

              {canSeeOwnerFinancials && priceWarning && (
                <div className="sm:col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Sotuv narxi olingan narxdan past
                </div>
              )}

              <fieldset className="sm:col-span-2">
                <legend className="block text-xs font-medium text-zinc-700 mb-2">
                  Bugun qancha to&apos;lanadi? <span aria-hidden="true" className="text-red-500">*</span>
                </legend>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={customerPaymentMode === 'FULL'}
                    onClick={() => setCustomerPaymentMode('FULL')}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${customerPaymentMode === 'FULL' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    To&apos;liq to&apos;laydi
                  </button>
                  <button
                    type="button"
                    aria-pressed={customerPaymentMode === 'PARTIAL'}
                    onClick={() => setCustomerPaymentMode('PARTIAL')}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${customerPaymentMode === 'PARTIAL' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Qisman to&apos;laydi
                  </button>
                  <button
                    type="button"
                    aria-pressed={customerPaymentMode === 'LATER'}
                    onClick={() => { setCustomerPaymentMode('LATER'); setPartialAmount(''); setPaymentMethod('') }}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${customerPaymentMode === 'LATER' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Hammasini keyin to&apos;laydi
                  </button>
                </div>
              </fieldset>

              {(customerPaymentMode === 'PARTIAL' || customerPaymentMode === 'LATER') && (
                <>
                  {customerPaymentMode === 'PARTIAL' && <Field label={<>Qancha to&apos;ladi ({currencyLabel(currency.currency)})</>} required>
                    <MoneyInput
                      currency={currency.currency}
                      value={partialAmount}
                      onChange={setPartialAmount}
                      placeholder={currency.currency === 'USD' ? '200.00' : '2500000'}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </Field>}
                  <Field label={<>Qachon to&apos;laydi</>} required>
                    <DateInput
                      value={partialDate}
                      onValueChange={setPartialDate}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </Field>
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

              <Field label="Izoh" className="sm:col-span-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Qo'shimcha ma'lumot..."
                  className="text-sm border-zinc-200 rounded min-h-[60px]"
                />
              </Field>
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
                  {model} {color && `· ${color}`} {storage && `· ${storage}${storageUnit}`} · {conditionCode === 'NEW' ? 'Yangi' : 'B/U'}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">IMEI 1: {imei}{secondaryImei && ` · IMEI 2: ${secondaryImei}`}</div>
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
              {canSeeOwnerFinancials && (
                <div className="pt-3 border-t border-zinc-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-500">{supplierPaidNow ? 'Foyda' : 'Kutilayotgan foyda'}</span>
                  <span className={`text-base font-bold ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmt(profit)}</span>
                </div>
              )}
              {canSeeOwnerFinancials && !supplierPaidNow && (
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
