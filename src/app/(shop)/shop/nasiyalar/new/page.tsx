'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
import { ArrowLeft, Check } from 'lucide-react'
import { convertUsdToUzs, convertUzsToUsd, currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { displayImei, deviceMatchesSearch } from '@/lib/device-display'
import { calculateNasiyaAmounts, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { useShopCurrency } from '@/lib/use-shop-currency'

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

function fmt(n: number, currency?: ReturnType<typeof useShopCurrency>['currency']) {
  if (currency) return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
  return Math.round(n).toLocaleString('ru-RU')
}

function today() {
  return new Date().toISOString().slice(0, 10)
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

export default function NewNasiyaPage() {
  const router = useRouter()
  const { currency } = useShopCurrency()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)

  // Step 2
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [passportFile, setPassportFile] = useState<File | null>(null)

  // Step 3
  // null = untouched (show the device's price as a live currency-aware
  // suggestion); a string = the value the user typed.
  const [totalPriceInput, setTotalPriceInput] = useState<string | null>(null)
  const [downPayment, setDownPayment] = useState('')
  const [months, setMonths] = useState('12')
  const [interestPercent, setInterestPercent] = useState('0')
  const [startDate, setStartDate] = useState(today)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // The device's price in the shop's display currency (UZS base → USD when set).
  function priceFor(d: Device) {
    return currency.currency === 'USD' && currency.usdUzsRate
      ? convertUzsToUsd(d.purchasePrice, currency.usdUzsRate).toFixed(2)
      : String(d.purchasePrice)
  }

  // Displayed total price: the user's edit if any, otherwise a live suggestion
  // derived from the selected device + current currency, so it can never get
  // stuck showing raw UZS after the currency resolves.
  const totalPrice = totalPriceInput ?? (selectedDevice ? priceFor(selectedDevice) : '')

  // Select a device (does NOT auto-advance) — the user confirms with "Keyingi
  // bosqich". Kept as a plain function so it is never a hook dependency.
  function selectDevice(d: Device) {
    setSelectedDevice(d)
    setTotalPriceInput(null)
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
        // chosen, so select it and jump straight to the customer step.
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

  const totalPriceUzs = currency.currency === 'USD' && currency.usdUzsRate
    ? convertUsdToUzs(Number(totalPrice) || 0, currency.usdUzsRate)
    : Number(totalPrice) || 0
  const downPaymentUzs = currency.currency === 'USD' && currency.usdUzsRate
    ? convertUsdToUzs(Number(downPayment) || 0, currency.usdUzsRate)
    : Number(downPayment) || 0

  const calculation = useMemo(() => {
    try {
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
  }, [totalPriceUzs, downPaymentUzs, months, interestPercent])

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

  const step2Valid = customerName.trim() && customerPhone.trim() && passportFile
  const step3Valid =
    !!selectedDevice &&
    totalPrice.trim() &&
    downPayment.trim() &&
    months &&
    startDate.trim() &&
    payMethod

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!step3Valid || !selectedDevice || !passportFile || submitting) return
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setSubmitError('USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko\'ring.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const formData = new FormData()
      formData.append('file', passportFile)

      const uploadRes = await fetch('/api/uploads/passport', {
        method: 'POST',
        body: formData,
      })
      const uploadJson = await uploadRes.json()

      if (!uploadRes.ok || !uploadJson.success) {
        throw new Error(uploadJson.error || 'Pasport rasmini yuklashda xatolik')
      }

      const passportPhotoUrl = uploadJson.data.key

      const res = await fetch(`/api/devices/${selectedDevice.id}/nasiya`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          passportPhotoUrl,
          totalAmount: Number(totalPrice),
          downPayment: Number(downPayment),
          inputCurrency: currency.currency,
          months: Number(months),
          interestPercent: Number(interestPercent || 0),
          monthlyPayment: Math.round(monthlyPayment),
          startDate,
          paymentMethod: payMethod,
          note: note.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Nasiyani saqlashda xatolik')
      }
      router.push(`/shop/qurilmalar/${selectedDevice.id}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Nasiyani saqlashda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  const stepLabels = ['Qurilma tanlash', 'Mijoz ma\'lumotlari', 'Nasiya shartlari']

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <Link href="/shop/yangi-operatsiya" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Orqaga
      </Link>

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
          return (
            <div key={n} className="flex items-center gap-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  done ? 'bg-zinc-900 text-white' : active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'
                }`}
              >
                {done ? <Check size={12} /> : n}
              </div>
              <span className={`text-sm ${active ? 'font-medium text-zinc-900' : done ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {label}
              </span>
              {n < 3 && <div className="w-6 h-px bg-zinc-200 mx-1" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Device search */}
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
                <Input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+998 90 000 00 00"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Pasport rasmi <span className="text-red-500">*</span>
                </label>
                <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-zinc-200 rounded cursor-pointer hover:border-zinc-400 hover:bg-zinc-50 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => setPassportFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="text-center">
                    {passportFile ? (
                      <div className="text-sm text-zinc-700 font-medium">{passportFile.name}</div>
                    ) : (
                      <>
                        <div className="text-sm text-zinc-500">Rasm yuklash uchun bosing</div>
                        <div className="text-xs text-zinc-400 mt-0.5">PNG, JPG, WEBP</div>
                      </>
                    )}
                  </div>
                </label>
              </div>
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
              disabled={!step2Valid}
              onClick={() => setStep(3)}
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
            <div className="p-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Jami narx ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  currency={currency.currency}
                  value={totalPrice}
                  onChange={setTotalPriceInput}
                  placeholder={currency.currency === 'USD' ? '700.00' : '9500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Boshlang&apos;ich to&apos;lov ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  currency={currency.currency}
                  value={downPayment}
                  onChange={setDownPayment}
                  placeholder={currency.currency === 'USD' ? '150.00' : '2000000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Qolgan summa
                </label>
                <Input
                  readOnly
                  value={remaining > 0 ? fmt(remaining, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Nasiya foizi (%) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min={0}
                  max={300}
                  step={1}
                  value={interestPercent}
                  onChange={(e) => setInterestPercent(e.target.value)}
                  placeholder="0"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Oylar <span className="text-red-500">*</span>
                </label>
                <Select value={months} onValueChange={(v) => v && setMonths(v)}>
                  <SelectTrigger className="h-9 text-sm border-zinc-200 rounded">
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
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Foiz summasi
                </label>
                <Input
                  readOnly
                  value={interestAmount > 0 ? fmt(interestAmount, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Nasiya jami
                </label>
                <Input
                  readOnly
                  value={finalNasiyaAmount > 0 ? fmt(finalNasiyaAmount, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Oylik to&apos;lov
                </label>
                <Input
                  readOnly
                  value={monthlyPayment > 0 ? fmt(monthlyPayment, currency) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Boshlanish sanasi <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
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
              <div className="col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={"Qo'shimcha ma'lumot..."}
                  className="text-sm border-zinc-200 rounded min-h-[60px]"
                />
              </div>
            </div>
          </div>

          {/* Payment schedule preview */}
          {schedule.length > 0 && (
            <div className="border border-zinc-200 rounded overflow-hidden">
              <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-900">To&apos;lov jadvali</span>
                <span className="text-xs text-zinc-500">{schedule.length} oy</span>
              </div>
              <div className="max-h-52 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-50 border-b border-zinc-200">
                    <tr>
                      {['#', 'Sana', 'Miqdor'].map((h) => (
                        <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-zinc-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((row) => (
                      <tr key={row.month} className="border-b border-zinc-100 last:border-0">
                        <td className="px-4 py-2 text-zinc-400">{row.month}</td>
                        <td className="px-4 py-2 text-zinc-700">{row.date}</td>
                        <td className="px-4 py-2 font-medium text-zinc-900">{fmt(row.amount, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
