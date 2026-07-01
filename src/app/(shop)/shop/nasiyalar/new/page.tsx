'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

function fmt(n: number) {
  return Math.round(n).toLocaleString('ru-RU')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function deviceMeta(device: Device) {
  return [
    device.color,
    device.storage,
    device.batteryHealth != null ? `${device.batteryHealth}%` : null,
    `IMEI: ${device.imei}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export default function NewNasiyaPage() {
  const router = useRouter()
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
  const [totalPrice, setTotalPrice] = useState('')
  const [downPayment, setDownPayment] = useState('')
  const [months, setMonths] = useState('12')
  const [startDate, setStartDate] = useState(today)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [appleId, setAppleId] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleSelectDevice = useCallback((d: Device) => {
    setSelectedDevice(d)
    setTotalPrice(String(d.purchasePrice))
    setStep(2)
  }, [])

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

        const deviceId = new URLSearchParams(window.location.search).get('deviceId')
        if (deviceId) {
          const device = nextDevices.find((d) => d.id === deviceId)
          if (device) {
            handleSelectDevice(device)
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
  }, [handleSelectDevice])

  const filteredDevices = devices.filter((d) => {
    const q = searchQuery.toLowerCase()
    return !q || d.model.toLowerCase().includes(q) || (d.color ?? '').toLowerCase().includes(q) || d.imei.includes(q)
  })

  const remaining = useMemo(() => {
    const t = parseFloat(totalPrice) || 0
    const d = parseFloat(downPayment) || 0
    return Math.max(0, t - d)
  }, [totalPrice, downPayment])

  const monthlyPayment = useMemo(() => {
    const m = parseInt(months) || 1
    return m > 0 ? remaining / m : 0
  }, [remaining, months])

  const schedule = useMemo(() => {
    if (!startDate || !months) return []
    const m = parseInt(months) || 12
    return Array.from({ length: m }, (_, i) => ({
      month: i + 1,
      date: addMonths(startDate, i + 1),
      amount: monthlyPayment,
    }))
  }, [startDate, months, monthlyPayment])

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
          months: Number(months),
          monthlyPayment: Math.round(monthlyPayment),
          startDate,
          paymentMethod: payMethod,
          appleIdNote: appleId ? 'Apple ID eslatmasi yuborish' : undefined,
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
              filteredDevices.map((d, i) => (
                <button
                  key={d.id}
                  onClick={() => handleSelectDevice(d)}
                  className={`w-full text-left px-4 py-3 hover:bg-zinc-50 transition-colors ${
                    i < filteredDevices.length - 1 ? 'border-b border-zinc-100' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm text-zinc-900">{d.model}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{deviceMeta(d)}</div>
                    </div>
                    <div className="text-sm font-bold text-zinc-900">{fmt(d.purchasePrice)} so&apos;m</div>
                  </div>
                </button>
              ))
            )}
          </div>
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
                onClick={() => { setSelectedDevice(null); setStep(1) }}
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
                  Jami narx <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(e.target.value)}
                  placeholder="9500000"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Boshlang&apos;ich to&apos;lov <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  value={downPayment}
                  onChange={(e) => setDownPayment(e.target.value)}
                  placeholder="2000000"
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Qolgan summa
                </label>
                <Input
                  readOnly
                  value={remaining > 0 ? fmt(remaining) : '0'}
                  className="h-9 text-sm border-zinc-200 rounded bg-zinc-50 text-zinc-500"
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
                  Oylik to&apos;lov
                </label>
                <Input
                  readOnly
                  value={monthlyPayment > 0 ? fmt(monthlyPayment) : '0'}
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
              <div className="flex items-center gap-2 col-span-2">
                <input
                  type="checkbox"
                  id="apple-id"
                  checked={appleId}
                  onChange={(e) => setAppleId(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300"
                />
                <label htmlFor="apple-id" className="text-sm text-zinc-700 cursor-pointer">
                  Apple ID eslatmasi yuborish
                </label>
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
                        <td className="px-4 py-2 font-medium text-zinc-900">{fmt(row.amount)} so&apos;m</td>
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
