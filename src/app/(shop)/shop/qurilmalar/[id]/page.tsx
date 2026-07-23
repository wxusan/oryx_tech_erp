'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { AsyncButton } from '@/components/ui/async-button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { MoneyInput } from '@/components/ui/money-input'
import { StorageInput } from '@/components/ui/storage-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { paymentMethodLabel } from '@/lib/labels'
import { uzDate, uzDateTime } from '@/lib/dates'
import { displayImei, deviceStatusLabel } from '@/lib/device-display'
import { convertUzsToUsd, currencyLabel, formatMoneyByCurrency, formatMoneyDto, formatUserFacingMoney, type MoneyDto } from '@/lib/currency'
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
import { commitNavigationMutation, navigateAfterMutation } from '@/lib/client-events'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import { deviceConditionLabel, formatDeviceStorage } from '@/lib/device-specs'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { patchDeviceUpsert } from '@/lib/device-query-cache'
import type { DeviceListItem } from '@/lib/device-list-contract'
import { DeviceConditionBadge } from '@/components/shop/device-condition-badge'
import { DeviceActionHistory, type DeviceActionLog as DeviceLog } from '@/components/shop/device-action-history'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { ImageViewer, useImageViewer } from '@/components/ui/image-viewer'
import { ImageViewerTrigger } from '@/components/ui/image-viewer-trigger'
import { SupplierPayablePaymentDialog } from '@/components/shop/supplier-payable-payment-dialog'

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
  resolutionState: 'ACTIVE' | 'ARCHIVED' | 'WRITTEN_OFF'
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
  refundInputAmount: number | string | null
  refundInputCurrency: 'UZS' | 'USD' | null
  refundExchangeRateAtCreation: number | string | null
  refundMethod: string | null
  contractCurrency: 'UZS' | 'USD'
  contractReceiptsAtReturn: number
  contractRefundAmount: number
  contractRetainedAmount: number
  contractCancelledDebt: number
  revenueReversalAmountUzs: number
  inventoryCostRecoveryUzs: number
  note: string | null
  createdAt: string
}

interface SupplierPayableInfo {
  id: string
  origin: 'OLIB_SOTDIM' | 'DEVICE_PURCHASE'
  supplier: { name: string; phone: string }
  originalAmount: MoneyDto
  paidAmount: MoneyDto
  remainingAmount: MoneyDto
  dueDate: string
  status: 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'PAID' | 'CANCELLED'
  lastPaymentAt: string | null
  reminderEnabled: boolean
  createdAt: string
  payments: Array<{ id: string; amount: MoneyDto; method: string; paidAt: string }>
}

interface Device {
  id: string
  model: string
  color: string | null
  storage: string | null
  storageAmount: number | string | null
  storageUnit: 'GB' | 'TB' | null
  conditionCode: 'NEW' | 'USED' | null
  batteryHealth: number | null
  /** Omitted by the server for shop staff. */
  purchasePrice?: number
  // Native purchase-currency context — see docs/currency-accounting-model.md.
  purchaseCurrency?: 'UZS' | 'USD'
  purchaseInputAmount?: number
  // Prisma Decimal? — see the identical comment on Sale.contractExchangeRateAtCreation above.
  purchaseExchangeRateAtCreation?: number | string | null
  purchaseAmountUzsSnapshot?: number
  imei: string
  imeis: { slot: 'PRIMARY' | 'SECONDARY'; value: string }[]
  supplierPhone: string | null
  supplier: Supplier | null
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA' | 'RETURNED' | 'DELETED'
  imageUrls: string[]
  createdAt: string
  sales?: Sale[]
  nasiya?: Nasiya[]
  returns?: DeviceReturnInfo[]
  supplierPayables?: SupplierPayableInfo[]
}

function fmt(n: number, currency: ReturnType<typeof useShopCurrency>['currency']) {
  return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
}

export default function QurilmaDetailPage() {
  const { can } = useShopAccess()
  const canOpen = [
    'INVENTORY_VIEW',
    'DEVICE_CREATE',
    'DEVICE_EDIT',
    'DEVICE_DELETE',
    'DEVICE_RESTOCK',
    'SALE_VIEW',
    'SALE_CREATE',
    'SALE_EDIT',
    'SALE_PAYMENT_RECEIVE',
    'SALE_REMINDER_MANAGE',
    'SALE_RETURN_REFUND',
    'OLIB_CREATE',
    'SUPPLIER_PAYABLE_VIEW',
    'SUPPLIER_PAYMENT_RECORD',
    'SUPPLIER_PAYMENT_MARK_PAID',
  ].some((permission) => can(permission as Parameters<typeof can>[0]))
  if (!canOpen) return <ShopAccessDenied />
  return <AuthorizedQurilmaDetailPage />
}

function AuthorizedQurilmaDetailPage() {
  const { can, memberKind } = useShopAccess()
  const canViewInventory = can('INVENTORY_VIEW')
  const canSeeOwnerFinancials = memberKind === 'SHOP_OWNER'
  const canEditDevice = can('DEVICE_EDIT')
  const canDeleteDevice = can('DEVICE_DELETE')
  const canRestockDevice = can('DEVICE_RESTOCK')
  const canCreateCashSale = can('SALE_CREATE')
  const canEditCashSale = can('SALE_EDIT')
  const canManageSaleReminder = can('SALE_REMINDER_MANAGE')
  const canCreateNasiya = can('NASIYA_CREATE')
  const canReceiveSalePayment = can('SALE_PAYMENT_RECEIVE')
  const canReceiveNasiyaPayment = can('NASIYA_PAYMENT_RECEIVE')
  const canReturnSale = can('SALE_RETURN_REFUND')
  const canViewLogs = can('LOG_VIEW')
  const canViewSupplierPayables = can('SUPPLIER_PAYABLE_VIEW')
  const canPaySupplierPayable = can('SUPPLIER_PAYMENT_RECORD') || can('SUPPLIER_PAYMENT_MARK_PAID')
  const hasSalePurpose = can('SALE_VIEW') || canCreateCashSale || canEditCashSale || canReceiveSalePayment || canManageSaleReminder || canReturnSale
  const detailPurpose = canViewInventory
    ? null
    : (can('DEVICE_CREATE') || canEditDevice || canDeleteDevice || canRestockDevice)
      ? 'device'
      : hasSalePurpose
        ? 'sale'
        : 'payable'
  const backHref = canViewInventory || detailPurpose === 'device'
    ? '/shop/qurilmalar'
    : detailPurpose === 'payable'
      ? '/shop/qarzlar?tab=outgoing'
    : canReturnSale
      ? '/shop/qurilmalar'
    : (can('SALE_VIEW') || canEditCashSale || canManageSaleReminder)
      ? '/shop/sotuvlar'
      : canReceiveSalePayment
        ? '/shop/tolovlar'
        : '/shop/yangi-operatsiya'
  const backLabel = backHref === '/shop/sotuvlar'
    ? 'Sotuvlarga qaytish'
    : backHref.startsWith('/shop/qarzlar')
      ? 'Qarzlarga qaytish'
    : backHref === '/shop/tolovlar'
      ? "To'lovlarga qaytish"
      : backHref === '/shop/yangi-operatsiya'
        ? 'Operatsiyalarga qaytish'
        : 'Qurilmalarga qaytish'
  const salePaymentCommand = useLogicalCommandIdempotency()
  const returnCommand = useLogicalCommandIdempotency()
  const params = useParams()
  const searchParams = useSearchParams()
  const salePaymentAutoOpened = useRef(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const queryScope = useAuthenticatedQueryScope()
  const id = params.id as string
  const { currency } = useShopCurrency()

  const [device, setDevice] = useState<Device | null>(null)
  const imageViewer = useImageViewer()
  const [supplierPaymentOpen, setSupplierPaymentOpen] = useState(false)
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
    storageUnit: 'GB' as 'GB' | 'TB',
    conditionCode: '' as '' | 'NEW' | 'USED',
    batteryHealth: '',
    purchasePrice: '',
    imei: '',
    secondaryImei: '',
    supplierPhone: '',
    note: '',
  })
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [purchasePriceDirty, setPurchasePriceDirty] = useState(false)
  const editImageSelection = useImageSelection({
    mode: 'multiple',
    uploadEndpoint: '/api/uploads/device',
    maxFiles: 10,
  })

  const fetchDevice = useCallback(() => {
    if (!id) return
    const query = detailPurpose ? `?purpose=${detailPurpose}` : ''
    return fetch(`/api/devices/${id}${query}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setDevice(json.data)
        else setError(json.error || 'Xatolik yuz berdi')
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [detailPurpose, id])

  useEffect(() => {
    fetchDevice()
  }, [fetchDevice])

  useEffect(() => {
    const sale = device?.sales?.[0]
    if (
      salePaymentAutoOpened.current || searchParams.get('action') !== 'sale-payment' ||
      !canReceiveSalePayment || !sale || sale.paidFully || Number(sale.contractRemainingAmount) <= 0
    ) return
    const suggestedAmount = sale.contractCurrency !== currency.currency && !currency.usdUzsRate
      ? String(sale.remainingAmount)
      : (() => {
        const suggestion = convertPaymentToContractCurrency(
        sale.contractRemainingAmount,
        sale.contractCurrency,
        currency.currency,
        currency.usdUzsRate,
      )
        return currency.currency === 'USD' ? suggestion.toFixed(2) : String(Math.round(suggestion))
      })()
    const frame = window.requestAnimationFrame(() => {
      salePaymentAutoOpened.current = true
      setSalePayMethod('')
      setSalePayNote('')
      setSaleSplitPayment(false)
      setSaleSplitMethod2('')
      setSaleSplitAmount1Input('')
      setSaleSplitAmount2Input('')
      setSaleSplitAmount2Touched(false)
      setSalePayAmount(suggestedAmount)
      setSalePaymentOpen(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [canReceiveSalePayment, currency.currency, currency.usdUzsRate, device, searchParams])

  // Device lifecycle history (created -> sold -> returned -> restocked ...).
  useEffect(() => {
    if (!canViewLogs || !id) return
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
  }, [canViewLogs, id])

  function openEdit() {
    if (!device) return
    setEditForm({
      model: device.model,
      color: device.color ?? '',
      storage: device.storageAmount != null ? String(device.storageAmount) : '',
      storageUnit: device.storageUnit ?? 'GB',
      conditionCode: device.conditionCode ?? '',
      batteryHealth: device.batteryHealth != null ? String(device.batteryHealth) : '',
      // Cost is intentionally absent for workers. Owners see the stored UZS
      // cost in their active display currency, just as before.
      purchasePrice: canSeeOwnerFinancials && device.purchasePrice != null
        ? (currency.currency === 'USD' && currency.usdUzsRate
            ? convertUzsToUsd(device.purchasePrice, currency.usdUzsRate).toFixed(2)
            : String(device.purchasePrice))
        : '',
      imei: device.imei,
      secondaryImei: device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? '',
      supplierPhone: device.supplierPhone ?? '',
      note: '',
    })
    setEditError('')
    setPurchasePriceDirty(false)
    editImageSelection.resetSavedImages(device.imageUrls.map((imageUrl, index) => ({
      key: imageUrl,
      previewUrl: getDeviceImageSrc(imageUrl),
      filename: `${device.model} — saqlangan rasm ${index + 1}`,
    })))
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
    const price = canSeeOwnerFinancials ? Number(editForm.purchasePrice) : null
    if (canSeeOwnerFinancials && (price == null || !Number.isFinite(price) || price <= 0)) {
      setEditError("Kelish narxi 0 dan katta bo'lishi kerak")
      return
    }
    if (canSeeOwnerFinancials && currency.currency === 'USD' && !currency.usdUzsRate) {
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
      const imageUrls = await editImageSelection.uploadAll()
      const res = await fetch(`/api/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: editForm.model.trim(),
          color: editForm.color.trim(),
          ...(editForm.storage.trim() ? { storageAmount: Number(editForm.storage), storageUnit: editForm.storageUnit } : {}),
          conditionCode: editForm.conditionCode || undefined,
          ...(battery !== undefined ? { batteryHealth: battery } : {}),
          ...(canSeeOwnerFinancials && purchasePriceDirty && price != null
            ? { purchasePrice: price, inputCurrency: currency.currency }
            : {}),
          imei: editForm.imei.trim(),
          secondaryImei: editForm.secondaryImei.trim(),
          supplierPhone: editForm.supplierPhone.trim(),
          imageUrls,
          note: editForm.note.trim() || undefined,
        }),
      })
      const json = await res.json() as { success?: boolean; error?: string; data?: { item?: DeviceListItem } }
      if (!res.ok || !json.success) throw new Error(json.error || 'Saqlashda xatolik')
      if (json.data?.item) patchDeviceUpsert(queryClient, queryScope, json.data.item)
      await commitNavigationMutation({ kind: 'device.updated', deviceId: id })
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
        await navigateAfterMutation(router, '/shop/qurilmalar', { kind: 'device.deleted', deviceId: id })
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
    if (!latestSale || !saleHasEffectiveAmount || !salePayMethod || salePayLoading || !saleSplitValid)
      return
    setSalePayLoading(true)
    setSalePayError('')
    try {
      const payload = {
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
      }
      const res = await fetch(`/api/sales/${latestSale.id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': salePaymentCommand.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        salePaymentCommand.rejected(res.status)
        throw new Error(json.error || "To'lovni saqlashda xatolik")
      }
      salePaymentCommand.committed()
      await commitNavigationMutation({
        kind: 'sale.paymentRecorded',
        deviceId: id,
      }).catch(() => undefined)
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
          ...(canEditCashSale ? {
            customerName: saleEditCustomerName.trim(),
            customerPhone: saleEditCustomerPhone.trim(),
            paymentMethod: saleEditPaymentMethod,
            dueDate: saleEditDueDate || null,
            note: saleEditNote.trim() || undefined,
          } : {}),
          ...(canManageSaleReminder ? { reminderEnabled: saleEditReminderEnabled } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Sotuvni yangilashda xatolik')
      await commitNavigationMutation({ kind: 'sale.updated', deviceId: id })
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
    const returnCurrency = currency.currency
    const returnContractCurrency = device?.sales?.[0]?.contractCurrency ?? returnCurrency
    if (returnNote.trim().length < 5) {
      setReturnError("Qaytarish sababi kamida 5 ta belgidan iborat bo'lishi kerak")
      requestAnimationFrame(() => document.getElementById('return-note')?.focus())
      return
    }
    if (Number.isNaN(refundAmount) || refundAmount < 0) {
      setReturnError("Qaytarilgan summa manfiy bo'lishi mumkin emas")
      requestAnimationFrame(() => document.getElementById('return-refund-amount')?.focus())
      return
    }
    if (refundAmount > 0 && !returnRefundMethod) {
      setReturnError('Pul qaytarilganda qaytarish usulini tanlang')
      requestAnimationFrame(() => document.getElementById('return-refund-method')?.focus())
      return
    }
    if (
      refundAmount > 0 &&
      (returnCurrency === 'USD' || returnContractCurrency === 'USD') &&
      !currency.fxQuote?.rateMinorUnits
    ) {
      setReturnError('USD/UZS kursi mavjud emas. Qaytarish summasini hozir saqlab bo‘lmaydi')
      return
    }
    if (returning) return
    setReturning(true)
    setReturnError('')
    try {
      const payload = {
        note: returnNote,
        refundAmount,
        inputCurrency: returnCurrency,
        refundMethod: refundAmount > 0 ? returnRefundMethod : undefined,
        expectedFxRateMinorUnits: currency.fxQuote?.rateMinorUnits ?? null,
      }
      const res = await fetch(`/api/devices/${id}/return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': returnCommand.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        returnCommand.rejected(res.status)
        throw new Error(json.error || 'Qaytarishda xatolik')
      }
      returnCommand.committed()
      await navigateAfterMutation(router, '/shop/qurilmalar', {
        kind: 'return.created',
        deviceId: id,
      })
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Qaytarishda xatolik')
    } finally {
      setReturning(false)
    }
  }

  async function handleRestockDevice() {
    if (restockNote.trim().length < 5) {
      setRestockError("Sabab kamida 5 ta belgidan iborat bo'lishi kerak")
      requestAnimationFrame(() => document.getElementById('restock-note')?.focus())
      return
    }
    if (restocking) return
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
      await commitNavigationMutation({ kind: 'device.restocked', deviceId: id })
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

  // Purchase price is owner-only. When present, cross-currency display uses
  // the purchase-time rate rather than today's rate.
  const infoRows: { label: string; value: string; hint?: string | null }[] = [
    { label: 'Model', value: device.model },
    { label: 'Rang', value: device.color ?? '—' },
    { label: 'Xotira', value: formatDeviceStorage(device) || '—' },
    { label: 'Holati', value: deviceConditionLabel(device.conditionCode) },
    { label: 'Qo‘shimcha IMEI', value: device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? '—' },
    {
      label: 'Batareya',
      value: device.batteryHealth != null ? `${device.batteryHealth}%` : '—',
    },
    ...(canSeeOwnerFinancials && device.purchaseInputAmount != null && device.purchaseCurrency
      ? [{
          label: 'Kelish narxi',
          value: formatDisplayMoneyFromContract(
            device.purchaseInputAmount,
            device.purchaseCurrency,
            currency.currency,
            device.purchaseExchangeRateAtCreation ?? currency.usdUzsRate,
          ),
        }]
      : []),
    { label: 'IMEI', value: displayImei(device.imei) },
    { label: 'Yetkazib beruvchi', value: device.supplier?.name ?? '—' },
    { label: 'Tel raqam', value: device.supplier?.phone ?? '—' },
    { label: "Qo'shilgan sana", value: uzDate(device.createdAt) },
    { label: 'Holat', value: deviceStatusLabel(device.status) },
  ]

  const showSaleActions = device.status === 'IN_STOCK'
  const latestSale = device.sales?.[0]
  const saleHasDebt = latestSale ? Number(latestSale.contractRemainingAmount) > 0 && !latestSale.paidFully : false
  const saleProfit = canSeeOwnerFinancials && latestSale && device.purchasePrice != null
    ? latestSale.salePrice - device.purchasePrice
    : null
  // Native contract-currency margin — stable, never re-derived from today's
  // rate (see computeSaleContractMargin). When the sale and the device's own
  // purchase were both entered in the same currency, this is a plain native
  // subtraction (no FX conversion at all — avoids double-counting a
  // difference between the purchase-time and sale-time rates). Falls back to
  // the legacy UZS-based saleProfit above when a USD contract has no
  // creation rate on record (should not happen for a real USD sale).
  const saleContractProfit = canSeeOwnerFinancials && latestSale &&
    device.purchaseCurrency && device.purchaseInputAmount != null && device.purchaseAmountUzsSnapshot != null
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
  const returnInputCurrency = currency.currency
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
  const nasiyaContractProfit = canSeeOwnerFinancials && latestNasiya &&
    device.purchaseCurrency && device.purchaseInputAmount != null && device.purchaseAmountUzsSnapshot != null
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
  const latestSupplierPayable = device.supplierPayables?.[0]
  const nasiyaPct =
    latestNasiya && latestNasiya.contractFinalAmount > 0
      ? Math.round(((latestNasiya.contractFinalAmount - latestNasiya.contractRemainingAmount) / latestNasiya.contractFinalAmount) * 100)
      : 0

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Back */}
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        {backLabel}
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
          {canEditDevice && device.status === 'IN_STOCK' && (
            <Button
              variant="outline"
              onClick={openEdit}
              className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded"
            >
              <Pencil size={14} />
              Tahrirlash
            </Button>
          )}
          {showSaleActions && (canCreateCashSale || canCreateNasiya) && (
            <>
              {canCreateCashSale && (
                <Link href={`/shop/sotuv/new?deviceId=${device.id}`}>
                  <Button className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">Naqd sotish</Button>
                </Link>
              )}
              {canCreateNasiya && (
                <Link href={`/shop/nasiyalar/new?deviceId=${device.id}`}>
                  <Button variant="outline" className="h-9 px-4 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
                    Nasiyaga berish
                  </Button>
                </Link>
              )}
            </>
          )}
          {canRestockDevice && device.status === 'RETURNED' && (
            <Button onClick={() => setRestockModalOpen(true)} className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">
              Sotuvga qo&apos;yish
            </Button>
          )}
          {canDeleteDevice && device.status === 'IN_STOCK' && (
            <Button
              variant="outline"
              aria-label="Qurilmani o'chirish"
              onClick={() => setDeleteModalOpen(true)}
              className="h-9 w-9 p-0 border-zinc-200 text-red-500 hover:bg-red-50 hover:border-red-200 rounded"
            >
              <Trash2 size={15} />
            </Button>
          )}
          {(canReturnSale && ['SOLD_CASH', 'SOLD_DEBT'].includes(device.status)) && (
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
        <>
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">Qurilma rasmlari</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {device.imageUrls.map((imageUrl, index) => (
                  <div
                    key={`${imageUrl}-${index}`}
                    className="relative aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50"
                  >
                    <Image
                      src={getDeviceImageSrc(imageUrl)}
                      alt={`${device.model} rasmi ${index + 1}`}
                      fill
                      sizes="(max-width: 640px) 50vw, 220px"
                      unoptimized
                      className="object-cover"
                    />
                    <ImageViewerTrigger
                      label={`${device.model} ${index + 1}-rasmini kattalashtirish`}
                      onClick={(trigger) => imageViewer.openAt(index, trigger)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <ImageViewer
            images={device.imageUrls.map((imageUrl, index) => ({
              id: `${imageUrl}-${index}`,
              src: getDeviceImageSrc(imageUrl),
              alt: `${device.model} rasmi ${index + 1}`,
            }))}
            open={imageViewer.open}
            activeIndex={imageViewer.activeIndex}
            onOpenChange={imageViewer.onOpenChange}
            onActiveIndexChange={imageViewer.onActiveIndexChange}
            finalFocusRef={imageViewer.finalFocusRef}
            title={`${device.model} rasmlari`}
          />
        </>
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
                {row.label === 'Holati' ? <DeviceConditionBadge label={row.value} /> : row.value}
                {row.hint && <span className="block text-xs text-zinc-400 font-normal">{row.hint}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {canViewSupplierPayables && latestSupplierPayable && (
        <div className="overflow-hidden rounded border border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-sm font-semibold text-amber-950">Yetkazib beruvchiga qarz</span>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-800">
              {latestSupplierPayable.status === 'PAID' ? 'To‘langan' : latestSupplierPayable.status === 'PARTIAL' ? 'Qisman to‘langan' : latestSupplierPayable.status === 'OVERDUE' ? 'Muddati o‘tgan' : 'Kutilmoqda'}
            </span>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <div className="font-medium text-zinc-900">{latestSupplierPayable.supplier.name}</div>
              <div className="text-xs text-zinc-500">{formatUzPhoneDisplay(latestSupplierPayable.supplier.phone)} · {latestSupplierPayable.origin === 'DEVICE_PURCHASE' ? 'Qurilma xaridi' : 'Olib-sotdim'}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-white p-3 text-xs">
              <div><span className="block text-zinc-500">Jami</span><strong>{formatMoneyDto(latestSupplierPayable.originalAmount)}</strong></div>
              <div><span className="block text-zinc-500">To‘langan</span><strong className="text-emerald-700">{formatMoneyDto(latestSupplierPayable.paidAmount)}</strong></div>
              <div><span className="block text-zinc-500">Qolgan</span><strong className="text-red-700">{formatMoneyDto(latestSupplierPayable.remainingAmount)}</strong></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-zinc-600">Muddat: <strong>{uzDate(latestSupplierPayable.dueDate)}</strong></span>
              {latestSupplierPayable.lastPaymentAt && <span className="text-xs text-zinc-500">Oxirgi to‘lov: {uzDateTime(latestSupplierPayable.lastPaymentAt)}</span>}
            </div>
            {latestSupplierPayable.payments.length > 0 && <details className="text-xs text-zinc-600">
              <summary className="cursor-pointer font-medium">Oxirgi to‘lovlar</summary>
              <div className="mt-2 space-y-1 border-l border-amber-200 pl-3">
                {latestSupplierPayable.payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3"><span>{uzDateTime(payment.paidAt)} · {paymentMethodLabel(payment.method)}</span><strong>{formatMoneyDto(payment.amount)}</strong></div>)}
              </div>
            </details>}
            {canPaySupplierPayable && latestSupplierPayable.remainingAmount.minorUnits > 0 && (
              <Button onClick={() => setSupplierPaymentOpen(true)}>To‘lov qilish</Button>
            )}
          </div>
        </div>
      )}

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
            {(canEditCashSale || canManageSaleReminder) && (
              <Button
                type="button"
                variant="outline"
                onClick={openSaleEdit}
                className="h-8 rounded border-zinc-200 px-3 text-xs text-zinc-700"
              >
                <Pencil size={13} />
                Tahrirlash
              </Button>
            )}
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
            {canSeeOwnerFinancials && (
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
            )}
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
            {canReceiveSalePayment && saleHasDebt && (
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
              {canSeeOwnerFinancials && (
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
              )}
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
              {canReceiveNasiyaPayment && latestNasiya.resolutionState === 'ACTIVE' && (latestNasiya.status === 'ACTIVE' || latestNasiya.status === 'OVERDUE') && (
                <Button
                  onClick={() => setNasiyaPaymentOpen(true)}
                  className="text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 rounded shadow-sm"
                >
                  To'lov qabul qilish
                </Button>
              )}
              <IntentPrefetchLink
                href={`/shop/nasiyalar/${latestNasiya.id}`}
                className={buttonVariants({ variant: 'outline', className: 'rounded border-zinc-200 text-sm text-zinc-700' })}
              >
                Nasiyani ko'rish
              </IntentPrefetchLink>
            </div>
          </div>
        </div>
      )}

      {canReceiveNasiyaPayment && latestNasiya && (
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

      {/* Immutable return disposition: original deal remains in history and
          the reversal belongs to this return date. */}
      {['IN_STOCK', 'RETURNED'].includes(device.status) && latestReturn && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qaytarish ma&apos;lumotlari</span>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Holat</span>
              <span className="text-blue-700 font-medium">{device.status === 'IN_STOCK' ? 'Qurilma qayta omborga qo‘shildi' : 'Qaytarilgan'}</span>
            </div>
            {latestReturn.refundAmount > 0 && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Qaytarilgan summa</span>
                <span className="text-zinc-900 font-medium">
                  {latestReturn.refundInputAmount != null && latestReturn.refundInputCurrency
                    ? formatUserFacingMoney({
                        amount: latestReturn.refundInputAmount,
                        amountCurrency: latestReturn.refundInputCurrency,
                        displayCurrency: currency.currency,
                        rate: currency.usdUzsRate,
                      })
                    : fmt(latestReturn.refundAmount, currency)}
                </span>
              </div>
            )}
            {latestReturn.refundMethod && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Qaytarish usuli</span>
                <span className="text-zinc-900 font-medium">{paymentMethodLabel(latestReturn.refundMethod)}</span>
              </div>
            )}
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Olingan jami</span>
              <span className="text-zinc-900 font-medium">
                {formatUserFacingMoney({
                  amount: latestReturn.contractReceiptsAtReturn,
                  amountCurrency: latestReturn.contractCurrency,
                  displayCurrency: currency.currency,
                  rate: currency.usdUzsRate,
                })}
              </span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Saqlab qolindi</span>
              <span className="text-zinc-900 font-medium">
                {formatUserFacingMoney({
                  amount: latestReturn.contractRetainedAmount,
                  amountCurrency: latestReturn.contractCurrency,
                  displayCurrency: currency.currency,
                  rate: currency.usdUzsRate,
                })}
              </span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Bekor qilingan qarz</span>
              <span className="text-zinc-900 font-medium">
                {formatUserFacingMoney({
                  amount: latestReturn.contractCancelledDebt,
                  amountCurrency: latestReturn.contractCurrency,
                  displayCurrency: currency.currency,
                  rate: currency.usdUzsRate,
                })}
              </span>
            </div>
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

      {canViewLogs && <DeviceActionHistory logs={logs} />}

      {/* Edit dialog is available only while the device is sellable or awaiting legacy restock. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
          <DialogHeader className="border-b border-zinc-100 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-zinc-900">Qurilmani tahrirlash</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
            {editError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</div>}
            <Field label="Model" required>
              <Input
                value={editForm.model}
                onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                className="h-10 rounded-lg border-zinc-200 text-sm"
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Rang">
                <Input
                  value={editForm.color}
                  onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-10 rounded-lg border-zinc-200 text-sm"
                />
              </Field>
              <StorageInput
                id="edit-device-storage"
                amount={editForm.storage}
                unit={editForm.storageUnit}
                onAmountChange={(value) => setEditForm((form) => ({ ...form, storage: value }))}
                onUnitChange={(value) => setEditForm((form) => ({ ...form, storageUnit: value }))}
              />
              <Field label="Batareya (%)">
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
              </Field>
              {canSeeOwnerFinancials && (
                <Field label={`Kelish narxi (${currencyLabel(currency.currency)})`} required>
                  <MoneyInput
                    currency={currency.currency}
                    value={editForm.purchasePrice}
                    onChange={(v) => { setPurchasePriceDirty(true); setEditForm((f) => ({ ...f, purchasePrice: v })) }}
                    className="h-10 rounded-lg border-zinc-200 text-sm"
                  />
                </Field>
              )}
            </div>
            <Field
              label="Asosiy IMEI"
              required
              help="15 ta raqam"
              error={editForm.imei && !/^\d{15}$/.test(editForm.imei) ? 'IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
            >
              <Input
                value={editForm.imei}
                onChange={(e) => setEditForm((f) => ({ ...f, imei: e.target.value }))}
                inputMode="numeric"
                maxLength={15}
                className="h-10 rounded-lg border-zinc-200 text-sm font-mono"
              />
            </Field>
            <Field
              label="Qo‘shimcha IMEI"
              help="Ixtiyoriy, 15 ta raqam"
              error={editForm.secondaryImei && !/^\d{15}$/.test(editForm.secondaryImei) ? 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
            >
              <Input value={editForm.secondaryImei} onChange={(e) => setEditForm((f) => ({ ...f, secondaryImei: e.target.value }))} inputMode="numeric" maxLength={15} className="h-10 rounded-lg border-zinc-200 text-sm font-mono" />
            </Field>
            <div className="space-y-1.5">
              <label htmlFor="edit-device-condition" className="block text-xs font-medium text-zinc-700">Holati</label>
              <Select value={editForm.conditionCode} onValueChange={(value) => value && setEditForm((form) => ({ ...form, conditionCode: value as 'NEW' | 'USED' }))}>
                <SelectTrigger id="edit-device-condition" className="h-10 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">Ishlatilgan</SelectItem></SelectContent>
              </Select>
            </div>
            <Field label="Yetkazib beruvchi tel">
              <PhoneInput
                value={editForm.supplierPhone}
                onChange={(supplierPhone) => setEditForm((f) => ({ ...f, supplierPhone }))}
                className="h-10 rounded-lg border-zinc-200 text-sm"
              />
            </Field>
            <ImageSelectionField
              inputId="edit-device-images"
              label="Qurilma rasmlari"
              mode="multiple"
              selection={editImageSelection}
              disabled={editSaving}
            />
            <Field label="Izoh">
              <Textarea
                value={editForm.note}
                onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Ixtiyoriy izoh"
                className="min-h-[70px] rounded-lg border-zinc-200 text-sm"
              />
            </Field>
          </div>
          <DialogFooter className="gap-2 border-t border-zinc-100 px-5 py-4">
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-lg border-zinc-200 text-zinc-700">
              Bekor qilish
            </Button>
            <AsyncButton
              disabled={editImageSelection.hasBlockingErrors}
              pending={editSaving}
              pendingLabel="Saqlanmoqda..."
              onClick={handleEditSave}
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              Saqlash
            </AsyncButton>
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
            <Field label="Sabab" required>
              <Textarea
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                placeholder="Masalan: Qurilma buzilgan, yo'qolgan..."
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </Field>
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
            <AsyncButton
              disabled={!deleteNote.trim()}
              pending={deleting}
              pendingLabel="O'chirilmoqda..."
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-40"
            >
              O'chirish
            </AsyncButton>
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
              <Field label="Mijoz">
                <Input
                  disabled={!canEditCashSale}
                  value={saleEditCustomerName}
                  onChange={(e) => setSaleEditCustomerName(e.target.value)}
                  className="h-9 rounded border-zinc-200 text-sm"
                />
              </Field>
              <Field label="Telefon">
                <PhoneInput
                  disabled={!canEditCashSale}
                  value={saleEditCustomerPhone}
                  onChange={setSaleEditCustomerPhone}
                  className="h-9 rounded border-zinc-200 text-sm"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="To'lov usuli">
                <select
                  disabled={!canEditCashSale}
                  value={saleEditPaymentMethod}
                  onChange={(e) => setSaleEditPaymentMethod(e.target.value)}
                  className="h-9 w-full rounded border border-zinc-200 bg-white px-2 text-sm"
                >
                  <option value="CASH">Naqd pul</option>
                  <option value="CARD">Karta orqali</option>
                  <option value="TRANSFER">Pul o‘tkazmasi</option>
                  <option value="OTHER">Boshqa</option>
                </select>
              </Field>
              <Field label="Qarz muddati">
                <DateInput
                  disabled={!canEditCashSale}
                  value={saleEditDueDate}
                  onValueChange={setSaleEditDueDate}
                  className="h-9 rounded border-zinc-200 text-sm"
                />
              </Field>
            </div>
            <label htmlFor="sale-edit-reminder" className="flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <input
                id="sale-edit-reminder"
                type="checkbox"
                disabled={!canManageSaleReminder}
                checked={saleEditReminderEnabled}
                onChange={(e) => setSaleEditReminderEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Eslatma yoqilgan
            </label>
            <Textarea
              disabled={!canEditCashSale}
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
            <AsyncButton pending={saleEditSaving} pendingLabel="Saqlanmoqda..." onClick={handleSaleEdit} className="rounded bg-zinc-900 text-white hover:bg-zinc-800">
              Saqlash
            </AsyncButton>
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

            <label htmlFor="sale-split-payment" className="flex items-center gap-2 text-xs font-medium text-zinc-700">
              <input
                id="sale-split-payment"
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
                <Field label={`Miqdor (${currencyLabel(currency.currency)})`} required>
                  <MoneyInput
                    currency={currency.currency}
                    value={salePayAmount}
                    onChange={setSalePayAmount}
                    className="h-9 text-sm border-zinc-200 rounded"
                  />
                </Field>
                <Field label="To'lov usuli" required>
                  <select
                    value={salePayMethod}
                    onChange={(e) => setSalePayMethod(e.target.value)}
                    className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
                  >
                    <option value="">Tanlang...</option>
                    <option value="CASH">Naqd pul</option>
                    <option value="CARD">Karta orqali</option>
                    <option value="TRANSFER">Pul o‘tkazmasi</option>
                    <option value="OTHER">Boshqa</option>
                  </select>
                </Field>
              </>
            ) : (
              // Split payment: each method has its OWN "To'lov usuli N" block
              // with its own method select + amount input — never a single
              // total field re-purposed as "first part". The total below is
              // ALWAYS the sum of the two parts and is never itself editable.
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <fieldset>
                  <legend className="block text-xs font-medium text-zinc-700 mb-1">To&apos;lov usuli 1</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label htmlFor="sale-split-method-1" className="sr-only">Birinchi to&apos;lov usuli</label>
                    <select
                      id="sale-split-method-1"
                      value={salePayMethod}
                      onChange={(e) => setSalePayMethod(e.target.value)}
                      className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
                    >
                      <option value="">Tanlang...</option>
                      <option value="CASH">Naqd pul</option>
                      <option value="CARD">Karta orqali</option>
                      <option value="TRANSFER">Pul o‘tkazmasi</option>
                      <option value="OTHER">Boshqa</option>
                    </select>
                    <label htmlFor="sale-split-amount-1" className="sr-only">Birinchi to&apos;lov miqdori</label>
                    <MoneyInput
                      id="sale-split-amount-1"
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
                </fieldset>
                <fieldset>
                  <legend className="block text-xs font-medium text-zinc-700">To&apos;lov usuli 2</legend>
                  <div className="mb-1 flex items-center justify-end">
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
                    <label htmlFor="sale-split-method-2" className="sr-only">Ikkinchi to&apos;lov usuli</label>
                    <select
                      id="sale-split-method-2"
                      value={saleSplitMethod2}
                      onChange={(e) => setSaleSplitMethod2(e.target.value)}
                      className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
                    >
                      <option value="">Tanlang...</option>
                      <option value="CASH">Naqd pul</option>
                      <option value="CARD">Karta orqali</option>
                      <option value="TRANSFER">Pul o‘tkazmasi</option>
                      <option value="OTHER">Boshqa</option>
                    </select>
                    <label htmlFor="sale-split-amount-2" className="sr-only">Ikkinchi to&apos;lov miqdori</label>
                    <MoneyInput
                      id="sale-split-amount-2"
                      currency={currency.currency}
                      value={saleSplitAmount2Input}
                      onChange={(v) => {
                        setSaleSplitAmount2Touched(true)
                        setSaleSplitAmount2Input(v)
                      }}
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </div>
                </fieldset>
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

            <Field label="Izoh" help="Ixtiyoriy">
              <Textarea
                value={salePayNote}
                onChange={(e) => setSalePayNote(e.target.value)}
                placeholder="Masalan: mijoz qolgan qarzni to'ladi"
                className="text-sm border-zinc-200 rounded min-h-[70px]"
              />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSalePaymentOpen(false)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <AsyncButton
              disabled={!saleHasEffectiveAmount || !salePayMethod || !saleSplitValid}
              pending={salePayLoading}
              pendingLabel="Saqlanmoqda..."
              onClick={handleSalePayment}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              Saqlash
            </AsyncButton>
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
              Bu amal qurilmani omborga qaytaradi. Asl shartnoma va barcha to'lovlar o'zgarmas tarix sifatida saqlanadi;
              qaytarilgan pul va bekor qilingan qarz alohida qayd etiladi.
            </p>
            {returnError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{returnError}</div>}
            <Field label="Sabab" required help="Kamida 5 ta belgi">
              <Textarea
                id="return-note"
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </Field>
            <div>
              <label htmlFor="return-refund-amount" className="text-xs font-medium text-zinc-700 block mb-1.5">
                Qaytarilgan summa ({currencyLabel(returnInputCurrency)})
              </label>
              <MoneyInput
                id="return-refund-amount"
                currency={returnInputCurrency}
                value={returnRefundAmount}
                onChange={setReturnRefundAmount}
                placeholder="0"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <Field label="Qaytarish usuli" required={Number(returnRefundAmount || 0) > 0}>
              <select
                id="return-refund-method"
                value={returnRefundMethod}
                onChange={(e) => setReturnRefundMethod(e.target.value)}
                disabled={Number(returnRefundAmount || 0) <= 0}
                className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                <option value="">Tanlang...</option>
                <option value="CASH">Naqd pul</option>
                <option value="CARD">Karta orqali</option>
                <option value="TRANSFER">Pul o‘tkazmasi</option>
                <option value="OTHER">Boshqa</option>
              </select>
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReturnModalOpen(false)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <AsyncButton
              pending={returning}
              pendingLabel="Saqlanmoqda..."
              onClick={handleReturnDevice}
              className="bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-40"
            >
              Qaytarishni tasdiqlash
            </AsyncButton>
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
            <Field label="Sabab" required help="Kamida 5 ta belgi">
              <Textarea
                id="restock-note"
                value={restockNote}
                onChange={(e) => setRestockNote(e.target.value)}
                placeholder="Masalan: qurilma tekshirildi, soz holatda, qayta sotuvga qo'yildi"
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </Field>
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
            <AsyncButton
              pending={restocking}
              pendingLabel="Saqlanmoqda..."
              onClick={handleRestockDevice}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              Sotuvga qo'yish
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SupplierPayablePaymentDialog
        target={latestSupplierPayable ? { id: latestSupplierPayable.id, deviceId: device.id, remainingAmount: latestSupplierPayable.remainingAmount } : null}
        open={supplierPaymentOpen}
        onOpenChange={setSupplierPaymentOpen}
        onPaid={() => fetchDevice()}
      />
    </div>
  )
}
