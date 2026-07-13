'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Check } from 'lucide-react'
import { convertUsdToUzs, convertUzsToUsd, currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { displayImei } from '@/lib/device-display'
import { isValidPhone, PHONE_ERROR } from '@/lib/phone'
import { calculateNasiyaAmounts, calculateNasiyaAmountsFromMonthlyPayment, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { InStockDevicePicker, type InStockPickerDevice } from '@/components/shop/in-stock-device-picker'
import { navigateAfterMutation } from '@/lib/client-events'
import { tashkentTodayInputValue } from '@/lib/timezone'
import type { PaymentMethod } from '@/lib/domain-types'
import { NasiyaSchedulePreview } from '@/components/shop/nasiya-schedule-preview'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { CustomerCombobox, type CustomerPickerOption } from '@/components/shop/customer-combobox'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'

type Device = InStockPickerDevice

function fmt(n: number, currency?: ReturnType<typeof useShopCurrency>['currency']) {
  if (currency) return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
  return Math.round(n).toLocaleString('ru-RU')
}

function today() {
  return tashkentTodayInputValue()
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

export default function NewNasiyaPage() {
  const { can } = useShopAccess()
  if (!can('NASIYA_CREATE')) return <ShopAccessDenied />
  return <AuthorizedNewNasiyaPage />
}

function AuthorizedNewNasiyaPage() {
  const router = useRouter()
  const { currency } = useShopCurrency()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)

  // Step 2
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerMode, setCustomerMode] = useState<'PICK' | 'EXISTING' | 'NEW'>('PICK')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPickerOption | null>(null)
  const passportSelection = useImageSelection({
    mode: 'single',
    uploadEndpoint: '/api/uploads/passport',
  })
  const [nameError, setNameError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const phoneRef = useRef<HTMLInputElement>(null)

  // Step 3
  // null = untouched (show the device's price as a live currency-aware
  // suggestion); a string = the value the user typed.
  const [totalPriceInput, setTotalPriceInput] = useState<string | null>(null)
  const [downPayment, setDownPayment] = useState('')
  const [months, setMonths] = useState('12')
  const [interestPercent, setInterestPercent] = useState('0')
  // Item 6: null = derive monthlyPayment from interestPercent (the default,
  // forward calculation); a string = the shop admin manually typed a monthly
  // payment instead, so interestPercent/interestAmount/finalNasiyaAmount are
  // now DERIVED from it (the reverse calculation) rather than the other way
  // around. Editing interestPercent again clears this back to null.
  const [monthlyPaymentInput, setMonthlyPaymentInput] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(today)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [earlyReminder, setEarlyReminder] = useState(false)
  const [earlyReminderDays, setEarlyReminderDays] = useState('3')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // The device's price in the shop's display currency (UZS base → USD when set).
  function priceFor(d: Device) {
    return currency.currency === 'USD' && currency.usdUzsRate
      ? convertUzsToUsd(d.purchasePrice, currency.usdUzsRate).toFixed(2)
      : String(d.purchasePrice)
  }

  // Sotilish narxi (selling price) starts empty — the shop decides this price
  // per deal; it must never silently default to the device's own purchase
  // (kelish narxi) price, which is shown separately as a read-only reference.
  const totalPrice = totalPriceInput ?? ''

  // Select a device (does NOT auto-advance) — the user confirms with "Keyingi
  // bosqich". Kept as a plain function so it is never a hook dependency.
  function selectDevice(d: Device) {
    setSelectedDevice(d)
    setTotalPriceInput(null)
    // A monthly-payment override made against a different device's price is
    // no longer meaningful once the device (and its price) changes.
    setMonthlyPaymentInput(null)
  }

  // Stepper: only previous (completed) steps are clickable. Going back never
  // needs validation and never wipes entered data.
  function goToStep(n: 1 | 2 | 3) {
    if (n < step) setStep(n)
  }

  // Page "Orqaga": step back within the flow first, otherwise leave the page
  // (existing behavior — return to the operation picker).
  function handleBack() {
    if (step > 1) setStep((step - 1) as 1 | 2 | 3)
    else router.push('/shop/yangi-operatsiya')
  }

  // Step 2 → Step 3: validate customer name + phone here so the error appears
  // under the field on this step, not only at final save. Server still
  // re-validates on submit (source of truth).
  function handleContinueToTerms() {
    let ok = true
    if (customerMode === 'PICK') return
    if (customerMode === 'NEW' && customerName.trim().length < 2) {
      setNameError("Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      ok = false
    }
    if (customerMode === 'NEW' && !isValidPhone(customerPhone)) {
      setPhoneError(PHONE_ERROR)
      ok = false
    }
    if (!ok) {
      if (customerMode === 'NEW' && !isValidPhone(customerPhone)) phoneRef.current?.focus()
      return
    }
    setStep(3)
  }

  const totalPriceUzs = currency.currency === 'USD' && currency.usdUzsRate
    ? convertUsdToUzs(Number(totalPrice) || 0, currency.usdUzsRate)
    : Number(totalPrice) || 0
  const downPaymentUzs = currency.currency === 'USD' && currency.usdUzsRate
    ? convertUsdToUzs(Number(downPayment) || 0, currency.usdUzsRate)
    : Number(downPayment) || 0
  const monthlyPaymentUzs = currency.currency === 'USD' && currency.usdUzsRate
    ? convertUsdToUzs(Number(monthlyPaymentInput) || 0, currency.usdUzsRate)
    : Number(monthlyPaymentInput) || 0

  const calculation = useMemo(() => {
    try {
      // Item 6: a manually-entered monthly payment drives interest
      // (reverse calculation) instead of the other way around.
      if (monthlyPaymentInput !== null && monthlyPaymentInput.trim() !== '') {
        return calculateNasiyaAmountsFromMonthlyPayment({
          totalAmount: totalPriceUzs,
          downPayment: downPaymentUzs,
          months: Number(months),
          monthlyPayment: monthlyPaymentUzs,
        })
      }
      return calculateNasiyaAmounts({
        totalAmount: totalPriceUzs,
        downPayment: downPaymentUzs,
        months: Number(months),
        interestPercent: Number(interestPercent || 0),
      })
    } catch {
      return {
        totalAmount: totalPriceUzs,
        downPayment: downPaymentUzs,
        baseRemainingAmount: Math.max(0, totalPriceUzs - downPaymentUzs),
        interestPercent: Number(interestPercent || 0),
        interestAmount: 0,
        finalNasiyaAmount: 0,
        monthlyPayment: 0,
      }
    }
  }, [totalPriceUzs, downPaymentUzs, months, interestPercent, monthlyPaymentInput, monthlyPaymentUzs])

  const remaining = calculation.baseRemainingAmount
  const interestAmount = calculation.interestAmount
  const finalNasiyaAmount = calculation.finalNasiyaAmount
  const monthlyPayment = calculation.monthlyPayment

  const schedule = useMemo(() => {
    if (!startDate || !months) return []
    const m = parseInt(months) || 12
    if (finalNasiyaAmount <= 0) return []
    return generatePaymentSchedule(new Date(startDate), m, finalNasiyaAmount).map((item) => ({
      month: item.monthNumber,
      date: item.dueDate.toISOString().slice(0, 10),
      amount: item.expectedAmount,
    }))
  }, [startDate, months, finalNasiyaAmount])

  const needsPassportPhoto = customerMode === 'NEW' || (customerMode === 'EXISTING' && !selectedCustomer?.hasPassportPhoto)
  const step2Valid =
    (customerMode === 'EXISTING' ? Boolean(selectedCustomer) : customerMode === 'NEW' && customerName.trim() && customerPhone.trim()) &&
    (!needsPassportPhoto || passportSelection.items.length === 1) &&
    !passportSelection.hasBlockingErrors
  const step3Valid =
    !!selectedDevice &&
    totalPrice.trim() &&
    downPayment.trim() &&
    months &&
    startDate.trim() &&
    payMethod &&
    (!earlyReminder || (Number(earlyReminderDays) >= 1 && Number(earlyReminderDays) <= 60))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!step3Valid || !selectedDevice || !step2Valid || submitting) return
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setSubmitError('USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko\'ring.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const [passportPhotoUrl] = await passportSelection.uploadAll()

      const res = await fetch(`/api/devices/${selectedDevice.id}/nasiya`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice.id,
          customerMode: customerMode === 'EXISTING' ? 'EXISTING' : 'NEW',
          customerId: selectedCustomer?.id,
          customerName: customerMode === 'NEW' ? customerName.trim() : undefined,
          customerPhone: customerMode === 'NEW' ? customerPhone.trim() : undefined,
          passportPhotoUrl,
          totalAmount: Number(totalPrice),
          downPayment: Number(downPayment),
          inputCurrency: currency.currency,
          months: Number(months),
          interestPercent: Number(interestPercent || 0),
          ...(monthlyPaymentInput !== null && monthlyPaymentInput.trim() !== ''
            ? { monthlyPayment: Number(monthlyPaymentInput), useMonthlyPaymentOverride: true }
            : {}),
          startDate,
          paymentMethod: payMethod,
          earlyReminderEnabled: earlyReminder,
          earlyReminderDays: earlyReminder ? Number(earlyReminderDays) : undefined,
          note: note.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Nasiyani saqlashda xatolik')
      }
      await navigateAfterMutation(router, `/shop/qurilmalar/${selectedDevice.id}`, {
        kind: 'nasiya.created',
        deviceId: selectedDevice.id,
        nasiyaId: json.data?.nasiyaId,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Nasiyani saqlashda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  const stepLabels = ['Qurilma tanlash', 'Mijoz ma\'lumotlari', 'Nasiya shartlari']

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
        <h1 className="text-xl font-bold text-zinc-900">Yangi nasiya</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Qurilmani nasiya asosida bering</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {stepLabels.map((label, idx) => {
          const n = idx + 1 as 1 | 2 | 3
          const done = step > n
          const active = step === n
          const clickable = n < step
          return (
            <div key={n} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goToStep(n)}
                disabled={!clickable}
                aria-current={active ? 'step' : undefined}
                aria-disabled={!clickable}
                className={`flex items-center gap-1 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    done || active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'
                  }`}
                >
                  {done ? <Check size={12} /> : n}
                </span>
                <span className={`text-sm ${active ? 'font-medium text-zinc-900' : done ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {label}
                </span>
              </button>
              {n < 3 && <div className="w-6 h-px bg-zinc-200 mx-1" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Device search */}
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

      {/* Step 2: Customer */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Selected device mini card */}
          {selectedDevice && (
            <div className="border border-zinc-200 rounded p-3 bg-zinc-50 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm text-zinc-900">{selectedDevice.model}</div>
                <div className="text-xs text-zinc-500">{deviceMeta(selectedDevice)}</div>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-zinc-400 hover:text-zinc-700"
              >
                O&apos;zgartirish
              </button>
            </div>
          )}

          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">Mijoz ma&apos;lumotlari</span>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="nasiya-customer-picker" className="mb-1.5 block text-xs font-medium text-zinc-700">
                  Mavjud mijozni tanlang yoki yangisini yarating <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <CustomerCombobox
                  inputId="nasiya-customer-picker"
                  selected={selectedCustomer}
                  onSelect={(customer) => {
                    setSelectedCustomer(customer)
                    setCustomerMode('EXISTING')
                    setCustomerName(customer.name)
                    setCustomerPhone(customer.phone)
                    setNameError('')
                    setPhoneError('')
                    passportSelection.clear()
                  }}
                  onClear={() => {
                    setSelectedCustomer(null)
                    setCustomerMode('PICK')
                    setCustomerName('')
                    setCustomerPhone('')
                    passportSelection.clear()
                  }}
                  onCreateNew={(searchText) => {
                    setSelectedCustomer(null)
                    setCustomerMode('NEW')
                    passportSelection.clear()
                    if (/\d/.test(searchText)) setCustomerPhone(searchText)
                    else setCustomerName(searchText)
                  }}
                  disabled={submitting}
                />
              </div>
              {customerMode === 'NEW' && <>
              <Field label="Mijoz ismi" required error={nameError || undefined}>
                <Input
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value)
                    if (nameError) setNameError('')
                  }}
                  placeholder="To'liq ism"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Mijoz tel raqami" required error={phoneError || undefined}>
                <PhoneInput
                  ref={phoneRef}
                  value={customerPhone}
                  onChange={(value) => {
                    setCustomerPhone(value)
                    if (phoneError) setPhoneError('')
                  }}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              </>}
              {customerMode === 'EXISTING' && selectedCustomer?.hasPassportPhoto && (
                <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Tanlangan mijozning private pasport rasmi mavjud; qayta yuklash shart emas.
                </p>
              )}
              {needsPassportPhoto && (
                <ImageSelectionField
                  inputId="nasiya-passport-image"
                  label="Pasport rasmi"
                  mode="single"
                  required
                  selection={passportSelection}
                  disabled={submitting}
                  help="Private saqlanadi; Telegram qurilma rasmlariga qo‘shilmaydi. JPG, PNG yoki WEBP, 5 MB gacha."
                />
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              className="border-zinc-200 text-zinc-700 rounded"
            >
              Orqaga
            </Button>
            <Button
              type="button"
              disabled={!step2Valid}
              onClick={handleContinueToTerms}
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              Davom etish
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Nasiya terms */}
      {step === 3 && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {selectedDevice && (
            <div className="border border-zinc-200 rounded p-3 bg-zinc-50 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm text-zinc-900">{selectedDevice.model}</div>
                <div className="text-xs text-zinc-500">{customerName} · {customerPhone}</div>
              </div>
              <button type="button" onClick={() => setStep(2)} className="text-xs text-zinc-400 hover:text-zinc-700">
                O&apos;zgartirish
              </button>
            </div>
          )}

          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">Nasiya shartlari</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {selectedDevice && (
                <div className="sm:col-span-2" role="group" aria-labelledby="nasiya-device-cost-label">
                  <div id="nasiya-device-cost-label" className="block text-xs font-medium text-zinc-700 mb-1.5">
                    Kelish narxi (qurilma tannarxi)
                  </div>
                  <div className="flex h-9 items-center rounded border border-zinc-200 bg-zinc-50 px-2.5 text-sm text-zinc-500">
                    {currencyLabel(currency.currency)} {priceFor(selectedDevice)}
                  </div>
                </div>
              )}
              <Field label={`Sotilish narxi (${currencyLabel(currency.currency)})`} required>
                <MoneyInput
                  currency={currency.currency}
                  value={totalPrice}
                  onChange={setTotalPriceInput}
                  placeholder={currency.currency === 'USD' ? '700.00' : '9500000'}
                  className="h-9 text-sm font-bold border-zinc-200 rounded"
                />
              </Field>
              <Field label={<>Boshlang&apos;ich to&apos;lov ({currencyLabel(currency.currency)})</>} required>
                <MoneyInput
                  currency={currency.currency}
                  value={downPayment}
                  onChange={setDownPayment}
                  placeholder={currency.currency === 'USD' ? '150.00' : '2000000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Qolgan summa">
                <Input
                  readOnly
                  value={remaining > 0 ? fmt(remaining, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </Field>
              <Field
                label="Nasiya foizi (%)"
                required
                help={monthlyPaymentInput !== null ? <>Qo&apos;lda kiritilgan oylik to&apos;lovdan hisoblandi</> : undefined}
              >
                <Input
                  type="number"
                  min={0}
                  max={300}
                  step={1}
                  value={monthlyPaymentInput !== null ? String(calculation.interestPercent) : interestPercent}
                  onChange={(e) => {
                    setInterestPercent(e.target.value)
                    // Editing the percent directly hands control back to the
                    // forward calculation — any manual monthly-payment
                    // override is cleared (item 6).
                    setMonthlyPaymentInput(null)
                  }}
                  placeholder="0"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <div>
                <label htmlFor="nasiya-months" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Oylar <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <Select value={months} onValueChange={(v) => v && setMonths(v)}>
                  <SelectTrigger id="nasiya-months" aria-required="true" className="h-9 w-full text-sm border-zinc-200 rounded">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} oy
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field label="Foiz summasi">
                <Input
                  readOnly
                  value={interestAmount > 0 ? fmt(interestAmount, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </Field>
              <Field label="Nasiya jami">
                <Input
                  readOnly
                  value={finalNasiyaAmount > 0 ? fmt(finalNasiyaAmount, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </Field>
              <Field label={<>Oylik to&apos;lov</>} help={<>O&apos;zgartirsangiz, foiz avtomatik moslashadi</>}>
                <MoneyInput
                  currency={currency.currency}
                  value={
                    monthlyPaymentInput ??
                    (monthlyPayment > 0
                      ? currency.currency === 'USD' && currency.usdUzsRate
                        ? convertUzsToUsd(monthlyPayment, currency.usdUzsRate).toFixed(2)
                        : String(monthlyPayment)
                      : '')
                  }
                  onChange={setMonthlyPaymentInput}
                  placeholder={currency.currency === 'USD' ? '150.00' : '2000000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Boshlanish sanasi" required>
                <DateInput
                  value={startDate}
                  onValueChange={setStartDate}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <div>
                <label htmlFor="nasiya-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  To&apos;lov usuli <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v as PaymentMethod)}>
                  <SelectTrigger id="nasiya-payment-method" aria-required="true" className="h-9 w-full text-sm border-zinc-200 rounded">
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
              <div className="sm:col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="nasiya-early-reminder"
                  checked={earlyReminder}
                  onChange={(e) => setEarlyReminder(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300"
                />
                <label htmlFor="nasiya-early-reminder" className="text-sm text-zinc-700 cursor-pointer">
                  Ertaroq eslatilsinmi?
                </label>
              </div>
              {earlyReminder && (
                <Field label="Necha kun oldin?" required>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={earlyReminderDays}
                    onChange={(e) => setEarlyReminderDays(e.target.value)}
                    placeholder="3"
                    className="h-9 text-sm border-zinc-200 rounded"
                  />
                </Field>
              )}
              <Field label="Izoh" className="sm:col-span-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={"Qo'shimcha ma'lumot..."}
                  className="text-sm border-zinc-200 rounded min-h-[60px]"
                />
              </Field>
            </div>
          </div>

          <NasiyaSchedulePreview rows={schedule} formatAmount={(amount) => fmt(amount, currency)} />

          {submitError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
              {submitError}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(2)}
              className="border-zinc-200 text-zinc-700 rounded"
            >
              Orqaga
            </Button>
            <Button
              type="submit"
              disabled={!step3Valid || submitting}
              className="flex-1 h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
            >
              {submitting ? 'Saqlanmoqda...' : 'Nasiyani saqlash'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
