'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { convertUzsToUsd, currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { displayImei, deviceMatchesSearch } from '@/lib/device-display'
import { isValidPhone, PHONE_ERROR } from '@/lib/phone'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { ArrowLeft, Check } from 'lucide-react'

interface Device {
  id: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  imei: string
}

type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'

function fmt(n: number, currency: ReturnType<typeof useShopCurrency>['currency']) {
  return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
}

function deviceMeta(device: Device) {
  return [
    device.color,
    device.storage,
    device.batteryHealth != null ? `${device.batteryHealth}%` : null,
    `IMEI: ${displayImei(device.imei)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export default function NewSotuvPage() {
  const router = useRouter()
  const { currency } = useShopCurrency()
  const [step, setStep] = useState<1 | 2>(1)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)

  // Step 2 form
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
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

  // The device's price in the shop's display currency (UZS base → USD when set).
  function priceFor(d: Device) {
    return currency.currency === 'USD' && currency.usdUzsRate
      ? convertUzsToUsd(d.purchasePrice, currency.usdUzsRate).toFixed(2)
      : String(d.purchasePrice)
  }

  // Displayed sale price: the user's edit if any, otherwise a live suggestion
  // derived from the selected device + current currency. Because it's derived,
  // it can never get stuck showing raw UZS after the currency resolves.
  const salePrice = salePriceInput ?? (selectedDevice ? priceFor(selectedDevice) : '')

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

  // Load sellable stock once on mount. Must NOT depend on currency-bound values,
  // otherwise the list reloads (and drops the user's selection) when the shop
  // currency resolves.
  useEffect(() => {
    let ignore = false

    async function loadDevices() {
      setLoading(true)
      setLoadError('')

      try {
        const res = await fetch('/api/devices?status=IN_STOCK')
        const json = await res.json()
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Qurilmalarni yuklashda xatolik")
        }

        if (ignore) return

        const nextDevices = json.data as Device[]
        setDevices(nextDevices)

        // Deep-link from a device page (?deviceId=…): the device is already
        // chosen, so select it and jump straight to the sale form.
        const deviceId = new URLSearchParams(window.location.search).get('deviceId')
        if (deviceId) {
          const device = nextDevices.find((d) => d.id === deviceId)
          if (device) {
            setSelectedDevice(device)
            setStep(2)
          } else {
            setLoadError('Tanlangan qurilma omborda topilmadi')
          }
        }
      } catch (err) {
        if (!ignore) {
          setLoadError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadDevices()
    return () => {
      ignore = true
    }
  }, [])

  const filteredDevices = devices.filter((d) => deviceMatchesSearch(d, searchQuery))

  const canSubmit =
    !!selectedDevice &&
    customerName.trim() &&
    customerPhone.trim() &&
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
    if (!isValidPhone(customerPhone)) {
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
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
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
      router.push(`/shop/qurilmalar/${selectedDevice.id}`)
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
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Qurilmani qidiring (model, IMEI, rang)..."
            className="h-9 text-sm border-zinc-200 rounded"
            autoFocus
          />
          {loadError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
              {loadError}
            </div>
          )}
          <div className="border border-zinc-200 rounded overflow-hidden">
            {loading ? (
              <div className="px-4 py-6 text-center text-zinc-400 text-sm">Yuklanmoqda...</div>
            ) : filteredDevices.length === 0 ? (
              <div className="px-4 py-6 text-center text-zinc-400 text-sm">Qurilma topilmadi</div>
            ) : (
              filteredDevices.map((d, i) => {
                const isSelected = selectedDevice?.id === d.id
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => selectDevice(d)}
                    aria-pressed={isSelected}
                    className={`w-full text-left px-4 py-3 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-inset ${
                      isSelected ? 'bg-zinc-900/[0.03] ring-2 ring-inset ring-zinc-900' : 'hover:bg-zinc-50'
                    } ${i < filteredDevices.length - 1 ? 'border-b border-zinc-100' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                            isSelected ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'
                          }`}
                        >
                          {isSelected && <Check size={12} />}
                        </span>
                        <div>
                          <div className="font-medium text-sm text-zinc-900">{d.model}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">{deviceMeta(d)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Tanlandi
                          </span>
                        )}
                        <div className="text-sm font-bold text-zinc-900">{fmt(d.purchasePrice, currency)}</div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
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
                <span className="text-sm font-bold text-zinc-900">{fmt(selectedDevice.purchasePrice, currency)}</span>
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
            <div className="p-4 grid grid-cols-2 gap-4">
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
                  Mijoz tel <span className="text-red-500">*</span>
                </label>
                <Input
                  ref={phoneRef}
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value)
                    if (phoneError) setPhoneError('')
                  }}
                  placeholder="+998 90 000 00 00"
                  aria-invalid={!!phoneError}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
                {phoneError && <p className="mt-1 text-xs text-red-600">{phoneError}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Sotuv narxi ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  currency={currency.currency}
                  value={salePrice}
                  onChange={setSalePriceInput}
                  placeholder={currency.currency === 'USD' ? '700.00' : '9500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  To&apos;lov usuli <span className="text-red-500">*</span>
                </label>
                <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v as PaymentMethod)}>
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
            </div>
          </div>

          {/* Fully paid */}
          <div className="border border-zinc-200 rounded p-4">
            <div className="text-xs font-medium text-zinc-700 mb-2.5">
              To&apos;liq to&apos;ladimi? <span className="text-red-500">*</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFullyPaid(true)}
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
              <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-zinc-100">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                    Qancha to&apos;ladi ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                  </label>
                  <MoneyInput
                    currency={currency.currency}
                    value={partialAmount}
                    onChange={setPartialAmount}
                    placeholder={currency.currency === 'USD' ? '400.00' : '5000000'}
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
                <div className="col-span-2 flex items-center gap-2">
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
                  <div className="col-span-2 flex items-center gap-2">
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
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      Necha kun oldin? <span className="text-red-500">*</span>
                    </label>
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
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
            <Textarea
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
