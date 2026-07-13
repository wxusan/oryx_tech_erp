'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { displayImei } from '@/lib/device-display'
import { isValidPhone, PHONE_ERROR } from '@/lib/phone'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { ArrowLeft, Check } from 'lucide-react'
import { InStockDevicePicker, type InStockPickerDevice } from '@/components/shop/in-stock-device-picker'
import { navigateAfterMutation } from '@/lib/client-events'
import type { PaymentMethod } from '@/lib/domain-types'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { CustomerCombobox, type CustomerPickerOption } from '@/components/shop/customer-combobox'

type Device = InStockPickerDevice

function fmt(n: number, currency: ReturnType<typeof useShopCurrency>['currency']) {
  return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
}

function deviceMeta(device: Device) {
  return [
    device.color,
    device.storageDisplay || device.storage,
    device.batteryHealth != null ? `${device.batteryHealth}%` : null,
    device.conditionLabel,
    `IMEI 1: ${displayImei(device.imei)}`,
    device.secondaryImei ? `IMEI 2: ${displayImei(device.secondaryImei)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export default function NewSotuvPage() {
  const { can } = useShopAccess()
  if (!can('CASH_SALE_CREATE')) return <ShopAccessDenied />
  return <AuthorizedNewSotuvPage />
}

function AuthorizedNewSotuvPage() {
  const router = useRouter()
  const { currency } = useShopCurrency()
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)

  // Step 2 form
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerMode, setCustomerMode] = useState<'PICK' | 'EXISTING' | 'NEW'>('PICK')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPickerOption | null>(null)
  const [phoneError, setPhoneError] = useState('')
  const phoneRef = useRef<HTMLInputElement>(null)
  // null = untouched (show the device's price as a live currency-aware
  // suggestion); a string = the value the user typed.
  const [salePriceInput, setSalePriceInput] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [fullyPaid, setFullyPaid] = useState<boolean | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialDate, setPartialDate] = useState('')
  const [reminder, setReminder] = useState(false)
  const [earlyReminder, setEarlyReminder] = useState(false)
  const [earlyReminderDays, setEarlyReminderDays] = useState('3')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Sotuv narxi (selling price) starts empty — it must never silently default
  // to the device's own kelish narxi (purchase price), shown separately,
  // read-only, in the selected-device card above.
  const salePrice = salePriceInput ?? ''

  // Select a device (does NOT auto-advance) — the user confirms with "Keyingi
  // bosqich". Kept as a plain function so it is never a hook dependency.
  function selectDevice(d: Device) {
    setSelectedDevice(d)
    setSalePriceInput(null)
  }

  // Stepper: only previous (completed) steps are clickable. Going back never
  // needs validation and never wipes entered data.
  function goToStep(n: 1 | 2) {
    if (n < step) setStep(n)
  }

  // Page "Orqaga": step back within the flow first, otherwise leave the page
  // (existing behavior — return to the operation picker).
  function handleBack() {
    if (step > 1) setStep((step - 1) as 1 | 2)
    else router.push('/shop/yangi-operatsiya')
  }

  const canSubmit =
    !!selectedDevice &&
    (customerMode === 'EXISTING' ? Boolean(selectedCustomer) : customerMode === 'NEW' && customerName.trim() && customerPhone.trim()) &&
    salePrice.trim() &&
    payMethod &&
    fullyPaid !== null &&
    (fullyPaid || (partialAmount.trim() && partialDate.trim())) &&
    (fullyPaid || !earlyReminder || (Number(earlyReminderDays) >= 1 && Number(earlyReminderDays) <= 60))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !selectedDevice || submitting) return
    // Phone format is checked here (not only server-side) so the error lands
    // under the field instead of as a late toast.
    if (customerMode === 'NEW' && !isValidPhone(customerPhone)) {
      setPhoneError(PHONE_ERROR)
      phoneRef.current?.focus()
      return
    }
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setSubmitError('USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko\'ring.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch(`/api/devices/${selectedDevice.id}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice.id,
          customerMode: customerMode === 'EXISTING' ? 'EXISTING' : 'NEW',
          customerId: selectedCustomer?.id,
          customerName: customerMode === 'NEW' ? customerName.trim() : undefined,
          customerPhone: customerMode === 'NEW' ? customerPhone.trim() : undefined,
          salePrice: Number(salePrice),
          inputCurrency: currency.currency,
          paymentMethod: payMethod,
          paidFully: fullyPaid,
          amountPaid: fullyPaid ? undefined : Number(partialAmount),
          dueDate: fullyPaid ? undefined : partialDate,
          reminderEnabled: fullyPaid ? false : reminder,
          earlyReminderEnabled: fullyPaid ? false : earlyReminder,
          earlyReminderDays: !fullyPaid && earlyReminder ? Number(earlyReminderDays) : undefined,
          note: note.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Sotuvni saqlashda xatolik')
      }
      await navigateAfterMutation(router, `/shop/qurilmalar/${selectedDevice.id}`, {
        kind: 'sale.created',
        deviceId: selectedDevice.id,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Sotuvni saqlashda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft size={14} />
        Orqaga
      </button>

      <div>
        <h1 className="text-xl font-bold text-zinc-900">Naqd sotuv</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Qurilmani naqd pul evaziga soting</p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {[
          { n: 1, label: 'Qurilma tanlash' },
          { n: 2, label: 'Sotuv ma\'lumotlari' },
        ].map(({ n, label }) => {
          const clickable = n < step
          return (
            <div key={n} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goToStep(n as 1 | 2)}
                disabled={!clickable}
                aria-current={step === n ? 'step' : undefined}
                aria-disabled={!clickable}
                className={`flex items-center gap-2 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    step >= n ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'
                  }`}
                >
                  {step > n ? <Check size={12} /> : n}
                </span>
                <span className={`text-sm ${step === n ? 'font-medium text-zinc-900' : 'text-zinc-400'}`}>
                  {label}
                </span>
              </button>
              {n < 2 && <div className="w-8 h-px bg-zinc-200 mx-1" />}
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <InStockDevicePicker
            selectedDevice={selectedDevice}
            onSelect={selectDevice}
            onDeepLinkSelect={(device) => {
              selectDevice(device)
              setStep(2)
            }}
            formatPrice={(price) => fmt(price, currency)}
          />
          <Button
            type="button"
            disabled={!selectedDevice}
            onClick={() => setStep(2)}
            className="h-9 w-full bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
          >
            Keyingi bosqich
          </Button>
        </div>
      )}

      {step === 2 && selectedDevice && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Selected device card */}
          <div className="border border-zinc-200 rounded p-4 bg-zinc-50">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm text-zinc-900">{selectedDevice.model}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{deviceMeta(selectedDevice)}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-400">Kelish narxi</div>
                  <span className="text-sm font-bold text-zinc-900">{fmt(selectedDevice.purchasePrice, currency)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs text-zinc-400 hover:text-zinc-700"
                >
                  O&apos;zgartirish
                </button>
              </div>
            </div>
          </div>

          {/* Customer */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">Mijoz ma&apos;lumotlari</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="sale-customer-picker" className="mb-1.5 block text-xs font-medium text-zinc-700">
                  Mavjud mijozni tanlang yoki yangisini yarating <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <CustomerCombobox
                  inputId="sale-customer-picker"
                  selected={selectedCustomer}
                  onSelect={(customer) => {
                    setSelectedCustomer(customer)
                    setCustomerMode('EXISTING')
                    setCustomerName(customer.name)
                    setCustomerPhone(customer.phone)
                    setPhoneError('')
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
              <div>
                <label htmlFor="sale-customer-name" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Mijoz ismi <span className="text-red-500">*</span>
                </label>
                <Input
                  id="sale-customer-name"
                  aria-required="true"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="To'liq ism"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label htmlFor="sale-customer-phone" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Mijoz tel <span className="text-red-500">*</span>
                </label>
                <PhoneInput
                  id="sale-customer-phone"
                  ref={phoneRef}
                  value={customerPhone}
                  onChange={(value) => {
                    setCustomerPhone(value)
                    if (phoneError) setPhoneError('')
                  }}
                  aria-invalid={!!phoneError}
                  aria-required="true"
                  aria-describedby={phoneError ? 'sale-customer-phone-error' : undefined}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
                {phoneError && <p id="sale-customer-phone-error" role="alert" className="mt-1 text-xs text-red-600">{phoneError}</p>}
              </div>
              </div>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="sale-price" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Sotuv narxi ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  id="sale-price"
                  aria-required="true"
                  currency={currency.currency}
                  value={salePrice}
                  onChange={setSalePriceInput}
                  placeholder={currency.currency === 'USD' ? '700.00' : '9500000'}
                  className="h-9 text-sm font-bold border-zinc-200 rounded"
                />
              </div>
              <div>
                <label htmlFor="sale-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  To&apos;lov usuli <span className="text-red-500">*</span>
                </label>
                <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v as PaymentMethod)}>
                  <SelectTrigger id="sale-payment-method" aria-required="true" className="h-9 text-sm border-zinc-200 rounded">
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
              </div>
            </div>
          </div>

          {/* Fully paid */}
          <div className="border border-zinc-200 rounded p-4">
            <div id="sale-fully-paid-label" className="text-xs font-medium text-zinc-700 mb-2.5">
              To&apos;liq to&apos;ladimi? <span className="text-red-500">*</span>
            </div>
            <div className="flex gap-2" role="group" aria-labelledby="sale-fully-paid-label">
              <button
                type="button"
                onClick={() => setFullyPaid(true)}
                aria-pressed={fullyPaid === true}
                className={`px-4 py-2 text-sm rounded border transition-colors ${
                  fullyPaid === true
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                Ha
              </button>
              <button
                type="button"
                onClick={() => setFullyPaid(false)}
                aria-pressed={fullyPaid === false}
                className={`px-4 py-2 text-sm rounded border transition-colors ${
                  fullyPaid === false
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                Yo&apos;q
              </button>
            </div>

            {fullyPaid === false && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 pt-4 border-t border-zinc-100">
                <div>
                  <label htmlFor="sale-partial-amount" className="block text-xs font-medium text-zinc-700 mb-1.5">
                    Qancha to&apos;ladi ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                  </label>
                  <MoneyInput
                    id="sale-partial-amount"
                    aria-required="true"
                    currency={currency.currency}
                    value={partialAmount}
                    onChange={setPartialAmount}
                    placeholder={currency.currency === 'USD' ? '400.00' : '5000000'}
                    className="h-9 text-sm border-zinc-200 rounded"
                  />
                </div>
                <div>
                  <label htmlFor="sale-partial-date" className="block text-xs font-medium text-zinc-700 mb-1.5">
                    Qachon to&apos;laydi <span className="text-red-500">*</span>
                  </label>
                  <DateInput
                    id="sale-partial-date"
                    aria-label="Qachon to'laydi"
                    value={partialDate}
                    onValueChange={setPartialDate}
                    className="h-9 text-sm border-zinc-200 rounded"
                  />
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="reminder"
                    checked={reminder}
                    onChange={(e) => setReminder(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-300"
                  />
                  <label htmlFor="reminder" className="text-sm text-zinc-700 cursor-pointer">
                    Eslatma yuborish
                  </label>
                </div>
                {reminder && (
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="early-reminder"
                      checked={earlyReminder}
                      onChange={(e) => setEarlyReminder(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-300"
                    />
                    <label htmlFor="early-reminder" className="text-sm text-zinc-700 cursor-pointer">
                      Ertaroq eslatilsinmi?
                    </label>
                  </div>
                )}
                {reminder && earlyReminder && (
                  <div className="sm:col-span-2">
                    <label htmlFor="sale-early-days" className="block text-xs font-medium text-zinc-700 mb-1.5">
                      Necha kun oldin? <span className="text-red-500">*</span>
                    </label>
                    <Input
                      id="sale-early-days"
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={earlyReminderDays}
                      onChange={(e) => setEarlyReminderDays(e.target.value)}
                      placeholder="3"
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label htmlFor="sale-note" className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
            <Textarea
              id="sale-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ixtiyoriy izoh..."
              className="text-sm border-zinc-200 rounded min-h-[70px]"
            />
          </div>

          {submitError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
              {submitError}
            </div>
          )}

          <Button
            type="submit"
            disabled={!canSubmit || submitting}
            className="w-full h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
          >
            {submitting ? 'Saqlanmoqda...' : 'Sotuvni saqlash'}
          </Button>
        </form>
      )}
    </div>
  )
}
