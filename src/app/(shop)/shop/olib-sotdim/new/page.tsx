'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { navigateAfterMutation } from '@/lib/client-events'
import { Button } from '@/components/ui/button'
import { AsyncButton } from '@/components/ui/async-button'
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
import { ArrowLeft, Check } from 'lucide-react'
import type { PaymentMethod } from '@/lib/domain-types'

type CustomerPaymentMode = 'FULL' | 'PARTIAL' | 'LATER'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { CustomerCombobox, type CustomerPickerOption } from '@/components/shop/customer-combobox'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { calculateNasiyaAmounts, calculateNasiyaAmountsFromMonthlyPayment, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { isValidPassportIdentifier } from '@/lib/customer-passport'

type CustomerDealType = 'SALE' | 'NASIYA'

export default function NewOlibSotdimPage() {
  const { can } = useShopAccess()
  if (!can('OLIB_CREATE')) return <ShopAccessDenied />
  return <AuthorizedNewOlibSotdimPage />
}

function AuthorizedNewOlibSotdimPage() {
  const saleCommand = useLogicalCommandIdempotency()
  const router = useRouter()
  const { currency } = useShopCurrency()
  const { can, memberKind, enabledFeatures } = useShopAccess()
  const canSeeOwnerFinancials = memberKind === 'SHOP_OWNER'
  const canManageCustomerPassport = can('CUSTOMER_PASSPORT_MANAGE')
  const canOverrideCustomerTrust = can('CUSTOMER_TRUST_OVERRIDE')
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
  const [purchaseInputCurrency, setPurchaseInputCurrency] = useState<'UZS' | 'USD'>(currency.currency)
  const [supplierPaidNow, setSupplierPaidNow] = useState<boolean | null>(null)
  const [supplierPaymentMethod, setSupplierPaymentMethod] = useState<PaymentMethod | ''>('')
  const [supplierPaidDate, setSupplierPaidDate] = useState(today)
  const [supplierDueDate, setSupplierDueDate] = useState('')
  const [supplierReminderEnabled, setSupplierReminderEnabled] = useState(true)
  const [supplierInitialPaymentAmount, setSupplierInitialPaymentAmount] = useState('')
  const [supplierInitialSplit, setSupplierInitialSplit] = useState(false)
  const [supplierInitialSecondMethod, setSupplierInitialSecondMethod] = useState<PaymentMethod | ''>('')
  const [supplierInitialFirstPart, setSupplierInitialFirstPart] = useState('')
  const [supplierInitialSecondPart, setSupplierInitialSecondPart] = useState('')
  const [earlyReminder, setEarlyReminder] = useState(false)
  const [earlyReminderDays, setEarlyReminderDays] = useState('3')

  // Section 3 — customer ("kimga sotildi")
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerMode, setCustomerMode] = useState<'PICK' | 'EXISTING' | 'NEW'>('PICK')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPickerOption | null>(null)
  const [customerPhoneError, setCustomerPhoneError] = useState('')
  const [customerAdditionalPhones, setCustomerAdditionalPhones] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [customerPassportIdentifier, setCustomerPassportIdentifier] = useState('')
  const [customerTrustOverride, setCustomerTrustOverride] = useState<'' | 'NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'>('')
  const customerPhoneRef = useRef<HTMLInputElement>(null)

  // Section 4 — sale to the customer
  const [salePrice, setSalePrice] = useState('')
  const [customerInputCurrency, setCustomerInputCurrency] = useState<'UZS' | 'USD'>(currency.currency)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [customerSplitPayment, setCustomerSplitPayment] = useState(false)
  const [customerSplitMethod2, setCustomerSplitMethod2] = useState<PaymentMethod | ''>('')
  const [customerSplitAmount1, setCustomerSplitAmount1] = useState('')
  const [customerSplitAmount2, setCustomerSplitAmount2] = useState('')
  const [customerPaymentMode, setCustomerPaymentMode] = useState<CustomerPaymentMode | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialDate, setPartialDate] = useState('')
  const [customerReminderEnabled, setCustomerReminderEnabled] = useState(false)
  const [customerEarlyReminderEnabled, setCustomerEarlyReminderEnabled] = useState(false)
  const [customerEarlyReminderDays, setCustomerEarlyReminderDays] = useState('3')
  const [note, setNote] = useState('')
  const [customerDealType, setCustomerDealType] = useState<CustomerDealType>('SALE')
  const [nasiyaTotalAmount, setNasiyaTotalAmount] = useState('')
  const [nasiyaDownPayment, setNasiyaDownPayment] = useState('0')
  const [nasiyaMonths, setNasiyaMonths] = useState('6')
  const [nasiyaInterestPercent, setNasiyaInterestPercent] = useState('0')
  const [nasiyaMonthlyOverrideEnabled, setNasiyaMonthlyOverrideEnabled] = useState(false)
  const [nasiyaMonthlyPayment, setNasiyaMonthlyPayment] = useState('')
  const [nasiyaStartDate, setNasiyaStartDate] = useState(today)
  const [nasiyaPaymentMethod, setNasiyaPaymentMethod] = useState<PaymentMethod | ''>('')
  const [nasiyaEarlyReminder, setNasiyaEarlyReminder] = useState(false)
  const [nasiyaEarlyReminderDays, setNasiyaEarlyReminderDays] = useState('3')
  const passportSelection = useImageSelection({ mode: 'single', uploadEndpoint: '/api/uploads/passport', maxFiles: 1 })

  const nasiyaPreview = useMemo(() => {
    try {
      const totalAmount = Number(nasiyaTotalAmount)
      const downPayment = Number(nasiyaDownPayment || 0)
      const months = Number(nasiyaMonths)
      if (!(totalAmount > 0) || !(months >= 1)) return null
      const amounts = nasiyaMonthlyOverrideEnabled
        ? calculateNasiyaAmountsFromMonthlyPayment({ totalAmount, downPayment, months, monthlyPayment: Number(nasiyaMonthlyPayment), currency: customerInputCurrency })
        : calculateNasiyaAmounts({ totalAmount, downPayment, months, interestPercent: Number(nasiyaInterestPercent || 0), currency: customerInputCurrency })
      return { amounts, schedule: generatePaymentSchedule(new Date(`${nasiyaStartDate}T00:00:00`), months, amounts.finalNasiyaAmount, customerInputCurrency) }
    } catch {
      return null
    }
  }, [customerInputCurrency, nasiyaDownPayment, nasiyaInterestPercent, nasiyaMonthlyOverrideEnabled, nasiyaMonthlyPayment, nasiyaMonths, nasiyaStartDate, nasiyaTotalAmount])

  const fmtCurrency = (n: number, amountCurrency: 'UZS' | 'USD') => formatUserFacingMoney({ amount: n, amountCurrency, displayCurrency: amountCurrency, rate: currency.usdUzsRate })
  const fmtCustomer = (n: number) => fmtCurrency(n, customerInputCurrency)
  const fmtPurchase = (n: number) => fmtCurrency(n, purchaseInputCurrency)
  const fmtProfit = (n: number) => formatUserFacingMoney({ amount: n, amountCurrency: 'UZS', displayCurrency: currency.currency, rate: currency.usdUzsRate })
  const toUzs = (value: number, inputCurrency: 'UZS' | 'USD') => inputCurrency === 'USD' ? value * Number(currency.usdUzsRate || 0) : value

  const profit = toUzs(Number(salePrice || 0), customerInputCurrency) - toUzs(Number(purchasePrice || 0), purchaseInputCurrency)
  const priceWarning = purchasePrice && salePrice && profit < 0
  const customerPaidNow = customerPaymentMode === 'FULL' ? Number(salePrice || 0) : customerPaymentMode === 'PARTIAL' ? Number(partialAmount || 0) : 0
  const customerSplitValid = !customerSplitPayment || (
    customerPaymentMode !== 'LATER' && Boolean(paymentMethod) && Boolean(customerSplitMethod2) && paymentMethod !== customerSplitMethod2 &&
    Number(customerSplitAmount1) > 0 && Number(customerSplitAmount2) > 0 &&
    Math.abs(Number(customerSplitAmount1) + Number(customerSplitAmount2) - customerPaidNow) < (customerInputCurrency === 'UZS' ? 0.5 : 0.005)
  )
  const supplierInitialAmount = Number(supplierInitialPaymentAmount || 0)
  const supplierInitialSplitValid = !supplierInitialSplit || (
    supplierPaidNow === false && supplierInitialAmount > 0 && Boolean(supplierPaymentMethod) && Boolean(supplierInitialSecondMethod) &&
    supplierPaymentMethod !== supplierInitialSecondMethod && Number(supplierInitialFirstPart) > 0 && Number(supplierInitialSecondPart) > 0 &&
    Math.abs(Number(supplierInitialFirstPart) + Number(supplierInitialSecondPart) - supplierInitialAmount) < (purchaseInputCurrency === 'UZS' ? 0.5 : 0.005)
  )

  const customerIdentityValid = customerMode === 'EXISTING'
    ? Boolean(selectedCustomer)
    : customerMode === 'NEW' && customerName.trim().length >= 2 && isValidPhone(customerPhone)
  const saleTermsValid = customerDealType === 'SALE' &&
    salePrice.trim().length > 0 && Number(salePrice) > 0 && customerPaymentMode !== null &&
    (customerPaymentMode === 'LATER' || !!paymentMethod) &&
    customerSplitValid &&
    (customerPaymentMode === 'FULL' || partialDate.trim().length > 0) &&
    (customerPaymentMode !== 'PARTIAL' || (partialAmount.trim().length > 0 && Number(partialAmount) > 0)) &&
    (!customerReminderEnabled || !customerEarlyReminderEnabled || (Number(customerEarlyReminderDays) >= 1 && Number(customerEarlyReminderDays) <= 60))
  const nasiyaNeedsPassportPhoto = customerMode === 'NEW' || (customerMode === 'EXISTING' && !selectedCustomer?.hasPassportPhoto)
  const nasiyaTermsValid = customerDealType === 'NASIYA' && Boolean(nasiyaPreview) && Boolean(nasiyaPaymentMethod) &&
    Boolean(nasiyaStartDate) && (!nasiyaEarlyReminder || Number(nasiyaEarlyReminderDays) >= 1) &&
    (!nasiyaNeedsPassportPhoto || passportSelection.items.length === 1) &&
    (!customerPassportIdentifier.trim() || isValidPassportIdentifier(customerPassportIdentifier))
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
    (supplierPaidNow || Number(supplierInitialPaymentAmount || 0) === 0 || !!supplierPaymentMethod) &&
    (supplierPaidNow || Number(supplierInitialPaymentAmount || 0) < Number(purchasePrice || 0)) &&
    supplierInitialSplitValid &&
    (supplierPaidNow || supplierDueDate.trim().length > 0) &&
    (!earlyReminder || (Number(earlyReminderDays) >= 1 && Number(earlyReminderDays) <= 60)) &&
    customerIdentityValid &&
    (saleTermsValid || nasiyaTermsValid) &&
    !imageSelection.hasBlockingErrors && !passportSelection.hasBlockingErrors

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
    if ((purchaseInputCurrency === 'USD' || customerInputCurrency === 'USD') && !currency.usdUzsRate) {
      setSubmitError("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const paidFully = customerPaymentMode === 'FULL'
      const imageUrls = await imageSelection.uploadAll()
      const passportUploads = customerDealType === 'NASIYA' ? await passportSelection.uploadAll() : []
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
        supplierInitialPaymentAmount: !supplierPaidNow ? Number(supplierInitialPaymentAmount || 0) : undefined,
        supplierPaymentBreakdown: !supplierPaidNow && supplierInitialSplit ? [
          { method: supplierPaymentMethod, amount: Number(supplierInitialFirstPart) },
          { method: supplierInitialSecondMethod, amount: Number(supplierInitialSecondPart) },
        ] : undefined,
        ...(supplierPaidNow === false && Number(supplierInitialPaymentAmount || 0) > 0
          ? { supplierPaymentMethod }
          : {}),
        supplierPaidDate: supplierPaidNow ? supplierPaidDate : undefined,
        supplierDueDate: !supplierPaidNow ? supplierDueDate : undefined,
        supplierReminderEnabled: !supplierPaidNow ? supplierReminderEnabled : undefined,
        earlyReminderEnabled: !supplierPaidNow ? earlyReminder : undefined,
        earlyReminderDays: !supplierPaidNow && earlyReminder ? Number(earlyReminderDays) : undefined,
        customerMode: customerMode === 'EXISTING' ? 'EXISTING' as const : 'NEW' as const,
        customerId: selectedCustomer?.id,
        customerName: customerMode === 'NEW' ? customerName.trim() : undefined,
        customerPhone: customerMode === 'NEW' ? customerPhone.trim() : undefined,
        customerAdditionalPhones: customerMode === 'NEW' ? customerAdditionalPhones.split(',').map((value) => value.trim()).filter(Boolean) : undefined,
        customerNote: customerMode === 'NEW' ? customerNote.trim() || undefined : undefined,
        customerPassportIdentifier: customerMode === 'NEW' && canManageCustomerPassport ? customerPassportIdentifier.trim() || undefined : undefined,
        customerTrustOverride: customerMode === 'NEW' && canOverrideCustomerTrust ? customerTrustOverride || null : undefined,
        customerDealType,
        ...(customerDealType === 'SALE' ? {
          salePrice: Number(salePrice),
          paymentMethod: customerPaymentMode === 'LATER' || customerSplitPayment ? undefined : paymentMethod,
          paymentBreakdown: customerSplitPayment ? [
            { method: paymentMethod, amount: Number(customerSplitAmount1) },
            { method: customerSplitMethod2, amount: Number(customerSplitAmount2) },
          ] : undefined,
          paidFully,
          amountPaid: paidFully ? undefined : customerPaymentMode === 'LATER' ? 0 : Number(partialAmount),
          dueDate: paidFully ? undefined : partialDate,
          customerReminderEnabled: paidFully ? false : customerReminderEnabled,
          customerEarlyReminderEnabled: paidFully ? false : customerReminderEnabled && customerEarlyReminderEnabled,
          customerEarlyReminderDays: !paidFully && customerReminderEnabled && customerEarlyReminderEnabled ? Number(customerEarlyReminderDays) : undefined,
        } : {
          passportPhotoUrl: passportUploads[0],
          totalAmount: Number(nasiyaTotalAmount),
          downPayment: Number(nasiyaDownPayment || 0),
          months: Number(nasiyaMonths),
          interestPercent: Number(nasiyaInterestPercent || 0),
          monthlyPayment: nasiyaMonthlyOverrideEnabled ? Number(nasiyaMonthlyPayment) : undefined,
          useMonthlyPaymentOverride: nasiyaMonthlyOverrideEnabled,
          startDate: nasiyaStartDate,
          nasiyaPaymentMethod,
          customerEarlyReminderEnabled: nasiyaEarlyReminder,
          customerEarlyReminderDays: nasiyaEarlyReminder ? Number(nasiyaEarlyReminderDays) : undefined,
        }),
        note: note.trim() || undefined,
        inputCurrency: customerInputCurrency,
        purchaseInputCurrency,
        customerInputCurrency,
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
      await navigateAfterMutation(router, can('OLIB_VIEW') || can('SUPPLIER_PAYABLE_VIEW') || can('SUPPLIER_PAYMENT_RECORD') || can('SUPPLIER_PAYMENT_MARK_PAID') ? '/shop/olib-sotdim' : '/shop/yangi-operatsiya', {
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
              <div>
                <label htmlFor="olib-condition" className="block text-xs font-medium text-zinc-700 mb-1.5">Holati <span aria-hidden="true" className="text-red-500">*</span></label>
                <Select value={conditionCode} onValueChange={(value) => value && setConditionCode(value as 'NEW' | 'USED')}>
                  <SelectTrigger id="olib-condition" aria-required="true" className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">Ishlatilgan</SelectItem></SelectContent>
                </Select>
              </div>
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
                label="Qo‘shimcha IMEI"
                help="Ixtiyoriy, 15 ta raqam"
                error={secondaryImei && !/^\d{15}$/.test(secondaryImei) ? 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
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
              <Field label={`Olingan narx (${currencyLabel(purchaseInputCurrency)})`} required>
                <MoneyInput
                  currency={purchaseInputCurrency}
                  value={purchasePrice}
                  onChange={setPurchasePrice}
                  placeholder={purchaseInputCurrency === 'USD' ? '500.00' : '6500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              <Field label="Olish valyutasi" required>
                <Select value={purchaseInputCurrency} onValueChange={(value) => value && setPurchaseInputCurrency(value as 'UZS' | 'USD')}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="UZS">UZS — so&apos;m</SelectItem><SelectItem value="USD">USD — dollar</SelectItem></SelectContent>
                </Select>
              </Field>

              <fieldset className="sm:col-span-2 pt-2 border-t border-zinc-100">
                <legend className="block text-xs font-medium text-zinc-700 mb-2">
                  Yetkazib beruvchiga to&apos;lov <span aria-hidden="true" className="text-red-500">*</span>
                </legend>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={supplierPaidNow === true}
                    onClick={() => { setSupplierPaidNow(true); setSupplierInitialSplit(false) }}
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
                        <SelectItem value="CASH">Naqd pul</SelectItem>
                        <SelectItem value="CARD">Karta orqali</SelectItem>
                        <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem>
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
                  <Field label={`Hozir berilgan summa (${currencyLabel(purchaseInputCurrency)})`} help="Ixtiyoriy boshlang‘ich to‘lov">
                    <MoneyInput
                      currency={purchaseInputCurrency}
                      value={supplierInitialPaymentAmount}
                      onChange={setSupplierInitialPaymentAmount}
                      placeholder="0"
                      className="h-9 text-sm border-zinc-200 rounded"
                    />
                  </Field>
                  {Number(supplierInitialPaymentAmount || 0) > 0 && (
                    <div>
                      <label htmlFor="supplier-initial-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">Boshlang‘ich to‘lov usuli <span className="text-red-500">*</span></label>
                      <Select value={supplierPaymentMethod} onValueChange={(value) => value && setSupplierPaymentMethod(value as PaymentMethod)}>
                        <SelectTrigger id="supplier-initial-payment-method" className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Naqd pul</SelectItem>
                          <SelectItem value="CARD">Karta orqali</SelectItem>
                          <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem>
                          <SelectItem value="OTHER">Boshqa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {Number(supplierInitialPaymentAmount || 0) > 0 && <div className="sm:col-span-2 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <label htmlFor="olib-supplier-initial-split" className="flex items-center gap-2 text-sm text-zinc-700">
                      <input id="olib-supplier-initial-split" type="checkbox" checked={supplierInitialSplit} onChange={(event) => setSupplierInitialSplit(event.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
                      Boshlang‘ich to‘lovni ikki usulda berish
                    </label>
                    {supplierInitialSplit && <div className="grid gap-3 sm:grid-cols-3">
                      <Field label={`1-usul summasi (${currencyLabel(purchaseInputCurrency)})`} required><MoneyInput currency={purchaseInputCurrency} value={supplierInitialFirstPart} onChange={setSupplierInitialFirstPart} className="h-9" /></Field>
                      <Field label="Ikkinchi usul" required>
                        <Select value={supplierInitialSecondMethod} onValueChange={(value) => value && setSupplierInitialSecondMethod(value as PaymentMethod)}>
                          <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                          <SelectContent><SelectItem value="CASH">Naqd pul</SelectItem><SelectItem value="CARD">Karta</SelectItem><SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem><SelectItem value="OTHER">Boshqa</SelectItem></SelectContent>
                        </Select>
                      </Field>
                      <Field label={`2-usul summasi (${currencyLabel(purchaseInputCurrency)})`} required><MoneyInput currency={purchaseInputCurrency} value={supplierInitialSecondPart} onChange={setSupplierInitialSecondPart} className="h-9" /></Field>
                      {!supplierInitialSplitValid && <p className="text-xs text-red-600 sm:col-span-3">Ikki summa boshlang‘ich to‘lovga teng, usullar esa har xil bo‘lishi kerak.</p>}
                    </div>}
                  </div>}
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
              <Field label="Qo‘shimcha telefonlar" help="Vergul bilan ajrating" className="sm:col-span-2">
                <Input value={customerAdditionalPhones} onChange={(event) => setCustomerAdditionalPhones(event.target.value)} placeholder="+998 90…, +998 93…" className="h-9" />
              </Field>
              {canManageCustomerPassport && <Field label="Pasport seriya/raqami" error={customerPassportIdentifier.trim() && !isValidPassportIdentifier(customerPassportIdentifier) ? 'AA 1234567 formatida kiriting' : undefined}>
                <Input value={customerPassportIdentifier} onChange={(event) => setCustomerPassportIdentifier(event.target.value)} placeholder="AA 1234567" className="h-9" />
              </Field>}
              {canOverrideCustomerTrust && <Field label="Ishonch darajasi">
                <Select value={customerTrustOverride} onValueChange={(value) => setCustomerTrustOverride((value ?? '') as typeof customerTrustOverride)}>
                  <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Avtomatik" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW">Yangi</SelectItem><SelectItem value="LOW">Past</SelectItem><SelectItem value="MEDIUM">O‘rta</SelectItem><SelectItem value="HIGH">Yuqori</SelectItem><SelectItem value="VERY_HIGH">Juda yuqori</SelectItem>
                  </SelectContent>
                </Select>
              </Field>}
              <Field label="Mijoz haqida izoh" className="sm:col-span-2">
                <Textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} className="min-h-[60px]" />
              </Field>
              </div>}
            </div>
          </div>

          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">4. Mijozga berish turi</span>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2" role="radiogroup" aria-label="Mijozga berish turi">
              <button
                type="button"
                role="radio"
                aria-checked={customerDealType === 'SALE'}
                onClick={() => setCustomerDealType('SALE')}
                className={`rounded-xl border p-4 text-left transition-colors ${customerDealType === 'SALE' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
              >
                <span className="block font-semibold">Sotuv</span>
                <span className="mt-1 block text-xs opacity-75">To‘liq, qisman yoki keyinroq to‘lov</span>
              </button>
              {enabledFeatures.has('NASIYA') && <button
                type="button"
                role="radio"
                aria-checked={customerDealType === 'NASIYA'}
                onClick={() => setCustomerDealType('NASIYA')}
                className={`rounded-xl border p-4 text-left transition-colors ${customerDealType === 'NASIYA' ? 'border-blue-600 bg-blue-50 text-blue-950' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
              >
                <span className="block font-semibold">Nasiya</span>
                <span className="mt-1 block text-xs opacity-75">Boshlang‘ich to‘lov va oylik jadval</span>
              </button>}
            </div>
          </div>

          {/* Section 4: Prices / payment to customer */}
          <div className="border border-zinc-200 rounded overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span className="text-sm font-semibold text-zinc-900">5. {customerDealType === 'SALE' ? 'Sotuv narxi va to‘lov' : 'Nasiya shartlari'}</span>
            </div>
            <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Mijoz shartnomasi valyutasi" required className="sm:col-span-2">
                <Select value={customerInputCurrency} onValueChange={(value) => value && setCustomerInputCurrency(value as 'UZS' | 'USD')}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="UZS">UZS — so&apos;m</SelectItem><SelectItem value="USD">USD — dollar</SelectItem></SelectContent>
                </Select>
              </Field>
              {customerDealType === 'SALE' ? <>
              <Field label={`Sotilgan narx (${currencyLabel(customerInputCurrency)})`} required>
                <MoneyInput
                  currency={customerInputCurrency}
                  value={salePrice}
                  onChange={setSalePrice}
                  placeholder={customerInputCurrency === 'USD' ? '600.00' : '7500000'}
                  className="h-9 text-sm border-zinc-200 rounded"
                />
              </Field>
              {customerPaymentMode !== 'LATER' && <div>
                <label htmlFor="customer-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">
                  {customerSplitPayment ? 'Birinchi to‘lov usuli' : 'To‘lov usuli'} <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger id="customer-payment-method" aria-required="true" className="h-9 w-full text-sm border-zinc-200 rounded">
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Naqd pul</SelectItem>
                    <SelectItem value="CARD">Karta orqali</SelectItem>
                    <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem>
                    <SelectItem value="OTHER">Boshqa</SelectItem>
                  </SelectContent>
                </Select>
              </div>}

              {customerPaymentMode !== null && customerPaymentMode !== 'LATER' && (
                <div className="sm:col-span-2 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <label htmlFor="olib-customer-split" className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      id="olib-customer-split"
                      type="checkbox"
                      checked={customerSplitPayment}
                      onChange={(event) => setCustomerSplitPayment(event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Ikki usulda to‘lash
                  </label>
                  {customerSplitPayment && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label={`1-usul summasi (${currencyLabel(customerInputCurrency)})`} required>
                        <MoneyInput currency={customerInputCurrency} value={customerSplitAmount1} onChange={setCustomerSplitAmount1} className="h-9" />
                      </Field>
                      <Field label="Ikkinchi usul" required>
                        <Select value={customerSplitMethod2} onValueChange={(value) => value && setCustomerSplitMethod2(value as PaymentMethod)}>
                          <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CASH">Naqd pul</SelectItem><SelectItem value="CARD">Karta orqali</SelectItem>
                            <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem><SelectItem value="OTHER">Boshqa</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={`2-usul summasi (${currencyLabel(customerInputCurrency)})`} required>
                        <MoneyInput currency={customerInputCurrency} value={customerSplitAmount2} onChange={setCustomerSplitAmount2} className="h-9" />
                      </Field>
                      <p className={`text-xs sm:col-span-3 ${customerSplitValid ? 'text-zinc-500' : 'text-red-600'}`}>
                        Ikki summa jami hozir olinadigan {fmtCustomer(customerPaidNow)} ga teng, usullar esa har xil bo‘lishi kerak.
                      </p>
                    </div>
                  )}
                </div>
              )}

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
                    To‘liq to‘lov
                  </button>
                  <button
                    type="button"
                    aria-pressed={customerPaymentMode === 'PARTIAL'}
                    onClick={() => setCustomerPaymentMode('PARTIAL')}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${customerPaymentMode === 'PARTIAL' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Qisman to‘lov
                  </button>
                  <button
                    type="button"
                    aria-pressed={customerPaymentMode === 'LATER'}
                    onClick={() => { setCustomerPaymentMode('LATER'); setPartialAmount(''); setPaymentMethod(''); setCustomerSplitPayment(false) }}
                    className={`px-4 py-2 text-sm rounded border transition-colors ${customerPaymentMode === 'LATER' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    Keyinroq to‘lash
                  </button>
                </div>
              </fieldset>

              {(customerPaymentMode === 'PARTIAL' || customerPaymentMode === 'LATER') && (
                <>
                  {customerPaymentMode === 'PARTIAL' && <Field label={<>Qancha to&apos;ladi ({currencyLabel(customerInputCurrency)})</>} required>
                    <MoneyInput
                      currency={customerInputCurrency}
                      value={partialAmount}
                      onChange={setPartialAmount}
                      placeholder={customerInputCurrency === 'USD' ? '200.00' : '2500000'}
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
                  {customerReminderEnabled && <div className="sm:col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="customer-early-reminder"
                      checked={customerEarlyReminderEnabled}
                      onChange={(event) => setCustomerEarlyReminderEnabled(event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    <label htmlFor="customer-early-reminder" className="text-sm text-zinc-700 cursor-pointer">
                      Muddatdan oldin eslatish
                    </label>
                  </div>}
                  {customerReminderEnabled && customerEarlyReminderEnabled && (
                    <Field label="Necha kun oldin?" required>
                      <Input type="number" min={1} max={60} value={customerEarlyReminderDays} onChange={(event) => setCustomerEarlyReminderDays(event.target.value)} className="h-9" />
                    </Field>
                  )}
                </>
              )}

              </> : <>
                <Field label={`Qurilma narxi (${currencyLabel(customerInputCurrency)})`} required>
                  <MoneyInput currency={customerInputCurrency} value={nasiyaTotalAmount} onChange={setNasiyaTotalAmount} placeholder={customerInputCurrency === 'USD' ? '650.00' : '8000000'} className="h-9 text-sm border-zinc-200 rounded" />
                </Field>
                <Field label={`Boshlang‘ich to‘lov (${currencyLabel(customerInputCurrency)})`} required>
                  <MoneyInput currency={customerInputCurrency} value={nasiyaDownPayment} onChange={setNasiyaDownPayment} placeholder="0" className="h-9 text-sm border-zinc-200 rounded" />
                </Field>
                <Field label="Oylar soni" required>
                  <Input type="number" min={1} max={24} value={nasiyaMonths} onChange={(event) => setNasiyaMonths(event.target.value)} className="h-9 text-sm border-zinc-200 rounded" />
                </Field>
                <Field label="Boshlanish sanasi" required>
                  <DateInput value={nasiyaStartDate} onValueChange={setNasiyaStartDate} className="h-9 text-sm border-zinc-200 rounded" />
                </Field>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <input id="olib-monthly-override" type="checkbox" checked={nasiyaMonthlyOverrideEnabled} onChange={(event) => setNasiyaMonthlyOverrideEnabled(event.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
                  <label htmlFor="olib-monthly-override" className="text-sm text-zinc-700">Oylik to‘lovni o‘zim belgilayman</label>
                </div>
                {nasiyaMonthlyOverrideEnabled ? (
                  <Field label={`Oylik to‘lov (${currencyLabel(customerInputCurrency)})`} required>
                    <MoneyInput currency={customerInputCurrency} value={nasiyaMonthlyPayment} onChange={setNasiyaMonthlyPayment} className="h-9 text-sm border-zinc-200 rounded" />
                  </Field>
                ) : (
                  <Field label="Nasiya foizi (%)" required>
                    <Input type="number" min={0} max={100} value={nasiyaInterestPercent} onChange={(event) => setNasiyaInterestPercent(event.target.value)} className="h-9 text-sm border-zinc-200 rounded" />
                  </Field>
                )}
                <div>
                  <label htmlFor="nasiya-payment-method" className="mb-1.5 block text-xs font-medium text-zinc-700">Boshlang‘ich to‘lov usuli <span className="text-red-500">*</span></label>
                  <Select value={nasiyaPaymentMethod} onValueChange={(value) => value && setNasiyaPaymentMethod(value as PaymentMethod)}>
                    <SelectTrigger id="nasiya-payment-method" className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Naqd pul</SelectItem>
                      <SelectItem value="CARD">Karta orqali</SelectItem>
                      <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem>
                      <SelectItem value="OTHER">Boshqa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <ImageSelectionField
                    inputId="olib-passport-photo"
                    label={customerMode === 'NEW' ? 'Mijoz pasport rasmi' : 'Pasport rasmi (mijozda mavjud bo‘lmasa)'}
                    mode="single"
                    selection={passportSelection}
                    disabled={submitting}
                  />
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <input id="olib-nasiya-early" type="checkbox" checked={nasiyaEarlyReminder} onChange={(event) => setNasiyaEarlyReminder(event.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
                  <label htmlFor="olib-nasiya-early" className="text-sm text-zinc-700">Muddatdan oldin eslatish</label>
                </div>
                {nasiyaEarlyReminder && (
                  <Field label="Necha kun oldin?" required>
                    <Input type="number" min={1} max={60} value={nasiyaEarlyReminderDays} onChange={(event) => setNasiyaEarlyReminderDays(event.target.value)} className="h-9 text-sm border-zinc-200 rounded" />
                  </Field>
                )}
                {nasiyaPreview && (
                  <div className="sm:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div><span className="block text-xs text-blue-700">Moliyalashtiriladi</span><strong>{fmtCustomer(nasiyaPreview.amounts.baseRemainingAmount)}</strong></div>
                      <div><span className="block text-xs text-blue-700">Nasiya jami</span><strong>{fmtCustomer(nasiyaPreview.amounts.finalNasiyaAmount)}</strong></div>
                      <div><span className="block text-xs text-blue-700">Oylik</span><strong>{fmtCustomer(nasiyaPreview.amounts.monthlyPayment)}</strong></div>
                      <div><span className="block text-xs text-blue-700">Oxirgi to‘lov</span><strong>{fmtCustomer(nasiyaPreview.schedule.at(-1)?.expectedAmount ?? 0)}</strong></div>
                    </div>
                    <div className="mt-3 max-h-44 space-y-1 overflow-auto border-t border-blue-200 pt-3 text-xs">
                      {nasiyaPreview.schedule.map((item) => (
                        <div key={item.monthNumber} className="flex justify-between gap-3"><span>{item.monthNumber}-oy · {new Date(item.dueDate).toLocaleDateString('uz-UZ')}</span><strong>{fmtCustomer(item.expectedAmount)}</strong></div>
                      ))}
                    </div>
                  </div>
                )}
              </>}

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
                  {model} {color && `· ${color}`} {storage && `· ${storage}${storageUnit}`} · {conditionCode === 'NEW' ? 'Yangi' : 'Ishlatilgan'}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">Asosiy IMEI: {imei}{secondaryImei && ` · Qo‘shimcha IMEI: ${secondaryImei}`}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 mb-1.5">Kimdan olindi</div>
                <div className="text-zinc-900">
                  {supplierName} · {supplierPhone}
                </div>
                {supplierLocation && <div className="text-xs text-zinc-500 mt-0.5">{supplierLocation}</div>}
                <div className="text-xs text-zinc-500 mt-0.5">
                  Olingan narx: {fmtPurchase(Number(purchasePrice))} · {supplierPaidNow ? "Hozir to'landi" : `Keyin to'lanadi (${supplierDueDate})`}
                </div>
                {!supplierPaidNow && Number(supplierInitialPaymentAmount || 0) > 0 && <div className="text-xs text-zinc-500 mt-0.5">Hozir berildi: {fmtPurchase(Number(supplierInitialPaymentAmount))}</div>}
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 mb-1.5">Mijozga {customerDealType === 'SALE' ? 'sotuv' : 'nasiya'}</div>
                <div className="text-zinc-900">
                  {customerName} · {customerPhone}
                </div>
                {customerDealType === 'SALE' ? (
                  <div className="text-xs text-zinc-500 mt-0.5">Sotilgan narx: {fmtCustomer(Number(salePrice))}</div>
                ) : nasiyaPreview && (
                  <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
                    <div>Qurilma narxi: {fmtCustomer(Number(nasiyaTotalAmount))} · Boshlang‘ich: {fmtCustomer(Number(nasiyaDownPayment || 0))}</div>
                    <div>{nasiyaMonths} oy · Oylik {fmtCustomer(nasiyaPreview.amounts.monthlyPayment)} · Jami {fmtCustomer(nasiyaPreview.amounts.finalNasiyaAmount)}</div>
                  </div>
                )}
              </div>
              {canSeeOwnerFinancials && customerDealType === 'SALE' && (
                <div className="pt-3 border-t border-zinc-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-500">{supplierPaidNow ? 'Foyda' : 'Kutilayotgan foyda'}</span>
                  <span className={`text-base font-bold ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtProfit(profit)}</span>
                </div>
              )}
              {canSeeOwnerFinancials && customerDealType === 'SALE' && !supplierPaidNow && (
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
            <AsyncButton
              type="button"
              pending={submitting}
              pendingLabel="Saqlanmoqda..."
              onClick={handleSave}
              className="flex-1 h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
            >
              <Check size={15} />
              Olib-sotdim {customerDealType === 'NASIYA' ? 'nasiyasini' : 'sotuvini'} saqlash
            </AsyncButton>
          </div>
        </div>
      )}
    </div>
  )
}
