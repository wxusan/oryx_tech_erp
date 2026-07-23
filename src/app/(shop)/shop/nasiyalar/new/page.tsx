'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AsyncButton } from '@/components/ui/async-button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Check, Eye, EyeOff, FileImage, Loader2, X } from 'lucide-react'
import { convertUsdToUzs, convertUzsToUsd, currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { displayImei } from '@/lib/device-display'
import { isValidPhone, PHONE_ERROR } from '@/lib/phone'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { calculateNasiyaAmounts, calculateNasiyaAmountsFromMonthlyPayment, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { InStockDevicePicker, type InStockPickerDevice } from '@/components/shop/in-stock-device-picker'
import { commitNavigationMutation, navigateAfterMutation } from '@/lib/client-events'
import { tashkentTodayInputValue } from '@/lib/timezone'
import type { PaymentMethod } from '@/lib/domain-types'
import { NasiyaSchedulePreview } from '@/components/shop/nasiya-schedule-preview'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { CustomerCombobox, type CustomerPickerOption } from '@/components/shop/customer-combobox'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { ImageViewer, useImageViewer } from '@/components/ui/image-viewer'
import { ImageViewerTrigger } from '@/components/ui/image-viewer-trigger'
import { formatPassportIdentifierInput, isValidPassportIdentifier } from '@/lib/passport-identifier-format'
import type { TrustTier } from '@/components/shop/trust-badge'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'

type Device = InStockPickerDevice

interface CustomerUpdateResponse {
  success: boolean
  data?: Pick<CustomerPickerOption, 'id' | 'name' | 'phone' | 'additionalPhones' | 'hasPassportPhoto'> & {
    note?: string | null
    trustOverride?: TrustTier | null
    passportMasked?: string | null
  }
  error?: string
}

interface CustomerEditDetailResponse {
  success: boolean
  data?: Pick<CustomerPickerOption, 'id' | 'name' | 'phone' | 'additionalPhones' | 'hasPassportPhoto'> & {
    note?: string | null
    trustOverride?: TrustTier | null
    passportMasked?: string | null
  }
  error?: string
}

const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  NEW: 'Yangi mijoz',
  LOW: 'Past',
  MEDIUM: 'O‘rtacha',
  HIGH: 'Yuqori',
  VERY_HIGH: 'Juda yuqori',
}

interface CustomerPassportImageResponse {
  success: boolean
  data?: { url: string }
  error?: string
}

interface CustomerPassportPreview {
  key: string
  url: string | null
  error: string | null
}

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
    device.secondaryImei ? `Qo‘shimcha IMEI: ${displayImei(device.secondaryImei)}` : null,
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
  const nasiyaCommand = useLogicalCommandIdempotency()
  const { currency } = useShopCurrency()
  const { memberKind, can } = useShopAccess()
  const canSeeOwnerFinancials = memberKind === 'SHOP_OWNER'
  const canEditCustomer = can('CUSTOMER_EDIT')
  const canViewCustomerPassportPhoto = can('CUSTOMER_PASSPORT_PHOTO_VIEW')
  const canManageCustomerPassport = can('CUSTOMER_PASSPORT_MANAGE')
  const canOverrideCustomerTrust = can('CUSTOMER_TRUST_OVERRIDE')
  const canRevealCustomerPassport = can('CUSTOMER_PASSPORT_REVEAL')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)

  // Step 2
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAdditionalPhones, setCustomerAdditionalPhones] = useState<string[]>([])
  const [customerNote, setCustomerNote] = useState('')
  const [customerPassportIdentifier, setCustomerPassportIdentifier] = useState('')
  const [customerTrustOverride, setCustomerTrustOverride] = useState<TrustTier | ''>('')
  const [customerMode, setCustomerMode] = useState<'PICK' | 'EXISTING' | 'NEW'>('PICK')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPickerOption | null>(null)
  const [customerEditOpen, setCustomerEditOpen] = useState(false)
  const [editedCustomerName, setEditedCustomerName] = useState('')
  const [editedCustomerPhone, setEditedCustomerPhone] = useState('')
  const [editedCustomerAdditionalPhones, setEditedCustomerAdditionalPhones] = useState<string[]>([])
  const [editedCustomerNote, setEditedCustomerNote] = useState('')
  const [editedCustomerPassportIdentifier, setEditedCustomerPassportIdentifier] = useState('')
  const [editedCustomerTrustOverride, setEditedCustomerTrustOverride] = useState<TrustTier | ''>('')
  const [editedCustomerPassportMasked, setEditedCustomerPassportMasked] = useState<string | null>(null)
  const [customerEditNameError, setCustomerEditNameError] = useState('')
  const [customerEditPhoneError, setCustomerEditPhoneError] = useState('')
  const [customerEditSaveError, setCustomerEditSaveError] = useState('')
  const [savingCustomerEdit, setSavingCustomerEdit] = useState(false)
  const [loadingCustomerEdit, setLoadingCustomerEdit] = useState(false)
  const [selectedCustomerPassportPreview, setSelectedCustomerPassportPreview] = useState<CustomerPassportPreview | null>(null)
  const selectedCustomerImageViewer = useImageViewer()
  const [selectedCustomerPassportRevision, setSelectedCustomerPassportRevision] = useState(0)
  const [selectedCustomerPassportMasked, setSelectedCustomerPassportMasked] = useState<string | null>(null)
  const [selectedCustomerPassportIdentifier, setSelectedCustomerPassportIdentifier] = useState<string | null>(null)
  const [revealingSelectedCustomerPassport, setRevealingSelectedCustomerPassport] = useState(false)
  const [selectedCustomerPassportRevealError, setSelectedCustomerPassportRevealError] = useState('')
  const customerEditPassportSelection = useImageSelection({
    mode: 'single',
    uploadEndpoint: '/api/uploads/passport',
  })
  const passportSelection = useImageSelection({
    mode: 'single',
    uploadEndpoint: '/api/uploads/passport',
  })
  const [nameError, setNameError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [customerPassportIdentifierError, setCustomerPassportIdentifierError] = useState('')
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
  function hasValidNewCustomerPassportIdentifier() {
    return !canManageCustomerPassport || !customerPassportIdentifier.trim() || isValidPassportIdentifier(customerPassportIdentifier)
  }

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
    if (customerMode === 'NEW' && !hasValidNewCustomerPassportIdentifier()) {
      setCustomerPassportIdentifierError("Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")
      ok = false
    }
    if (!ok) {
      if (customerMode === 'NEW' && !isValidPhone(customerPhone)) phoneRef.current?.focus()
      return
    }
    setStep(3)
  }

  function openCustomerEdit(customer: CustomerPickerOption) {
    setEditedCustomerName(customer.name)
    setEditedCustomerPhone(customer.phone)
    setEditedCustomerAdditionalPhones(customer.additionalPhones ?? [])
    setEditedCustomerNote('')
    setEditedCustomerPassportIdentifier('')
    setEditedCustomerTrustOverride('')
    setEditedCustomerPassportMasked(null)
    setCustomerEditNameError('')
    setCustomerEditPhoneError('')
    setCustomerEditSaveError('')
    customerEditPassportSelection.clear()
    setCustomerEditOpen(true)
    setLoadingCustomerEdit(true)
    fetch(`/api/customers/${encodeURIComponent(customer.id)}`, { cache: 'no-store' })
      .then(async (response) => ({ response, json: await response.json() as CustomerEditDetailResponse }))
      .then(({ response, json }) => {
        if (!response.ok || !json.success || !json.data) {
          throw new Error(json.error || "Mijoz ma'lumotlarini yuklab bo'lmadi")
        }
        const detail = json.data
        setEditedCustomerName(detail.name)
        setEditedCustomerPhone(detail.phone)
        setEditedCustomerAdditionalPhones(detail.additionalPhones ?? [])
        setEditedCustomerNote(detail.note ?? '')
        setEditedCustomerTrustOverride(detail.trustOverride ?? '')
        setEditedCustomerPassportMasked(detail.passportMasked ?? null)
        setSelectedCustomerPassportMasked(detail.passportMasked ?? null)
        setSelectedCustomer((current) => current?.id === detail.id
          ? { ...current, name: detail.name, phone: detail.phone, additionalPhones: detail.additionalPhones, hasPassportPhoto: detail.hasPassportPhoto }
          : current)
      })
      .catch((error) => {
        setCustomerEditSaveError(error instanceof Error ? error.message : "Mijoz ma'lumotlarini yuklab bo'lmadi")
      })
      .finally(() => setLoadingCustomerEdit(false))
  }

  useEffect(() => {
    if (!selectedCustomerPassportIdentifier) return
    const timeout = window.setTimeout(() => setSelectedCustomerPassportIdentifier(null), 30_000)
    const hideOnBackground = () => {
      if (document.visibilityState !== 'visible') setSelectedCustomerPassportIdentifier(null)
    }
    document.addEventListener('visibilitychange', hideOnBackground)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', hideOnBackground)
    }
  }, [selectedCustomerPassportIdentifier])

  async function toggleSelectedCustomerPassportIdentifier() {
    if (!selectedCustomer) return
    if (selectedCustomerPassportIdentifier) {
      setSelectedCustomerPassportIdentifier(null)
      return
    }
    setRevealingSelectedCustomerPassport(true)
    setSelectedCustomerPassportRevealError('')
    try {
      const response = await fetch(`/api/customers/${encodeURIComponent(selectedCustomer.id)}/passport/reveal`, {
        method: 'POST',
        cache: 'no-store',
      })
      const json = await response.json() as { success: boolean; data?: { identifier: string }; error?: string }
      if (!response.ok || !json.success || !json.data?.identifier) {
        throw new Error(json.error || "Pasport raqamini ochib bo'lmadi")
      }
      setSelectedCustomerPassportIdentifier(json.data.identifier)
    } catch (error) {
      setSelectedCustomerPassportRevealError(error instanceof Error ? error.message : "Pasport raqamini ochib bo'lmadi")
    } finally {
      setRevealingSelectedCustomerPassport(false)
    }
  }

  const selectedCustomerPassportKey = selectedCustomer
    ? `${selectedCustomer.id}:${selectedCustomerPassportRevision}`
    : null

  useEffect(() => {
    if (!selectedCustomer?.hasPassportPhoto || !canViewCustomerPassportPhoto || !selectedCustomerPassportKey) return

    let cancelled = false
    fetch(`/api/customers/${encodeURIComponent(selectedCustomer.id)}/passport/image`, { cache: 'no-store' })
      .then(async (response) => ({ response, json: await response.json() as CustomerPassportImageResponse }))
      .then(({ response, json }) => {
        if (cancelled) return
        if (!response.ok || !json.success || !json.data?.url) {
          if (response.status === 404) {
            setSelectedCustomer((current) => current?.id === selectedCustomer.id
              ? { ...current, hasPassportPhoto: false }
              : current)
            return
          }
          setSelectedCustomerPassportPreview({
            key: selectedCustomerPassportKey,
            url: null,
            error: json.error || "Pasport rasmini ochib bo'lmadi",
          })
          return
        }
        setSelectedCustomerPassportPreview({ key: selectedCustomerPassportKey, url: json.data.url, error: null })
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedCustomerPassportPreview({
            key: selectedCustomerPassportKey,
            url: null,
            error: "Pasport rasmini ochib bo'lmadi",
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [canViewCustomerPassportPhoto, selectedCustomer?.hasPassportPhoto, selectedCustomer?.id, selectedCustomerPassportKey])

  async function saveCustomerEdit() {
    if (!selectedCustomer || savingCustomerEdit) return

    const name = editedCustomerName.trim()
    let valid = true
    if (canEditCustomer && name.length < 2) {
      setCustomerEditNameError("Ism kamida 2 ta harfdan iborat bo'lishi kerak")
      valid = false
    }
    if (canEditCustomer && !isValidPhone(editedCustomerPhone)) {
      setCustomerEditPhoneError(PHONE_ERROR)
      valid = false
    }
    if (canManageCustomerPassport && customerEditPassportSelection.hasBlockingErrors) {
      setCustomerEditSaveError('Pasport rasmi tanlovini tekshiring')
      valid = false
    }
    if (!valid) return

    setSavingCustomerEdit(true)
    setCustomerEditSaveError('')
    try {
      const [passportPhotoUrl] = canManageCustomerPassport && customerEditPassportSelection.items.length
        ? await customerEditPassportSelection.uploadAll()
        : []
      const response = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(canEditCustomer ? {
            name,
            phone: editedCustomerPhone,
            additionalPhones: editedCustomerAdditionalPhones,
            note: editedCustomerNote,
          } : {}),
          ...(canOverrideCustomerTrust ? { trustOverride: editedCustomerTrustOverride || null } : {}),
          ...(canManageCustomerPassport ? {
            passportIdentifier: editedCustomerPassportIdentifier.trim() || undefined,
            passportPhotoUrl,
          } : {}),
        }),
      })
      const json = await response.json() as CustomerUpdateResponse
      if (!response.ok || !json.success || !json.data) {
        throw new Error(json.error || "Mijoz ma'lumotlarini saqlashda xatolik")
      }

      const updated = json.data
      setSelectedCustomer((current) => current?.id === updated.id
        ? {
            ...current,
            name: updated.name,
            phone: updated.phone,
            additionalPhones: updated.additionalPhones,
            hasPassportPhoto: updated.hasPassportPhoto,
          }
        : current)
      setSelectedCustomerPassportMasked(updated.passportMasked ?? selectedCustomerPassportMasked)
      setSelectedCustomerPassportIdentifier(null)
      setCustomerName(updated.name)
      setCustomerPhone(updated.phone)
      setSelectedCustomerPassportRevision((revision) => revision + 1)
      customerEditPassportSelection.clear()
      setCustomerEditOpen(false)
      void commitNavigationMutation({ kind: 'customer.updated' }).catch(() => undefined)
    } catch (error) {
      setCustomerEditSaveError(error instanceof Error ? error.message : "Mijoz ma'lumotlarini saqlashda xatolik")
    } finally {
      setSavingCustomerEdit(false)
    }
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
    (customerMode !== 'NEW' || !canManageCustomerPassport || !customerPassportIdentifier.trim() || isValidPassportIdentifier(customerPassportIdentifier)) &&
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
      const payload = {
        deviceId: selectedDevice.id,
        customerMode: customerMode === 'EXISTING' ? 'EXISTING' as const : 'NEW' as const,
        customerId: selectedCustomer?.id,
        customerName: customerMode === 'NEW' ? customerName.trim() : undefined,
        customerPhone: customerMode === 'NEW' ? customerPhone.trim() : undefined,
        ...(customerMode === 'NEW' ? {
          customerAdditionalPhones,
          customerNote: customerNote.trim() || undefined,
          ...(canManageCustomerPassport && customerPassportIdentifier.trim()
            ? { customerPassportIdentifier: customerPassportIdentifier.trim() }
            : {}),
          ...(canOverrideCustomerTrust ? { customerTrustOverride: customerTrustOverride || null } : {}),
        } : {}),
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
      }
      const res = await fetch(`/api/devices/${selectedDevice.id}/nasiya`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': nasiyaCommand.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json() as { success: boolean; data?: { id?: string }; error?: string }
      if (!res.ok || !json.success || !json.data?.id) {
        nasiyaCommand.rejected(res.status)
        throw new Error(json.error || 'Nasiyani saqlashda xatolik')
      }
      nasiyaCommand.committed()
      await navigateAfterMutation(router, `/shop/nasiyalar/${json.data.id}`, {
        kind: 'nasiya.created',
        deviceId: selectedDevice.id,
        nasiyaId: json.data.id,
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
            purpose="nasiya"
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

          <div className="relative z-10 rounded border border-zinc-200">
            <div className="rounded-t border-b border-zinc-200 bg-zinc-50 px-4 py-3">
              <span className="text-sm font-semibold text-zinc-900">Mijoz ma&apos;lumotlari</span>
            </div>
            <div className="rounded-b p-4 space-y-4">
              <div>
                <label htmlFor="nasiya-customer-picker" className="mb-1.5 block text-xs font-medium text-zinc-700">
                  Mavjud mijozni tanlang yoki yangisini yarating <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <CustomerCombobox
                  inputId="nasiya-customer-picker"
                  selected={selectedCustomer}
                  onSelect={(customer) => {
                    selectedCustomerImageViewer.close()
                    setSelectedCustomer(customer)
                    setCustomerMode('EXISTING')
                    setCustomerName(customer.name)
                    setCustomerPhone(customer.phone)
                    setSelectedCustomerPassportMasked(customer.passportMasked ?? null)
                    setSelectedCustomerPassportIdentifier(null)
                    setSelectedCustomerPassportRevealError('')
                    setNameError('')
                    setPhoneError('')
                    passportSelection.clear()
                  }}
                  onEdit={canEditCustomer || canManageCustomerPassport || canOverrideCustomerTrust ? openCustomerEdit : undefined}
                  onClear={() => {
                    selectedCustomerImageViewer.close()
                    setSelectedCustomer(null)
                    setCustomerMode('PICK')
                    setCustomerName('')
                    setCustomerPhone('')
                    setCustomerAdditionalPhones([])
                    setCustomerNote('')
                    setCustomerPassportIdentifier('')
                    setCustomerTrustOverride('')
                    setCustomerPassportIdentifierError('')
                    setSelectedCustomerPassportMasked(null)
                    setSelectedCustomerPassportIdentifier(null)
                    setSelectedCustomerPassportRevealError('')
                    passportSelection.clear()
                  }}
                  onCreateNew={(searchText) => {
                    selectedCustomerImageViewer.close()
                    setSelectedCustomer(null)
                    setCustomerMode('NEW')
                    setCustomerName('')
                    setCustomerPhone('')
                    setCustomerAdditionalPhones([])
                    setCustomerNote('')
                    setCustomerPassportIdentifier('')
                    setCustomerTrustOverride('')
                    setCustomerPassportIdentifierError('')
                    setSelectedCustomerPassportMasked(null)
                    setSelectedCustomerPassportIdentifier(null)
                    setSelectedCustomerPassportRevealError('')
                    passportSelection.clear()
                    if (/\d/.test(searchText)) setCustomerPhone(searchText)
                    else setCustomerName(searchText)
                  }}
                  disabled={submitting}
                />
              </div>
              {customerMode === 'EXISTING' && selectedCustomer && (
                <section aria-labelledby="selected-customer-profile-title" className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/80 px-4 py-3 sm:px-5">
                    <div>
                      <h2 id="selected-customer-profile-title" className="text-base font-semibold text-zinc-900">Tanlangan mijoz profili</h2>
                      <p className="mt-0.5 text-sm text-zinc-500">Nasiya shartnomasiga biriktiriladigan mijoz</p>
                    </div>
                    {(canEditCustomer || canManageCustomerPassport || canOverrideCustomerTrust) && (
                      <Button type="button" variant="outline" size="sm" onClick={() => openCustomerEdit(selectedCustomer)} disabled={submitting} className="shrink-0">
                        Tahrirlash
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:p-5">
                    <dl className="space-y-4 text-sm">
                      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-3">
                        <dt className="text-zinc-500">Ism</dt>
                        <dd className="font-semibold text-zinc-900">{selectedCustomer.name}</dd>
                      </div>
                      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-3">
                        <dt className="text-zinc-500">Telefon</dt>
                        <dd className="font-medium text-zinc-900">{formatUzPhoneDisplay(selectedCustomer.phone)}</dd>
                      </div>
                      {selectedCustomer.additionalPhones?.length ? <>
                        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-3">
                          <dt className="text-zinc-500">Qo&apos;shimcha</dt>
                          <dd className="text-zinc-900">{selectedCustomer.additionalPhones.map(formatUzPhoneDisplay).join(', ')}</dd>
                        </div>
                      </> : null}
                      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3">
                        <dt className="text-zinc-500">Pasport seriya</dt>
                        <dd>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-medium text-zinc-900">
                              {selectedCustomerPassportIdentifier ?? selectedCustomerPassportMasked ?? 'Kiritilmagan'}
                            </span>
                            {selectedCustomerPassportMasked && canRevealCustomerPassport && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void toggleSelectedCustomerPassportIdentifier()}
                                disabled={revealingSelectedCustomerPassport}
                                className="h-7 px-2 text-xs"
                              >
                                {selectedCustomerPassportIdentifier ? <EyeOff className="mr-1 size-3.5" aria-hidden="true" /> : <Eye className="mr-1 size-3.5" aria-hidden="true" />}
                                {revealingSelectedCustomerPassport ? 'Ochilmoqda...' : selectedCustomerPassportIdentifier ? 'Yashirish' : "To'liq ko'rish"}
                              </Button>
                            )}
                          </div>
                          {selectedCustomerPassportIdentifier && <p className="mt-1 text-xs text-amber-700">30 soniyadan keyin yoki oynadan chiqqanda yashiriladi.</p>}
                          {selectedCustomerPassportRevealError && <p role="alert" className="mt-1 text-xs text-red-600">{selectedCustomerPassportRevealError}</p>}
                        </dd>
                      </div>
                    </dl>
                    <div className="sm:justify-self-end">
                      <p className="mb-2 text-xs font-medium text-zinc-700">Pasport rasmi</p>
                      {selectedCustomer.hasPassportPhoto && canViewCustomerPassportPhoto ? (
                        selectedCustomerPassportPreview?.key === selectedCustomerPassportKey && selectedCustomerPassportPreview.url ? (
                          <div className="relative aspect-square w-full max-w-48 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 shadow-inner sm:w-48">
                            <Image
                              src={selectedCustomerPassportPreview.url}
                              alt={`${selectedCustomer.name} pasport rasmi`}
                              fill
                              sizes="(max-width: 640px) 100vw, 192px"
                              unoptimized
                              className="object-contain p-2"
                            />
                            <ImageViewerTrigger
                              label={`${selectedCustomer.name} pasport rasmini kattalashtirish`}
                              onClick={(trigger) => selectedCustomerImageViewer.openAt(0, trigger)}
                            />
                          </div>
                        ) : selectedCustomerPassportPreview?.key === selectedCustomerPassportKey && selectedCustomerPassportPreview.error ? (
                          <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-700">{selectedCustomerPassportPreview.error}</p>
                        ) : (
                          <div className="flex aspect-square w-full max-w-48 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-xs text-zinc-500 sm:w-48">
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> Yuklanmoqda...
                          </div>
                        )
                      ) : selectedCustomer.hasPassportPhoto ? (
                        <p className="rounded border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-500">Pasport rasmini ko&apos;rish ruxsati yo&apos;q.</p>
                      ) : (
                        <div className="flex aspect-square w-full max-w-48 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 text-center text-xs text-zinc-500 sm:w-48">
                          <FileImage className="mb-1 size-4" aria-hidden="true" /> Pasport rasmi kiritilmagan
                        </div>
                      )}
                    </div>
                  </div>
                  <ImageViewer
                    images={selectedCustomerPassportPreview?.key === selectedCustomerPassportKey && selectedCustomerPassportPreview.url
                      ? [{
                          id: selectedCustomerPassportKey,
                          src: selectedCustomerPassportPreview.url,
                          alt: `${selectedCustomer.name} pasport rasmi`,
                        }]
                      : []}
                    open={selectedCustomerImageViewer.open}
                    activeIndex={selectedCustomerImageViewer.activeIndex}
                    onOpenChange={selectedCustomerImageViewer.onOpenChange}
                    onActiveIndexChange={selectedCustomerImageViewer.onActiveIndexChange}
                    finalFocusRef={selectedCustomerImageViewer.finalFocusRef}
                    title={`${selectedCustomer.name} pasport rasmi`}
                  />
                </section>
              )}
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
              <fieldset>
                <legend className="mb-1.5 block text-xs font-medium text-zinc-700">Qo&apos;shimcha raqamlar</legend>
                <div className="space-y-2">
                  {customerAdditionalPhones.map((extra, index) => (
                    <div key={`${index}-${extra}`} className="flex items-center gap-2">
                      <PhoneInput
                        aria-label={`Qo'shimcha telefon ${index + 1}`}
                        value={extra}
                        onChange={(value) => setCustomerAdditionalPhones((current) => current.map((phone, currentIndex) => currentIndex === index ? value : phone))}
                        disabled={submitting}
                        className="h-9 text-sm border-zinc-200 rounded"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Raqamni o'chirish"
                        onClick={() => setCustomerAdditionalPhones((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                        disabled={submitting}
                        className="h-9 w-9 shrink-0 border-zinc-200 text-zinc-500 hover:text-red-600"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCustomerAdditionalPhones((current) => [...current, ''])}
                    disabled={submitting || customerAdditionalPhones.length >= 5}
                    className="h-8 border-zinc-200 px-3 text-xs"
                  >
                    + Raqam qo&apos;shish
                  </Button>
                </div>
              </fieldset>
              <Field label="Izoh">
                <Textarea
                  value={customerNote}
                  onChange={(event) => setCustomerNote(event.target.value)}
                  disabled={submitting}
                  placeholder="Qo'shimcha ma'lumot..."
                  className="min-h-[80px] text-sm border-zinc-200 rounded"
                />
              </Field>
              {canManageCustomerPassport && (
                <Field label="Pasport seriya/raqami" error={customerPassportIdentifierError || undefined} help="Ixtiyoriy. To'liq raqam saqlangandan keyin qayta ko'rsatilmaydi.">
                  <Input
                    id="nasiya-new-customer-passport-identifier"
                    value={customerPassportIdentifier}
                    onChange={(event) => {
                      setCustomerPassportIdentifier(formatPassportIdentifierInput(event.target.value))
                      if (customerPassportIdentifierError) setCustomerPassportIdentifierError('')
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    maxLength={10}
                    pattern="[A-Z]{2} [0-9]{7}"
                    placeholder="AA 1234567"
                    disabled={submitting}
                    className="h-9 font-mono text-sm border-zinc-200 rounded"
                  />
                </Field>
              )}
              {canOverrideCustomerTrust && (
                <div>
                  <label htmlFor="nasiya-new-customer-trust" className="mb-1.5 block text-xs font-medium text-zinc-700">Ishonch darajasi</label>
                  <Select value={customerTrustOverride || 'AUTO'} onValueChange={(value) => setCustomerTrustOverride(value === 'AUTO' ? '' : value as TrustTier)}>
                    <SelectTrigger id="nasiya-new-customer-trust" className="h-9 text-sm border-zinc-200 rounded">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUTO">Avtomatik hisoblash</SelectItem>
                      {(Object.keys(TRUST_TIER_LABELS) as TrustTier[]).map((tier) => (
                        <SelectItem key={tier} value={tier}>{TRUST_TIER_LABELS[tier]} (qo&apos;lda)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              </>}
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
              {canSeeOwnerFinancials && selectedDevice?.purchasePrice != null && (
                <div className="sm:col-span-2" role="group" aria-labelledby="nasiya-device-cost-label">
                  <div id="nasiya-device-cost-label" className="block text-xs font-medium text-zinc-700 mb-1.5">
                    Kelish narxi (qurilma tannarxi)
                  </div>
                  <div className="flex h-9 items-center rounded border border-zinc-200 bg-zinc-50 px-2.5 text-sm text-zinc-500">
                    {formatMoneyByCurrency(selectedDevice.purchasePrice, currency.currency, currency.usdUzsRate)}
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
                    <SelectItem value="CASH">Naqd pul</SelectItem>
                    <SelectItem value="CARD">Karta orqali</SelectItem>
                    <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem>
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
            <AsyncButton
              type="submit"
              disabled={!step3Valid}
              pending={submitting}
              pendingLabel="Saqlanmoqda..."
              className="flex-1 h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
            >
              Nasiyani saqlash
            </AsyncButton>
          </div>
        </form>
      )}

      <Dialog
        open={customerEditOpen}
        onOpenChange={(open) => {
          if (!open && !savingCustomerEdit) setCustomerEditOpen(false)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded p-0" showCloseButton={!savingCustomerEdit}>
          <DialogHeader className="px-4 pt-4 pr-12">
            <DialogTitle>Mijozni tahrirlash</DialogTitle>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void saveCustomerEdit()
            }}
          >
            <div className="min-h-0 overflow-y-auto px-4">
              {customerEditSaveError && (
                <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {customerEditSaveError}
                </div>
              )}
              <div className="space-y-3 py-4">
                {loadingCustomerEdit ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Mijoz ma&apos;lumotlari yuklanmoqda...
                  </div>
                ) : <>
                  {canEditCustomer && <>
                    <Field label="Mijoz ismi" required error={customerEditNameError || undefined}>
                      <Input
                        id="nasiya-edit-customer-name"
                        value={editedCustomerName}
                        onChange={(event) => {
                          setEditedCustomerName(event.target.value)
                          if (customerEditNameError) setCustomerEditNameError('')
                        }}
                        disabled={savingCustomerEdit}
                        className="h-9 text-sm border-zinc-200 rounded"
                      />
                    </Field>
                    <Field label="Mijoz tel raqami" required error={customerEditPhoneError || undefined}>
                      <PhoneInput
                        id="nasiya-edit-customer-phone"
                        value={editedCustomerPhone}
                        onChange={(value) => {
                          setEditedCustomerPhone(value)
                          if (customerEditPhoneError) setCustomerEditPhoneError('')
                        }}
                        disabled={savingCustomerEdit}
                        className="h-9 text-sm border-zinc-200 rounded"
                      />
                    </Field>
                    <fieldset>
                      <legend className="mb-1.5 block text-xs font-medium text-zinc-700">Qo&apos;shimcha raqamlar</legend>
                      <div className="space-y-2">
                        {editedCustomerAdditionalPhones.map((extra, index) => (
                          <div key={`${index}-${extra}`} className="flex items-center gap-2">
                            <PhoneInput
                              aria-label={`Qo'shimcha telefon ${index + 1}`}
                              value={extra}
                              onChange={(value) => setEditedCustomerAdditionalPhones((current) => current.map((phone, currentIndex) => currentIndex === index ? value : phone))}
                              disabled={savingCustomerEdit}
                              className="h-9 text-sm border-zinc-200 rounded"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label="Raqamni o'chirish"
                              onClick={() => setEditedCustomerAdditionalPhones((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                              disabled={savingCustomerEdit}
                              className="h-9 w-9 shrink-0 border-zinc-200 text-zinc-500 hover:text-red-600"
                            >
                              <X className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditedCustomerAdditionalPhones((current) => [...current, ''])}
                          disabled={savingCustomerEdit || editedCustomerAdditionalPhones.length >= 5}
                          className="h-8 border-zinc-200 px-3 text-xs"
                        >
                          + Raqam qo&apos;shish
                        </Button>
                      </div>
                    </fieldset>
                    <Field label="Izoh">
                      <Textarea
                        id="nasiya-edit-customer-note"
                        value={editedCustomerNote}
                        onChange={(event) => setEditedCustomerNote(event.target.value)}
                        disabled={savingCustomerEdit}
                        className="min-h-[80px] text-sm border-zinc-200 rounded"
                      />
                    </Field>
                  </>}
                  {canManageCustomerPassport && <>
                    <div>
                      <label htmlFor="nasiya-edit-customer-passport-identifier" className="mb-1.5 block text-xs font-medium text-zinc-700">Pasport seriya/raqami</label>
                      <Input
                        id="nasiya-edit-customer-passport-identifier"
                        value={editedCustomerPassportIdentifier}
                        onChange={(event) => setEditedCustomerPassportIdentifier(formatPassportIdentifierInput(event.target.value))}
                        autoComplete="off"
                        spellCheck={false}
                        inputMode="text"
                        maxLength={10}
                        pattern="[A-Z]{2} [0-9]{7}"
                        placeholder={editedCustomerPassportMasked ? `${editedCustomerPassportMasked} — o'zgartirish uchun yangisini kiriting` : 'AA 1234567'}
                        disabled={savingCustomerEdit}
                        className="h-9 font-mono text-sm border-zinc-200 rounded"
                      />
                      <p className="mt-1 text-xs text-zinc-500">To&apos;liq raqam saqlangandan keyin qayta ko&apos;rsatilmaydi.</p>
                    </div>
                    <ImageSelectionField
                      inputId="nasiya-edit-customer-passport-image"
                      label={selectedCustomer?.hasPassportPhoto ? "Pasport rasmini almashtirish (ixtiyoriy)" : "Pasport rasmi (ixtiyoriy)"}
                      mode="single"
                      selection={customerEditPassportSelection}
                      disabled={savingCustomerEdit}
                      previewClassName="aspect-[4/3]"
                      help={selectedCustomer?.hasPassportPhoto
                        ? "Yangi rasm tanlanmasa, mavjud private rasm saqlanib qoladi. JPG, PNG yoki WEBP, 5 MB gacha."
                        : "Private saqlanadi; JPG, PNG yoki WEBP, 5 MB gacha."}
                    />
                  </>}
                  {canOverrideCustomerTrust && (
                    <div>
                      <label htmlFor="nasiya-edit-customer-trust" className="mb-1.5 block text-xs font-medium text-zinc-700">Ishonch darajasi</label>
                      <Select value={editedCustomerTrustOverride || 'AUTO'} onValueChange={(value) => setEditedCustomerTrustOverride(value === 'AUTO' ? '' : value as TrustTier)}>
                        <SelectTrigger id="nasiya-edit-customer-trust" className="h-9 text-sm border-zinc-200 rounded">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AUTO">Avtomatik hisoblash</SelectItem>
                          {(Object.keys(TRUST_TIER_LABELS) as TrustTier[]).map((tier) => (
                            <SelectItem key={tier} value={tier}>{TRUST_TIER_LABELS[tier]} (qo&apos;lda)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>}
              </div>
            </div>
            <DialogFooter className="mx-0 mb-0 gap-2 px-4 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={savingCustomerEdit || loadingCustomerEdit}
                onClick={() => setCustomerEditOpen(false)}
              >
                Bekor qilish
              </Button>
              <AsyncButton
                type="submit"
                pending={savingCustomerEdit}
                pendingLabel="Saqlanmoqda..."
                disabled={
                  loadingCustomerEdit ||
                  (canEditCustomer && (editedCustomerName.trim().length < 2 || !isValidPhone(editedCustomerPhone))) ||
                  (canManageCustomerPassport && customerEditPassportSelection.hasBlockingErrors) ||
                  (!canEditCustomer && !canManageCustomerPassport && !canOverrideCustomerTrust)
                }
              >
                Saqlash
              </AsyncButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
