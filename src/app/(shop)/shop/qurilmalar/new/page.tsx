'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AsyncButton } from '@/components/ui/async-button'
import { Input } from '@/components/ui/input'
import { StorageInput } from '@/components/ui/storage-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyLabel } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { ArrowLeft } from 'lucide-react'
import { navigateAfterMutation } from '@/lib/client-events'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { patchDeviceUpsert } from '@/lib/device-query-cache'
import type { DeviceListItem } from '@/lib/device-list-contract'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'

interface FormData {
  model: string
  color: string
  storage: string
  storageUnit: 'GB' | 'TB'
  conditionCode: 'NEW' | 'USED' | ''
  battery: string
  purchasePrice: string
  imei: string
  secondaryImei: string
  supplierName: string
  supplierPhone: string
  purchaseSettlement: 'PAID_NOW' | 'PAY_LATER'
  supplierDueDate: string
  supplierInitialPaymentAmount: string
  supplierPaymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
  supplierSplitPayment: boolean
  supplierSecondPaymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
  supplierFirstPaymentAmount: string
  supplierSecondPaymentAmount: string
  supplierReminderEnabled: boolean
  earlyReminderEnabled: boolean
  earlyReminderDays: string
  note: string
}

export default function NewDevicePage() {
  const { can } = useShopAccess()
  if (!can('DEVICE_CREATE') && !can('DEVICE_PURCHASE_ON_CREDIT')) return <ShopAccessDenied />
  return <AuthorizedNewDevicePage />
}

function AuthorizedNewDevicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = useShopAccess()
  const queryClient = useQueryClient()
  const queryScope = useAuthenticatedQueryScope()
  const { currency, currencyError } = useShopCurrency()
  const canCreatePaidNow = can('DEVICE_CREATE')
  const canCreatePayLater = can('DEVICE_PURCHASE_ON_CREDIT')
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [form, setForm] = useState<FormData>({
    model: '',
    color: '',
    storage: '',
    storageUnit: 'GB',
    conditionCode: '',
    battery: '',
    purchasePrice: '',
    imei: '',
    secondaryImei: '',
    supplierName: '',
    supplierPhone: '',
    purchaseSettlement: canCreatePaidNow ? 'PAID_NOW' : 'PAY_LATER',
    supplierDueDate: '',
    supplierInitialPaymentAmount: '',
    supplierPaymentMethod: 'CASH',
    supplierSplitPayment: false,
    supplierSecondPaymentMethod: 'CARD',
    supplierFirstPaymentAmount: '',
    supplierSecondPaymentAmount: '',
    supplierReminderEnabled: true,
    earlyReminderEnabled: false,
    earlyReminderDays: '3',
    note: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const imageSelection = useImageSelection({
    mode: 'multiple',
    uploadEndpoint: '/api/uploads/device',
    maxFiles: 10,
  })
  const openedFromNewOperation = searchParams.get('from') === 'yangi-operatsiya'
  const backHref = openedFromNewOperation ? '/shop/yangi-operatsiya' : '/shop/qurilmalar'
  const backLabel = openedFromNewOperation ? 'Orqaga qaytish' : 'Qurilmalarga qaytish'

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const supplierInitialPayment = Number(form.supplierInitialPaymentAmount || 0)
  const supplierSplitValid = !form.supplierSplitPayment || (
    supplierInitialPayment > 0 &&
    form.supplierPaymentMethod !== form.supplierSecondPaymentMethod &&
    Number(form.supplierFirstPaymentAmount) > 0 &&
    Number(form.supplierSecondPaymentAmount) > 0 &&
    Math.abs(Number(form.supplierFirstPaymentAmount) + Number(form.supplierSecondPaymentAmount) - supplierInitialPayment) < (currency.currency === 'UZS' ? 0.5 : 0.005)
  )
  const isPayLaterValid = form.purchaseSettlement === 'PAID_NOW' || (
    canCreatePayLater && form.supplierName.trim().length >= 2 && Boolean(form.supplierPhone) && Boolean(form.supplierDueDate) &&
    supplierInitialPayment < Number(form.purchasePrice || 0) && supplierSplitValid &&
    (!form.earlyReminderEnabled || (Number(form.earlyReminderDays) >= 1 && Number(form.earlyReminderDays) <= 60))
  )
  const isValid = form.model.trim() && form.color.trim() && form.storage.trim() && form.conditionCode && form.purchasePrice.trim() && /^\d{15}$/.test(form.imei) && (!form.secondaryImei || /^\d{15}$/.test(form.secondaryImei)) && isPayLaterValid && !imageSelection.hasBlockingErrors

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || loading) return
    setLoading(true)
    setError('')
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setError("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      setLoading(false)
      return
    }
    try {
      const imageUrls = await imageSelection.uploadAll()
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(form.purchaseSettlement === 'PAY_LATER' ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          model: form.model,
          color: form.color,
          storageAmount: Number(form.storage),
          storageUnit: form.storageUnit,
          conditionCode: form.conditionCode,
          batteryHealth: form.battery ? Number(form.battery) : undefined,
          purchasePrice: Number(form.purchasePrice),
          inputCurrency: currency.currency,
          imei: form.imei,
          secondaryImei: form.secondaryImei || undefined,
          supplierName: form.supplierName || undefined,
          supplierPhone: form.supplierPhone || undefined,
          purchaseSettlement: form.purchaseSettlement,
          supplierDueDate: form.purchaseSettlement === 'PAY_LATER' ? form.supplierDueDate : undefined,
          supplierInitialPaymentAmount: form.purchaseSettlement === 'PAY_LATER' ? Number(form.supplierInitialPaymentAmount || 0) : undefined,
          supplierPaymentMethod: form.purchaseSettlement === 'PAY_LATER' && Number(form.supplierInitialPaymentAmount || 0) > 0
            ? form.supplierPaymentMethod
            : undefined,
          supplierPaymentBreakdown: form.purchaseSettlement === 'PAY_LATER' && supplierInitialPayment > 0 && form.supplierSplitPayment
            ? [
                { method: form.supplierPaymentMethod, amount: Number(form.supplierFirstPaymentAmount) },
                { method: form.supplierSecondPaymentMethod, amount: Number(form.supplierSecondPaymentAmount) },
              ]
            : undefined,
          supplierReminderEnabled: form.purchaseSettlement === 'PAY_LATER' ? form.supplierReminderEnabled : undefined,
          earlyReminderEnabled: form.purchaseSettlement === 'PAY_LATER' && form.supplierReminderEnabled ? form.earlyReminderEnabled : false,
          earlyReminderDays: form.purchaseSettlement === 'PAY_LATER' && form.supplierReminderEnabled && form.earlyReminderEnabled ? Number(form.earlyReminderDays) : undefined,
          note: form.note || undefined,
          imageUrls,
        }),
      })
      const json = await res.json() as {
        success?: boolean
        error?: string
        data?: { id: string; item: DeviceListItem; changeCursor: string }
      }
      if (res.ok && json.success) {
        if (json.data?.item) patchDeviceUpsert(queryClient, queryScope, json.data.item)
        await navigateAfterMutation(router, can('INVENTORY_VIEW') ? '/shop/qurilmalar' : '/shop/yangi-operatsiya', {
          kind: 'device.created',
          deviceId: json.data?.id,
        })
      } else {
        setError(json.error || 'Saqlashda xatolik yuz berdi')
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Saqlashda xatolik yuz berdi')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        {backLabel}
      </Link>

      <div>
        <h1 className="text-xl font-bold text-zinc-900">Yangi qurilma qo'shish</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Omborga yangi qurilma kiriting</p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}
      {currencyError && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-3">{currencyError}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Asosiy ma'lumotlar</span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Field label="Model" required>
              <Input
                value={form.model}
                onChange={set('model')}
                placeholder="iPhone 14 Pro"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field label="Rang" required>
              <Input
                value={form.color}
                onChange={set('color')}
                placeholder="Qora, Oq, Ko'k..."
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <StorageInput
              id="device-storage"
              amount={form.storage}
              unit={form.storageUnit}
              onAmountChange={(value) => setForm((prev) => ({ ...prev, storage: value }))}
              onUnitChange={(value) => setForm((prev) => ({ ...prev, storageUnit: value }))}
              required
              inputClassName="h-9 rounded"
            />
            <Field label="Akkumulyator %">
              <Input
                type="number"
                min="1"
                max="100"
                value={form.battery}
                onChange={set('battery')}
                placeholder="85"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field label={`Sotib olingan narx (${currencyLabel(currency.currency)})`} required>
              <MoneyInput
                currency={currency.currency}
                value={form.purchasePrice}
                onChange={(v) => setForm((prev) => ({ ...prev, purchasePrice: v }))}
                placeholder={currency.currency === 'USD' ? '600.00' : '7500000'}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field
              label="Asosiy IMEI"
              required
              help="15 ta raqam"
              error={form.imei && !/^\d{15}$/.test(form.imei) ? 'IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
            >
              <Input
                value={form.imei}
                onChange={set('imei')}
                placeholder="351234560012345"
                inputMode="numeric"
                maxLength={15}
                className="h-9 text-sm border-zinc-200 rounded font-mono"
              />
            </Field>
            <Field
              label="Qo‘shimcha IMEI"
              help="Ixtiyoriy, 15 ta raqam"
              error={form.secondaryImei && !/^\d{15}$/.test(form.secondaryImei) ? 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak' : undefined}
            >
              <Input value={form.secondaryImei} onChange={set('secondaryImei')} placeholder="351234560012346" inputMode="numeric" maxLength={15} className="h-9 text-sm border-zinc-200 rounded font-mono" />
            </Field>
            <div>
              <label htmlFor="device-condition" className="mb-1.5 block text-xs font-medium text-zinc-700">
                Holati <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <Select value={form.conditionCode} onValueChange={(value) => value && setForm((prev) => ({ ...prev, conditionCode: value as 'NEW' | 'USED' }))}>
                <SelectTrigger id="device-condition" aria-required="true" className="h-9 w-full"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">Ishlatilgan</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Yetkazib beruvchi</span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className="mb-2 block text-xs font-medium text-zinc-700">Xarid bo‘yicha to‘lov</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Xarid to‘lov turi">
                {canCreatePaidNow && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.purchaseSettlement === 'PAID_NOW'}
                    onClick={() => setForm((prev) => ({ ...prev, purchaseSettlement: 'PAID_NOW' }))}
                    className={`rounded-lg border px-3 py-3 text-left text-sm ${form.purchaseSettlement === 'PAID_NOW' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700'}`}
                  >
                    <span className="block font-semibold">Hozir to‘langan</span>
                    <span className="mt-0.5 block text-xs opacity-75">Yetkazib beruvchi qarzi yaratilmaydi</span>
                  </button>
                )}
                {canCreatePayLater && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.purchaseSettlement === 'PAY_LATER'}
                    onClick={() => setForm((prev) => ({ ...prev, purchaseSettlement: 'PAY_LATER' }))}
                    className={`rounded-lg border px-3 py-3 text-left text-sm ${form.purchaseSettlement === 'PAY_LATER' ? 'border-amber-500 bg-amber-50 text-amber-950' : 'border-zinc-200 bg-white text-zinc-700'}`}
                  >
                    <span className="block font-semibold">Keyin to‘lanadi</span>
                    <span className="mt-0.5 block text-xs opacity-75">Qarzlarimda yetkazib beruvchi qarzi ochiladi</span>
                  </button>
                )}
              </div>
            </div>
            <Field label="Yetkazib beruvchi ismi">
              <Input
                value={form.supplierName}
                onChange={set('supplierName')}
                placeholder="To'liq ism"
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            <Field label="Yetkazib beruvchi tel">
              <PhoneInput
                value={form.supplierPhone}
                onChange={(supplierPhone) => setForm((prev) => ({ ...prev, supplierPhone }))}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </Field>
            {form.purchaseSettlement === 'PAY_LATER' && (
              <>
                <Field label="To‘lov muddati" required>
                  <Input type="date" value={form.supplierDueDate} onChange={set('supplierDueDate')} className="h-9 text-sm border-zinc-200 rounded" />
                </Field>
                <Field label={`Hozir berilgan summa (${currencyLabel(currency.currency)})`} help="Ixtiyoriy boshlang‘ich to‘lov">
                  <MoneyInput currency={currency.currency} value={form.supplierInitialPaymentAmount} onChange={(value) => setForm((prev) => ({ ...prev, supplierInitialPaymentAmount: value }))} className="h-9 text-sm border-zinc-200 rounded" />
                </Field>
                {supplierInitialPayment > 0 && (<>
                  <div className="sm:col-span-2">
                    <label htmlFor="supplier-payment-method" className="mb-1.5 block text-xs font-medium text-zinc-700">To‘lov usuli</label>
                    <Select value={form.supplierPaymentMethod} onValueChange={(value) => value && setForm((prev) => ({ ...prev, supplierPaymentMethod: value as FormData['supplierPaymentMethod'] }))}>
                      <SelectTrigger id="supplier-payment-method" className="h-9 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Naqd pul</SelectItem>
                        <SelectItem value="CARD">Karta</SelectItem>
                        <SelectItem value="TRANSFER">O‘tkazma</SelectItem>
                        <SelectItem value="OTHER">Boshqa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label htmlFor="device-supplier-split" className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
                    <input id="device-supplier-split" type="checkbox" checked={form.supplierSplitPayment} onChange={(event) => setForm((prev) => ({ ...prev, supplierSplitPayment: event.target.checked }))} className="h-4 w-4 rounded border-zinc-300" />
                    Boshlang‘ich to‘lovni ikki usulda berish
                  </label>
                  {form.supplierSplitPayment && <div className="grid gap-3 rounded-lg border border-zinc-200 p-3 sm:col-span-2 sm:grid-cols-2">
                    <Field label={`1-usul summasi (${currencyLabel(currency.currency)})`} required>
                      <MoneyInput currency={currency.currency} value={form.supplierFirstPaymentAmount} onChange={(value) => setForm((prev) => ({ ...prev, supplierFirstPaymentAmount: value }))} className="h-9" />
                    </Field>
                    <div>
                      <label htmlFor="device-supplier-second-method" className="mb-1.5 block text-xs font-medium text-zinc-700">Ikkinchi usul</label>
                      <Select value={form.supplierSecondPaymentMethod} onValueChange={(value) => value && setForm((prev) => ({ ...prev, supplierSecondPaymentMethod: value as FormData['supplierSecondPaymentMethod'] }))}>
                        <SelectTrigger id="device-supplier-second-method" className="h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Naqd pul</SelectItem>
                          <SelectItem value="CARD">Karta</SelectItem>
                          <SelectItem value="TRANSFER">O‘tkazma</SelectItem>
                          <SelectItem value="OTHER">Boshqa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label={`2-usul summasi (${currencyLabel(currency.currency)})`} required>
                      <MoneyInput currency={currency.currency} value={form.supplierSecondPaymentAmount} onChange={(value) => setForm((prev) => ({ ...prev, supplierSecondPaymentAmount: value }))} className="h-9" />
                    </Field>
                    <p className={`text-xs sm:col-span-2 ${supplierSplitValid ? 'text-zinc-500' : 'text-red-600'}`}>
                      Ikki usul har xil bo‘lishi va summalar jami boshlang‘ich to‘lovga teng bo‘lishi kerak.
                    </p>
                  </div>}
                </>)}
                <label htmlFor="device-supplier-reminder" className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
                  <input id="device-supplier-reminder" type="checkbox" checked={form.supplierReminderEnabled} onChange={(event) => setForm((prev) => ({ ...prev, supplierReminderEnabled: event.target.checked }))} className="h-4 w-4 rounded border-zinc-300" />
                  To‘lov muddati haqida eslatish
                </label>
                {form.supplierReminderEnabled && <label htmlFor="device-supplier-early-reminder" className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
                  <input id="device-supplier-early-reminder" type="checkbox" checked={form.earlyReminderEnabled} onChange={(event) => setForm((prev) => ({ ...prev, earlyReminderEnabled: event.target.checked }))} className="h-4 w-4 rounded border-zinc-300" />
                  Muddatdan oldin eslatish
                </label>}
                {form.supplierReminderEnabled && form.earlyReminderEnabled && <Field label="Necha kun oldin?" required>
                  <Input type="number" min={1} max={60} value={form.earlyReminderDays} onChange={set('earlyReminderDays')} className="h-9" />
                </Field>}
              </>
            )}
          </div>
        </div>

        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Qo'shimcha</span>
          </div>
          <div className="p-4 space-y-4">
            <ImageSelectionField
              inputId="device-images"
              label="Qurilma rasmlari"
              mode="multiple"
              selection={imageSelection}
              disabled={loading}
            />

            <Field label="Izoh">
              <Textarea
                value={form.note}
                onChange={set('note')}
                placeholder="Qurilma haqida qo'shimcha ma'lumot..."
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </Field>
          </div>
        </div>

        <AsyncButton
          type="submit"
          disabled={!isValid}
          pending={loading}
          pendingLabel="Saqlanmoqda..."
          className="w-full h-10 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded disabled:opacity-40"
        >
          Qurilmani saqlash
        </AsyncButton>
      </form>
    </div>
  )
}
