'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { paymentMethodLabel } from '@/lib/labels'
import { uzDate, uzDateTime } from '@/lib/dates'
import { displayImei, deviceStatusLabel, deviceActionLabel } from '@/lib/device-display'
import { convertUzsToUsd, currencyLabel, formatMoneyByCurrency, formatUserFacingMoney } from '@/lib/currency'
import {
  formatDisplayMoneyFromContract,
  computeSaleContractMargin,
  convertPaymentToContractCurrency,
  salePaymentAmountDisplay,
  isContractCurrencyDust,
  type SalePaymentLike,
} from '@/lib/nasiya-contract'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { getDeviceImageSrc } from '@/lib/device-image'
import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { markFinancialDataChanged } from '@/lib/client-events'

interface Supplier {
  name: string
  phone: string
}

interface SalePaymentRow extends SalePaymentLike {
  id: string
  paidAt: string
  paymentMethod: string | null
  note: string | null
  // Item 12 — split-payment breakdown (e.g. half cash, half card). Null for
  // a normal single-method payment.
  paymentBreakdown?: { method: string; amount: number }[] | null
}

interface Sale {
  id: string
  salePrice: number
  amountPaid: number
  remainingAmount: number
  dueDate: string | null
  reminderEnabled: boolean
  paidFully: boolean
  customer?: { name: string; phone: string }
  paymentMethod: string
  note: string | null
  createdAt: string
  // Native contract-currency ledger — the deal's own frozen currency, source
  // of truth for debt/display. See docs/currency-accounting-model.md.
  contractCurrency: 'UZS' | 'USD'
  contractSalePrice: number
  contractAmountPaid: number
  contractRemainingAmount: number
  // Prisma Decimal? — arrives as a STRING over JSON when non-null (see
  // convertUsdToUzs/convertUzsToUsd in currency.ts, which coerce this
  // safely). Every other `number`-typed field in this interface is a
  // Decimal column too and has the same real runtime shape, but is only
  // ever read through formatContractMoney/formatDisplayMoneyFromContract/
  // computeSaleContractMargin (all Number()-coerced) or plain `-`
  // subtraction (which auto-coerces) — this field is called out explicitly
  // because it was the one actually passed as a RATE argument, which used
  // to hit assertRate()'s strict, non-coercing Number.isFinite() check.
  contractExchangeRateAtCreation: number | string | null
  payments: SalePaymentRow[]
}

interface NasiyaSchedule {
  id: string
  monthNumber: number
  dueDate: string
  expectedAmount: number
  status: string
}

interface Nasiya {
  id: string
  status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
  totalAmount: number
  interestPercent: number
  interestAmount: number
  finalNasiyaAmount: number
  remainingAmount: number
  // Native contract-currency ledger — source of truth for display; the
  // legacy fields above stay for back-compat only. See
  // docs/currency-accounting-model.md and item 15's fix.
  contractCurrency: 'UZS' | 'USD'
  contractTotalAmount: number
  contractInterestAmount: number
  contractFinalAmount: number
  contractRemainingAmount: number
  contractExchangeRateAtCreation: number | string | null
  customer: { name: string; phone: string }
  schedules: NasiyaSchedule[]
}

interface DeviceReturnInfo {
  refundAmount: number
  refundMethod: string | null
  note: string | null
  createdAt: string
}

interface Device {
  id: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  // Native purchase-currency context — see docs/currency-accounting-model.md.
  purchaseCurrency: 'UZS' | 'USD'
  purchaseInputAmount: number
  // Prisma Decimal? — see the identical comment on Sale.contractExchangeRateAtCreation above.
  purchaseExchangeRateAtCreation: number | string | null
  purchaseAmountUzsSnapshot: number
  imei: string
  supplierPhone: string | null
  supplier: Supplier | null
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA' | 'RETURNED' | 'DELETED'
  imageUrls: string[]
  createdAt: string
  sales?: Sale[]
  nasiya?: Nasiya[]
  returns?: DeviceReturnInfo[]
}

interface DeviceLog {
  id: string
  action: string
  note: string | null
  targetId: string
  targetType: string
  createdAt: string
}

function fmt(n: number, currency: ReturnType<typeof useShopCurrency>['currency']) {
  return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
}

export default function QurilmaDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { currency } = useShopCurrency()

  const [device, setDevice] = useState<Device | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<DeviceLog[]>([])

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteNote, setDeleteNote] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [salePaymentOpen, setSalePaymentOpen] = useState(false)
  const [nasiyaPaymentOpen, setNasiyaPaymentOpen] = useState(false)
  const [salePayAmount, setSalePayAmount] = useState('')
  const [salePayMethod, setSalePayMethod] = useState('')
  const [salePayNote, setSalePayNote] = useState('')
  const [salePayError, setSalePayError] = useState('')
  const [salePayLoading, setSalePayLoading] = useState(false)
  // Split payment (e.g. half cash, half card). Mirrors the nasiya payment
  // modal (src/components/shop/nasiya-payment-modal.tsx): `salePayMethod`
  // above doubles as the first part's method; each part has its OWN amount
  // input — the total is always the SUM of the two parts, never a
  // total-minus-second-part subtraction. See docs/product-feature-fixes.md's
  // split-payment amount-entry fix.
  const [saleSplitPayment, setSaleSplitPayment] = useState(false)
  const [saleSplitMethod2, setSaleSplitMethod2] = useState('')
  const [saleSplitAmount1Input, setSaleSplitAmount1Input] = useState('')
  const [saleSplitAmount2Input, setSaleSplitAmount2Input] = useState('')
  // Whether the user has directly typed into the second amount field — see
  // the identical pattern (and full rationale) in
  // src/components/shop/nasiya-payment-modal.tsx.
  const [saleSplitAmount2Touched, setSaleSplitAmount2Touched] = useState(false)
  const [saleEditOpen, setSaleEditOpen] = useState(false)
  const [saleEditCustomerName, setSaleEditCustomerName] = useState('')
  const [saleEditCustomerPhone, setSaleEditCustomerPhone] = useState('')
  const [saleEditPaymentMethod, setSaleEditPaymentMethod] = useState('')
  const [saleEditDueDate, setSaleEditDueDate] = useState('')
  const [saleEditReminderEnabled, setSaleEditReminderEnabled] = useState(false)
  const [saleEditNote, setSaleEditNote] = useState('')
  const [saleEditError, setSaleEditError] = useState('')
  const [saleEditSaving, setSaleEditSaving] = useState(false)
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [returnRefundAmount, setReturnRefundAmount] = useState('')
  const [returnRefundMethod, setReturnRefundMethod] = useState('')
  const [returnError, setReturnError] = useState('')
  const [returning, setReturning] = useState(false)
  const [restockModalOpen, setRestockModalOpen] = useState(false)
  const [restockNote, setRestockNote] = useState('')
  const [restockError, setRestockError] = useState('')
  const [restocking, setRestocking] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    model: '',
    color: '',
    storage: '',
    batteryHealth: '',
    purchasePrice: '',
    imei: '',
    supplierPhone: '',
    note: '',
  })
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const fetchDevice = useCallback(() => {
    if (!id) return
    return fetch(`/api/devices/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setDevice(json.data)
        else setError(json.error || 'Xatolik yuz berdi')
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    fetchDevice()
  }, [fetchDevice])

  // Device lifecycle history (created -> sold -> returned -> restocked ...).
  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetch(`/api/logs?search=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success) return
        const all: DeviceLog[] = json.data?.logs ?? []
        setLogs(all.filter((l) => l.targetId === id && l.targetType === 'Device'))
      })
      .catch(() => {
        if (!cancelled) setLogs([])
      })
    return () => {
      cancelled = true
    }
  }, [id])

  function openEdit() {
    if (!device) return
    setEditForm({
      model: device.model,
      color: device.color ?? '',
      storage: device.storage ?? '',
      batteryHealth: device.batteryHealth != null ? String(device.batteryHealth) : '',
      // Stored value is UZS; show it in the shop's display currency (USD when
      // toggled) so the input matches every other money field.
      purchasePrice:
        currency.currency === 'USD' && currency.usdUzsRate
          ? convertUzsToUsd(device.purchasePrice, currency.usdUzsRate).toFixed(2)
          : String(device.purchasePrice),
      imei: device.imei,
      supplierPhone: device.supplierPhone ?? '',
      note: '',
    })
    setEditError('')
    setEditOpen(true)
  }

  async function handleEditSave() {
    if (!device || editSaving) return
    if (editForm.model.trim().length < 1) {
      setEditError('Model kiritilishi shart')
      return
    }
    if (editForm.imei.trim().length < 1) {
      setEditError('IMEI kiritilishi shart')
      return
    }
    const price = Number(editForm.purchasePrice)
    if (!Number.isFinite(price) || price <= 0) {
      setEditError("Kelish narxi 0 dan katta bo'lishi kerak")
      return
    }
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setEditError("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      return
    }
    const battery = editForm.batteryHealth.trim() === '' ? undefined : Number(editForm.batteryHealth)
    if (battery !== undefined && (!Number.isInteger(battery) || battery < 0 || battery > 100)) {
      setEditError("Batareya 0 va 100 orasida bo'lishi kerak")
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: editForm.model.trim(),
          color: editForm.color.trim(),
          storage: editForm.storage.trim(),
          ...(battery !== undefined ? { batteryHealth: battery } : {}),
          purchasePrice: price,
          inputCurrency: currency.currency,
          imei: editForm.imei.trim(),
          supplierPhone: editForm.supplierPhone.trim(),
          note: editForm.note.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Saqlashda xatolik')
      setEditOpen(false)
      await fetchDevice()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Saqlashda xatolik')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteNote.trim()) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteNote }),
      })
      const json = await res.json()
      if (json.success) {
        router.push('/shop/qurilmalar')
      } else {
        setDeleteError(json.error || "O'chirishda xatolik")
      }
    } catch {
      setDeleteError("O'chirishda xatolik")
    } finally {
      setDeleting(false)
    }
  }

  // The "suggested"/"target" amount for the sale — the sale's own remaining
  // balance, converted into whatever currency the user is typing in. Mirrors
  // the "Qolgan to'lovni qabul qilish" button's own suggestion formula below,
  // so the split card's auto-fill/remaining math never disagrees with it.
  // `null` when there's no sale yet, or a USD contract with no rate to
  // convert with.
  const saleForSuggestion = device?.sales?.[0]
  const saleSuggestedAmountNumber: number | null = saleForSuggestion
    ? saleForSuggestion.contractCurrency !== currency.currency && !currency.usdUzsRate
      ? saleForSuggestion.remainingAmount
      : convertPaymentToContractCurrency(
          saleForSuggestion.contractRemainingAmount,
          saleForSuggestion.contractCurrency,
          currency.currency,
          currency.usdUzsRate,
        )
    : null
  const roundSaleDisplayAmount = (n: number) => (currency.currency === 'USD' ? Math.round(n * 100) / 100 : Math.round(n))
  const formatSaleAmountForInput = (n: number) => (currency.currency === 'USD' ? n.toFixed(2) : String(Math.round(n)))

  // Split payment: each part has its OWN amount; the total is the SUM of
  // the parts — never a total-minus-second-part subtraction.
  const saleSplitTotal = Math.round((Number(saleSplitAmount1Input || 0) + Number(saleSplitAmount2Input || 0)) * 100) / 100
  const saleSplitValid =
    !saleSplitPayment ||
    (Boolean(salePayMethod) &&
      Boolean(saleSplitMethod2) &&
      saleSplitAmount1Input.trim().length > 0 &&
      Number(saleSplitAmount1Input) > 0 &&
      saleSplitAmount2Input.trim().length > 0 &&
      Number(saleSplitAmount2Input) > 0 &&
      saleSplitMethod2 !== salePayMethod)
  // The amount actually being submitted: the split total when split mode is
  // on, otherwise the single "Miqdor" field.
  const saleEffectiveAmount = saleSplitPayment ? saleSplitTotal : Number(salePayAmount || 0)
  const saleHasEffectiveAmount = saleSplitPayment ? saleSplitTotal > 0 : salePayAmount.trim().length > 0

  async function handleSalePayment() {
    if (!latestSale || !saleHasEffectiveAmount || !salePayMethod || salePayNote.trim().length < 5 || salePayLoading || !saleSplitValid)
      return
    setSalePayLoading(true)
    setSalePayError('')
    try {
      const res = await fetch(`/api/sales/${latestSale.id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          amount: saleEffectiveAmount,
          inputCurrency: currency.currency,
          paymentMethod: salePayMethod,
          paymentBreakdown: saleSplitPayment
            ? [
                {
                  method: salePayMethod,
                  amount: Number(saleSplitAmount1Input),
                },
                { method: saleSplitMethod2, amount: Number(saleSplitAmount2Input) },
              ]
            : undefined,
          note: salePayNote.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || "To'lovni saqlashda xatolik")
      }
      markFinancialDataChanged()
      setSalePaymentOpen(false)
      setSalePayAmount('')
      setSalePayMethod('')
      setSalePayNote('')
      setSaleSplitPayment(false)
      setSaleSplitMethod2('')
      setSaleSplitAmount1Input('')
      setSaleSplitAmount2Input('')
      setSaleSplitAmount2Touched(false)
      await fetchDevice()
    } catch (err) {
      setSalePayError(err instanceof Error ? err.message : "To'lovni saqlashda xatolik")
    } finally {
      setSalePayLoading(false)
    }
  }

  function openSaleEdit() {
    if (!latestSale) return
    setSaleEditCustomerName(latestSale.customer?.name ?? '')
    setSaleEditCustomerPhone(latestSale.customer?.phone ?? '')
    setSaleEditPaymentMethod(latestSale.paymentMethod)
    setSaleEditDueDate(latestSale.dueDate ? latestSale.dueDate.slice(0, 10) : '')
    setSaleEditReminderEnabled(latestSale.reminderEnabled)
    setSaleEditNote('')
    setSaleEditError('')
    setSaleEditOpen(true)
  }

  async function handleSaleEdit() {
    if (!latestSale || saleEditSaving) return
    setSaleEditSaving(true)
    setSaleEditError('')
    try {
      const res = await fetch(`/api/sales/${latestSale.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: saleEditCustomerName.trim(),
          customerPhone: saleEditCustomerPhone.trim(),
          paymentMethod: saleEditPaymentMethod,
          dueDate: saleEditDueDate ? new Date(saleEditDueDate).toISOString() : null,
          reminderEnabled: saleEditReminderEnabled,
          note: saleEditNote.trim() || undefined,
          reason: saleEditNote.trim() || "Sotuv ma'lumotlari tuzatildi",
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Sotuvni yangilashda xatolik')
      setSaleEditOpen(false)
      await fetchDevice()
    } catch (err) {
      setSaleEditError(err instanceof Error ? err.message : 'Sotuvni yangilashda xatolik')
    } finally {
      setSaleEditSaving(false)
    }
  }

  async function handleReturnDevice() {
    const refundAmount = Number(returnRefundAmount || 0)
    if (
      returnNote.trim().length < 5 ||
      Number.isNaN(refundAmount) ||
      refundAmount < 0 ||
      (refundAmount > 0 && !returnRefundMethod) ||
      returning
    )
      return
    setReturning(true)
    setReturnError('')
    try {
      const res = await fetch(`/api/devices/${id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: returnNote,
          refundAmount,
          inputCurrency: currency.currency,
          refundMethod: refundAmount > 0 ? returnRefundMethod : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Qaytarishda xatolik')
      router.push('/shop/qurilmalar')
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Qaytarishda xatolik')
    } finally {
      setReturning(false)
    }
  }

  async function handleRestockDevice() {
    if (restockNote.trim().length < 5 || restocking) return
    setRestocking(true)
    setRestockError('')
    try {
      const res = await fetch(`/api/devices/${id}/restock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: restockNote }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Omborga qaytarishda xatolik')
      // Local refetch: status becomes IN_STOCK and the sell / nasiya actions
      // reappear without a full page reload.
      setRestockModalOpen(false)
      setRestockNote('')
      await fetchDevice()
    } catch (err) {
      setRestockError(err instanceof Error ? err.message : 'Omborga qaytarishda xatolik')
    } finally {
      setRestocking(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-zinc-400">Yuklanmoqda...</div>
  }

  if (error || !device) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error || 'Qurilma topilmadi'}</div>
      </div>
    )
  }

  // Purchase price is a historical value, so cross-currency display uses the
  // purchase-time rate when available. User-facing UI still shows only the
  // shop's selected display currency.
  const infoRows: { label: string; value: string; hint?: string | null }[] = [
    { label: 'Model', value: device.model },
    { label: 'Rang', value: device.color ?? '—' },
    { label: 'Xotira', value: device.storage ?? '—' },
    {
      label: 'Batareya',
      value: device.batteryHealth != null ? `${device.batteryHealth}%` : '—',
    },
    {
      label: 'Kelish narxi',
      value: formatDisplayMoneyFromContract(
        device.purchaseInputAmount,
        device.purchaseCurrency,
        currency.currency,
        device.purchaseExchangeRateAtCreation ?? currency.usdUzsRate,
      ),
    },
    { label: 'IMEI', value: displayImei(device.imei) },
    { label: 'Yetkazib beruvchi', value: device.supplier?.name ?? '—' },
    { label: 'Tel raqam', value: device.supplier?.phone ?? '—' },
    { label: "Qo'shilgan sana", value: uzDate(device.createdAt) },
    { label: 'Status', value: deviceStatusLabel(device.status) },
  ]

  const showSaleActions = device.status === 'IN_STOCK'
  const latestSale = device.sales?.[0]
  const saleHasDebt = latestSale ? Number(latestSale.contractRemainingAmount) > 0 && !latestSale.paidFully : false
  const saleProfit = latestSale ? latestSale.salePrice - device.purchasePrice : null
  // Native contract-currency margin — stable, never re-derived from today's
  // rate (see computeSaleContractMargin). When the sale and the device's own
  // purchase were both entered in the same currency, this is a plain native
  // subtraction (no FX conversion at all — avoids double-counting a
  // difference between the purchase-time and sale-time rates). Falls back to
  // the legacy UZS-based saleProfit above when a USD contract has no
  // creation rate on record (should not happen for a real USD sale).
  const saleContractProfit = latestSale
    ? computeSaleContractMargin(latestSale.contractSalePrice, latestSale.contractCurrency, latestSale.contractExchangeRateAtCreation, {
        purchaseCurrency: device.purchaseCurrency,
        purchaseInputAmount: device.purchaseInputAmount,
        purchaseAmountUzsSnapshot: device.purchaseAmountUzsSnapshot,
      })
    : null
  // Money TEXT for this sale must convert from its own contract currency via
  // today's rate — never reconvert the legacy UZS snapshot (frozen at
  // creation rate), which would drift for a USD-native sale as the rate
  // moves. See docs/currency-accounting-model.md.
  const dfmtSale = (amount: number) =>
    latestSale
      ? formatDisplayMoneyFromContract(amount, latestSale.contractCurrency, currency.currency, currency.usdUzsRate)
      : fmt(amount, currency)
  const latestNasiya = device.nasiya?.[0]
  // Money TEXT for this nasiya must convert from its own contract currency
  // via today's rate — never reconvert the legacy UZS snapshot (frozen at
  // creation rate), which would stay stuck showing so'm for a USD-native
  // nasiya. See docs/currency-accounting-model.md and item 15's fix.
  const dfmtNasiya = (amount: number) =>
    latestNasiya
      ? formatDisplayMoneyFromContract(amount, latestNasiya.contractCurrency, currency.currency, currency.usdUzsRate)
      : fmt(amount, currency)
  // Native contract-currency margin — same reasoning as saleContractProfit
  // below: a plain native subtraction when the nasiya and the device's own
  // purchase share a currency (no FX conversion, no double-counting a
  // purchase-time vs. nasiya-time rate difference).
  const nasiyaContractProfit = latestNasiya
    ? computeSaleContractMargin(
        latestNasiya.contractTotalAmount,
        latestNasiya.contractCurrency,
        latestNasiya.contractExchangeRateAtCreation,
        {
          purchaseCurrency: device.purchaseCurrency,
          purchaseInputAmount: device.purchaseInputAmount,
          purchaseAmountUzsSnapshot: device.purchaseAmountUzsSnapshot,
        },
      )
    : null
  const latestReturn = device.returns?.[0]
  const nasiyaPct =
    latestNasiya && latestNasiya.contractFinalAmount > 0
      ? Math.round(((latestNasiya.contractFinalAmount - latestNasiya.contractRemainingAmount) / latestNasiya.contractFinalAmount) * 100)
      : 0

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Back */}
      <Link href="/shop/qurilmalar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Qurilmalarga qaytish
      </Link>

      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">{device.model}</h1>
          <span className="inline-block px-2.5 py-1 bg-zinc-100 text-zinc-700 text-xs font-medium rounded">
            {deviceStatusLabel(device.status)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {device.status === 'IN_STOCK' && (
            <Button
              variant="outline"
              onClick={openEdit}
              className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded"
            >
              <Pencil size={14} />
              Tahrirlash
            </Button>
          )}
          {showSaleActions && (
            <>
              <Link href={`/shop/sotuv/new?deviceId=${device.id}`}>
                <Button className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">Naqd sotish</Button>
              </Link>
              <Link href={`/shop/nasiyalar/new?deviceId=${device.id}`}>
                <Button variant="outline" className="h-9 px-4 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
                  Nasiyaga berish
                </Button>
              </Link>
            </>
          )}
          {device.status === 'RETURNED' && (
            <Button onClick={() => setRestockModalOpen(true)} className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">
              Sotuvga qo&apos;yish
            </Button>
          )}
          {!['SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA'].includes(device.status) && (
            <Button
              variant="outline"
              aria-label="Qurilmani o'chirish"
              onClick={() => setDeleteModalOpen(true)}
              className="h-9 w-9 p-0 border-zinc-200 text-red-500 hover:bg-red-50 hover:border-red-200 rounded"
            >
              <Trash2 size={15} />
            </Button>
          )}
          {['SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA'].includes(device.status) && (
            <Button
              variant="outline"
              onClick={() => setReturnModalOpen(true)}
              className="h-9 px-4 text-sm border-red-200 text-red-600 hover:bg-red-50 rounded"
            >
              Qaytarish
            </Button>
          )}
        </div>
      </div>

      {device.imageUrls.length > 0 && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qurilma rasmlari</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {device.imageUrls.map((imageUrl, index) => (
                <a
                  key={`${imageUrl}-${index}`}
                  href={getDeviceImageSrc(imageUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50 hover:opacity-90"
                >
                  <Image
                    src={getDeviceImageSrc(imageUrl)}
                    alt={`${device.model} rasmi ${index + 1}`}
                    fill
                    sizes="(max-width: 640px) 50vw, 220px"
                    unoptimized
                    className="object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Device info card */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
          <span className="text-sm font-semibold text-zinc-900">Qurilma ma'lumotlari</span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-zinc-100">
          {infoRows.map((row, i) => (
            <div
              key={row.label}
              className={`px-4 py-3 flex flex-col gap-0.5 sm:flex-row sm:gap-4 ${i < infoRows.length - 2 ? 'border-b border-zinc-100' : ''}`}
            >
              <span className="text-xs text-zinc-500 sm:w-32 sm:flex-shrink-0 sm:pt-0.5">{row.label}</span>
              <span className="text-sm text-zinc-900 font-medium">
                {row.value}
                {row.hint && <span className="block text-xs text-zinc-400 font-normal">{row.hint}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Inconsistent-data fallback: device is marked sold but the sale
          relation itself is missing (should not happen, but must never
          crash the page — surface it as a clear, honest warning instead). */}
      {['SOLD_CASH', 'SOLD_DEBT'].includes(device.status) && !latestSale && (
        <div className="border border-amber-200 bg-amber-50 rounded px-4 py-3 text-sm text-amber-800">
          Bu qurilma sotilgan deb belgilangan, lekin savdo yozuvi topilmadi.
        </div>
      )}

      {/* Sale info section */}
      {['SOLD_CASH', 'SOLD_DEBT'].includes(device.status) && latestSale && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Sotuv ma'lumotlari</span>
            <Button
              type="button"
              variant="outline"
              onClick={openSaleEdit}
              className="h-8 rounded border-zinc-200 px-3 text-xs text-zinc-700"
            >
              <Pencil size={13} />
              Tahrirlash
            </Button>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Mijoz</span>
              <span className="text-zinc-900 font-medium">{latestSale.customer?.name ?? '—'}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Tel raqam</span>
              <span className="text-zinc-900 font-medium">{latestSale.customer?.phone ?? '—'}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Sotuv narxi</span>
              <span className="text-zinc-900 font-medium">{dfmtSale(latestSale.contractSalePrice)}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Farq / Foyda</span>
              {saleContractProfit != null ? (
                <span className={saleContractProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
                  {dfmtSale(saleContractProfit)}
                </span>
              ) : (
                // Fallback for the rare case a USD contract has no creation
                // rate on record — conservative legacy UZS figure rather than
                // inventing a native profit (see computeContractCurrencyMargin).
                <span className={saleProfit != null && saleProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
                  {fmt(saleProfit ?? 0, currency)}
                </span>
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">To'langan</span>
              <span className="text-zinc-900 font-medium">{dfmtSale(latestSale.contractAmountPaid)}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Qolgan</span>
              <span className={saleHasDebt ? 'text-red-700 font-medium' : 'text-zinc-900 font-medium'}>
                {dfmtSale(latestSale.contractRemainingAmount)}
              </span>
            </div>
            {latestSale.dueDate && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Muddat</span>
                <span className="text-zinc-900 font-medium">{uzDate(latestSale.dueDate)}</span>
              </div>
            )}
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">To'lov usuli</span>
              <span className="text-zinc-900 font-medium">{paymentMethodLabel(latestSale.paymentMethod)}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Sotilgan sana</span>
              <span className="text-zinc-900 font-medium">{uzDate(latestSale.createdAt)}</span>
            </div>
            {saleHasDebt && (
              <Button
                onClick={() => {
                  // Every open starts from a clean slate — never carries a
                  // stale amount/method/split state over from a previous
                  // open of this same modal.
                  setSalePayMethod('')
                  setSalePayNote('')
                  setSaleSplitPayment(false)
                  setSaleSplitMethod2('')
                  setSaleSplitAmount1Input('')
                  setSaleSplitAmount2Input('')
                  setSaleSplitAmount2Touched(false)
                  // Suggest an amount that, once submitted, actually pays off
                  // the sale exactly — computed from the sale's own
                  // contract-currency balance, not the legacy UZS snapshot.
                  // Falls back to the legacy suggestion if no rate is
                  // available client-side to convert across currencies.
                  if (latestSale.contractCurrency !== currency.currency && !currency.usdUzsRate) {
                    setSalePayAmount(String(latestSale.remainingAmount))
                  } else {
                    const suggestion = convertPaymentToContractCurrency(
                      latestSale.contractRemainingAmount,
                      latestSale.contractCurrency,
                      currency.currency,
                      currency.usdUzsRate,
                    )
                    setSalePayAmount(currency.currency === 'USD' ? suggestion.toFixed(2) : String(Math.round(suggestion)))
                  }
                  setSalePaymentOpen(true)
                }}
                className="mt-2 h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded"
              >
                Qolgan to'lovni qabul qilish
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Sale payment history — this device detail page is the canonical Sale
          detail view (there is no separate /sales/[id] page), so the payment
          history lives here. Mirrors the nasiya detail page's "To'lov tarixi"
          table; uses salePaymentAmountDisplay so historical rows show
          payment-time context, never a live reconversion at today's rate. */}
      {['SOLD_CASH', 'SOLD_DEBT'].includes(device.status) && latestSale && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">To'lov tarixi</div>
          {latestSale.payments?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full text-sm">
                <thead className="border-b border-zinc-200">
                  <tr>
                    {['Sana', 'Miqdor', 'Usul', 'Izoh'].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide bg-zinc-50">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {latestSale.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-4 py-3 text-zinc-700">{uzDateTime(payment.paidAt)}</td>
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {salePaymentAmountDisplay(payment, latestSale.contractCurrency, currency)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {payment.paymentBreakdown?.length ? (
                          <div className="space-y-0.5">
                            {payment.paymentBreakdown.map((p, i) => (
                              <div key={i}>
                                {paymentMethodLabel(p.method)}:{' '}
                                <span className="font-medium text-zinc-900">
                                  {formatUserFacingMoney({
                                    amount: p.amount,
                                    amountCurrency: payment.paymentInputCurrency ?? 'UZS',
                                    displayCurrency: currency.currency,
                                    rate: payment.paymentExchangeRate ?? currency.usdUzsRate,
                                  })}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          paymentMethodLabel(payment.paymentMethod)
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{payment.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-zinc-500">To'lov tarixi hali yo'q</div>
          )}
        </div>
      )}

      {/* Nasiya info section */}
      {device.status === 'SOLD_NASIYA' && latestNasiya && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Nasiya ma'lumotlari</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Mijoz</span>
                <span className="text-zinc-900 font-medium">{latestNasiya.customer.name}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Tel raqam</span>
                <span className="text-zinc-900 font-medium">{formatUzPhoneDisplay(latestNasiya.customer.phone)}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Sotilish narxi</span>
                <span className="text-zinc-900 font-medium">{dfmtNasiya(latestNasiya.contractTotalAmount)}</span>
              </div>
              {latestNasiya.contractInterestAmount > 0 && (
                <div className="flex gap-4 text-sm">
                  <span className="text-zinc-500 w-32">Foiz daromadi</span>
                  <span className="text-zinc-900 font-medium">
                    {latestNasiya.interestPercent}% · {dfmtNasiya(latestNasiya.contractInterestAmount)}
                  </span>
                </div>
              )}
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Sotuv farqi</span>
                <span
                  className={
                    nasiyaContractProfit != null && nasiyaContractProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'
                  }
                >
                  {nasiyaContractProfit != null ? dfmtNasiya(nasiyaContractProfit) : '—'}
                </span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Nasiya jami</span>
                <span className="text-zinc-900 font-medium">{dfmtNasiya(latestNasiya.contractFinalAmount)}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Qolgan summa</span>
                <span className="text-zinc-900 font-medium">{dfmtNasiya(latestNasiya.contractRemainingAmount)}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>To'langan</span>
                <span>{nasiyaPct}%</span>
              </div>
              <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-900 rounded-full" style={{ width: `${nasiyaPct}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {(latestNasiya.status === 'ACTIVE' || latestNasiya.status === 'OVERDUE') && (
                <Button
                  onClick={() => setNasiyaPaymentOpen(true)}
                  className="text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 rounded shadow-sm"
                >
                  To'lov qabul qilish
                </Button>
              )}
              <Link href={`/shop/nasiyalar/${latestNasiya.id}`} prefetch={false}>
                <Button variant="outline" className="text-sm border-zinc-200 text-zinc-700 rounded">
                  Nasiyani ko'rish
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {latestNasiya && (
        <NasiyaPaymentModal
          nasiyaId={latestNasiya.id}
          open={nasiyaPaymentOpen}
          onOpenChange={setNasiyaPaymentOpen}
          onSuccess={() => {
            setNasiyaPaymentOpen(false)
            fetchDevice()
          }}
          customerName={latestNasiya.customer.name}
          deviceName={device.model}
        />
      )}

      {/* Return info section — no profit shown here, the sale was reversed */}
      {['IN_STOCK', 'RETURNED'].includes(device.status) && latestReturn && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qaytarish ma&apos;lumotlari</span>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Holat</span>
              <span className="text-blue-700 font-medium">{device.status === 'IN_STOCK' ? 'Omborga qaytarildi' : 'Qaytarilgan (eski holat)'}</span>
            </div>
            {latestReturn.refundAmount > 0 && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Qaytarilgan summa</span>
                <span className="text-zinc-900 font-medium">{fmt(latestReturn.refundAmount, currency)}</span>
              </div>
            )}
            {latestReturn.refundMethod && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">To&apos;lov usuli</span>
                <span className="text-zinc-900 font-medium">{paymentMethodLabel(latestReturn.refundMethod)}</span>
              </div>
            )}
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Sana</span>
              <span className="text-zinc-900 font-medium">{uzDate(latestReturn.createdAt)}</span>
            </div>
            {latestReturn.note && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Izoh</span>
                <span className="text-zinc-900 font-medium">{latestReturn.note}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action / lifecycle logs */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">Amallar tarixi</div>
        {logs.length ? (
          <ul className="divide-y divide-zinc-100">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-900">{deviceActionLabel(l.action)}</div>
                  {l.note && <div className="text-xs text-zinc-500 mt-0.5">{l.note}</div>}
                </div>
                <div className="text-xs text-zinc-400 whitespace-nowrap flex-shrink-0">{uzDateTime(l.createdAt)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-6 text-sm text-zinc-500">Amallar tarixi yo&apos;q</div>
        )}
      </div>

      {/* Edit dialog is available only while the device is sellable or awaiting legacy restock. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
          <DialogHeader className="border-b border-zinc-100 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-zinc-900">Qurilmani tahrirlash</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
            {editError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</div>}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Model <span className="text-red-500">*</span>
              </label>
              <Input
                value={editForm.model}
                onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                className="h-10 rounded-lg border-zinc-200 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">Rang</label>
                <Input
                  value={editForm.color}
                  onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-10 rounded-lg border-zinc-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">Xotira</label>
                <Input
                  value={editForm.storage}
                  onChange={(e) => setEditForm((f) => ({ ...f, storage: e.target.value }))}
                  className="h-10 rounded-lg border-zinc-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">Batareya (%)</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={editForm.batteryHealth}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      batteryHealth: e.target.value,
                    }))
                  }
                  className="h-10 rounded-lg border-zinc-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">
                  Kelish narxi ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                </label>
                <MoneyInput
                  currency={currency.currency}
                  value={editForm.purchasePrice}
                  onChange={(v) => setEditForm((f) => ({ ...f, purchasePrice: v }))}
                  className="h-10 rounded-lg border-zinc-200 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                IMEI <span className="text-red-500">*</span>
              </label>
              <Input
                value={editForm.imei}
                onChange={(e) => setEditForm((f) => ({ ...f, imei: e.target.value }))}
                className="h-10 rounded-lg border-zinc-200 text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">Yetkazib beruvchi tel</label>
              <PhoneInput
                value={editForm.supplierPhone}
                onChange={(supplierPhone) => setEditForm((f) => ({ ...f, supplierPhone }))}
                className="h-10 rounded-lg border-zinc-200 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">Izoh</label>
              <Textarea
                value={editForm.note}
                onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Ixtiyoriy izoh"
                className="min-h-[70px] rounded-lg border-zinc-200 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 border-t border-zinc-100 px-5 py-4">
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-lg border-zinc-200 text-zinc-700">
              Bekor qilish
            </Button>
            <Button
              disabled={editSaving}
              onClick={handleEditSave}
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {editSaving ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Qurilmani o'chirish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-600">
              <span className="font-medium">{device.model}</span> qurilmasini o'chirishdan oldin sababini kiriting.
            </p>
            {deleteError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{deleteError}</div>}
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                Sabab <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                placeholder="Masalan: Qurilma buzilgan, yo'qolgan..."
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteModalOpen(false)
                setDeleteNote('')
                setDeleteError('')
              }}
              className="border-zinc-200 text-zinc-700 rounded"
            >
              Bekor qilish
            </Button>
            <Button
              disabled={!deleteNote.trim() || deleting}
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-40"
            >
              {deleting ? "O'chirilmoqda..." : "O'chirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saleEditOpen} onOpenChange={setSaleEditOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Sotuv ma'lumotlarini tahrirlash</DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              Pul summalarini o'zgartirish uchun tuzatish amali kerak bo'ladi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {saleEditError && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{saleEditError}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700">Mijoz</label>
                <Input
                  value={saleEditCustomerName}
                  onChange={(e) => setSaleEditCustomerName(e.target.value)}
                  className="h-9 rounded border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700">Telefon</label>
                <PhoneInput
                  value={saleEditCustomerPhone}
                  onChange={setSaleEditCustomerPhone}
                  className="h-9 rounded border-zinc-200 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700">To'lov usuli</label>
                <select
                  value={saleEditPaymentMethod}
                  onChange={(e) => setSaleEditPaymentMethod(e.target.value)}
                  className="h-9 w-full rounded border border-zinc-200 bg-white px-2 text-sm"
                >
                  <option value="CASH">Naqd</option>
                  <option value="CARD">Karta</option>
                  <option value="TRANSFER">Bank</option>
                  <option value="OTHER">Boshqa</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700">Qarz muddati</label>
                <Input
                  type="date"
                  value={saleEditDueDate}
                  onChange={(e) => setSaleEditDueDate(e.target.value)}
                  className="h-9 rounded border-zinc-200 text-sm"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={saleEditReminderEnabled}
                onChange={(e) => setSaleEditReminderEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Eslatma yoqilgan
            </label>
            <Textarea
              value={saleEditNote}
              onChange={(e) => setSaleEditNote(e.target.value)}
              placeholder="Tahrirlash sababi yoki izoh..."
              className="min-h-[80px] rounded border-zinc-200 text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSaleEditOpen(false)} className="rounded border-zinc-200 text-zinc-700">
              Bekor qilish
            </Button>
            <Button disabled={saleEditSaving} onClick={handleSaleEdit} className="rounded bg-zinc-900 text-white hover:bg-zinc-800">
              {saleEditSaving ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={salePaymentOpen} onOpenChange={setSalePaymentOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Qolgan to'lovni qabul qilish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {salePayError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{salePayError}</div>}

            <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
              <input
                type="checkbox"
                checked={saleSplitPayment}
                onChange={(e) => {
                  // Toggling split mode (either direction) always starts from
                  // a clean slate — never carries a stale amount over.
                  setSaleSplitPayment(e.target.checked)
                  setSaleSplitMethod2('')
                  setSaleSplitAmount1Input('')
                  setSaleSplitAmount2Input('')
                  setSaleSplitAmount2Touched(false)
                }}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Aralash to&apos;lov (masalan: yarmi naqd, yarmi karta)
            </label>

            {!saleSplitPayment ? (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-700 block mb-1.5">Miqdor ({currencyLabel(currency.currency)})</label>
                  <MoneyInput
                    currency={currency.currency}
                    value={salePayAmount}
                    onChange={setSalePayAmount}
                    className="h-9 text-sm border-zinc-200 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-700 block mb-1.5">To'lov usuli</label>
                  <select
                    value={salePayMethod}
                    onChange={(e) => setSalePayMethod(e.target.value)}
                    className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
                  >
                    <option value="">Tanlang...</option>
                    <option value="CASH">Naqd</option>
                    <option value="CARD">Karta</option>
                    <option value="TRANSFER">Bank</option>
                    <option value="OTHER">Boshqa</option>
                  </select>
                </div>
              </>
            ) : (
              // Split payment: each method has its OWN "To'lov usuli N" block
              // with its own method select + amount input — never a single
              // total field re-purposed as "first part". The total below is
              // ALWAYS the sum of the two parts and is never itself editable.
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">To&apos;lov usuli 1</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={salePayMethod}
                      onChange={(e) => setSalePayMethod(e.target.value)}
                      className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
                    >
                      <option value="">Tanlang...</option>
                      <option value="CASH">Naqd</option>
                      <option value="CARD">Karta</option>
                      <option value="TRANSFER">Bank</option>
                      <option value="OTHER">Boshqa</option>
                    </select>
                    <MoneyInput
                      currency={currency.currency}
                      value={saleSplitAmount1Input}
                      onChange={(v) => {
                        setSaleSplitAmount1Input(v)
                        // Auto-fill the second amount from the remaining
                        // suggested amount — but only while the user hasn't
                        // directly edited it themselves.
                        if (!saleSplitAmount2Touched && saleSuggestedAmountNumber != null) {
                          const remaining = Math.max(0, roundSaleDisplayAmount(saleSuggestedAmountNumber) - Number(v || 0))
                          setSaleSplitAmount2Input(remaining > 0 ? formatSaleAmountForInput(remaining) : '')
                        }
                      }}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-zinc-700">To&apos;lov usuli 2</label>
                    {saleSuggestedAmountNumber != null && (
                      <button
                        type="button"
                        onClick={() => {
                          const remaining = Math.max(
                            0,
                            roundSaleDisplayAmount(saleSuggestedAmountNumber) - Number(saleSplitAmount1Input || 0),
                          )
                          setSaleSplitAmount2Input(remaining > 0 ? formatSaleAmountForInput(remaining) : '')
                          setSaleSplitAmount2Touched(false)
                        }}
                        className="text-xs font-medium text-zinc-600 underline hover:text-zinc-900"
                      >
                        Qolganini qo&apos;yish
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={saleSplitMethod2}
                      onChange={(e) => setSaleSplitMethod2(e.target.value)}
                      className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
                    >
                      <option value="">Tanlang...</option>
                      <option value="CASH">Naqd</option>
                      <option value="CARD">Karta</option>
                      <option value="TRANSFER">Bank</option>
                      <option value="OTHER">Boshqa</option>
                    </select>
                    <MoneyInput
                      currency={currency.currency}
                      value={saleSplitAmount2Input}
                      onChange={(v) => {
                        setSaleSplitAmount2Touched(true)
                        setSaleSplitAmount2Input(v)
                      }}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                </div>
                {saleSplitMethod2 && salePayMethod && saleSplitMethod2 === salePayMethod && (
                  <p className="text-xs text-red-600">Ikkala usul bir xil bo&apos;lmasligi kerak.</p>
                )}
                <div className="flex items-center justify-between border-t border-zinc-200 pt-2.5 text-sm">
                  <span className="font-medium text-zinc-700">Jami to&apos;lov</span>
                  <span className="font-semibold text-zinc-900">
                    {currencyLabel(currency.currency)} {saleSplitTotal.toLocaleString('ru-RU')}
                  </span>
                </div>
                {saleSuggestedAmountNumber != null &&
                  !isContractCurrencyDust(saleSplitTotal - roundSaleDisplayAmount(saleSuggestedAmountNumber), currency.currency) &&
                  (saleSplitTotal < roundSaleDisplayAmount(saleSuggestedAmountNumber) ? (
                    <p className="text-xs text-zinc-600">
                      Qolgan: {currencyLabel(currency.currency)}{' '}
                      {(roundSaleDisplayAmount(saleSuggestedAmountNumber) - saleSplitTotal).toLocaleString('ru-RU')}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                      Ortiqcha: {currencyLabel(currency.currency)}{' '}
                      {(saleSplitTotal - roundSaleDisplayAmount(saleSuggestedAmountNumber)).toLocaleString('ru-RU')}
                    </p>
                  ))}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                Izoh <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={salePayNote}
                onChange={(e) => setSalePayNote(e.target.value)}
                placeholder="Masalan: mijoz qolgan qarzni to'ladi"
                className="text-sm border-zinc-200 rounded min-h-[70px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSalePaymentOpen(false)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <Button
              disabled={!saleHasEffectiveAmount || !salePayMethod || salePayNote.trim().length < 5 || salePayLoading || !saleSplitValid}
              onClick={handleSalePayment}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              {salePayLoading ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnModalOpen} onOpenChange={setReturnModalOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Qurilmani qaytarish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-600">
              Bu amal bog'langan sotuv yoki nasiyani bekor qiladi va qurilmani omborga qaytaradi.
            </p>
            {returnError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{returnError}</div>}
            <div>
              <label htmlFor="return-note" className="text-xs font-medium text-zinc-700 block mb-1.5">
                Sabab
              </label>
              <Textarea
                id="return-note"
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </div>
            <div>
              <label htmlFor="return-refund-amount" className="text-xs font-medium text-zinc-700 block mb-1.5">
                Qaytarilgan summa ({currencyLabel(currency.currency)})
              </label>
              <MoneyInput
                id="return-refund-amount"
                currency={currency.currency}
                value={returnRefundAmount}
                onChange={setReturnRefundAmount}
                placeholder="0"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label htmlFor="return-refund-method" className="text-xs font-medium text-zinc-700 block mb-1.5">
                Qaytarish usuli {Number(returnRefundAmount || 0) > 0 && <span className="text-red-500">*</span>}
              </label>
              <select
                id="return-refund-method"
                value={returnRefundMethod}
                onChange={(e) => setReturnRefundMethod(e.target.value)}
                disabled={Number(returnRefundAmount || 0) <= 0}
                className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                <option value="">Tanlang...</option>
                <option value="CASH">Naqd</option>
                <option value="CARD">Karta</option>
                <option value="TRANSFER">Bank o'tkazmasi</option>
                <option value="OTHER">Boshqa</option>
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReturnModalOpen(false)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <Button
              disabled={
                returnNote.trim().length < 5 ||
                Number(returnRefundAmount || 0) < 0 ||
                (Number(returnRefundAmount || 0) > 0 && !returnRefundMethod) ||
                returning
              }
              onClick={handleReturnDevice}
              className="bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-40"
            >
              {returning ? 'Saqlanmoqda...' : 'Qaytarishni tasdiqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restockModalOpen} onOpenChange={setRestockModalOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Sotuvga qo&apos;yish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-600">
              Bu amal qaytarilgan qurilmani omborga qaytaradi va uni yana sotuvga tayyor holatga o&apos;tkazadi.
            </p>
            {restockError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{restockError}</div>}
            <div>
              <label htmlFor="restock-note" className="text-xs font-medium text-zinc-700 block mb-1.5">
                Sabab <span className="text-red-500">*</span>
              </label>
              <Textarea
                id="restock-note"
                value={restockNote}
                onChange={(e) => setRestockNote(e.target.value)}
                placeholder="Masalan: qurilma tekshirildi, soz holatda, qayta sotuvga qo'yildi"
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRestockModalOpen(false)
                setRestockNote('')
                setRestockError('')
              }}
              className="border-zinc-200 text-zinc-700 rounded"
            >
              Bekor qilish
            </Button>
            <Button
              disabled={restockNote.trim().length < 5 || restocking}
              onClick={handleRestockDevice}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              {restocking ? 'Saqlanmoqda...' : "Sotuvga qo'yish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
