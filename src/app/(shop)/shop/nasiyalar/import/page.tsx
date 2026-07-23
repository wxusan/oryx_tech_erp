'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AsyncButton } from '@/components/ui/async-button'
import { Input } from '@/components/ui/input'
import { StorageInput } from '@/components/ui/storage-input'
import { Field } from '@/components/ui/field'
import { DateInput } from '@/components/ui/date-input'
import { PhoneInput } from '@/components/ui/phone-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { convertUsdToUzs, currencyLabel, formatMoneyByCurrency } from '@/lib/currency'
import { uzDate } from '@/lib/dates'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { navigateAfterMutation } from '@/lib/client-events'
import { isValidPhone } from '@/lib/phone'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { ImageSelectionField, useImageSelection } from '@/components/ui/image-selection-field'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'

function fmt(n: number, currency?: ReturnType<typeof useShopCurrency>['currency']) {
  if (currency) return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
  return Number(n).toLocaleString('ru-RU')
}

function addMonths(date: Date, months: number) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

/** Preview of the future-only schedule (mirrors server generateImportSchedule). */
function previewSchedule(remainingDebt: number, monthlyPayment: number, nextPaymentDate: Date) {
  if (!(remainingDebt > 0) || !(monthlyPayment > 0) || Number.isNaN(nextPaymentDate.getTime())) return null
  const total = Math.round(remainingDebt)
  const monthly = Math.round(monthlyPayment)
  const count = Math.ceil(total / monthly)
  const lastAmount = total - monthly * (count - 1)
  return {
    count,
    lastAmount,
    firstDate: nextPaymentDate,
    lastDate: addMonths(nextPaymentDate, count - 1),
  }
}

export default function ImportNasiyaPage() {
  const { can } = useShopAccess()
  if (!can('IMPORT_OLD_NASIYA')) return <ShopAccessDenied />
  return <AuthorizedImportNasiyaPage />
}

function AuthorizedImportNasiyaPage() {
  const router = useRouter()
  const { can } = useShopAccess()
  const { currency } = useShopCurrency()
  const importCommand = useLogicalCommandIdempotency()
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    deviceModel: '',
    imei: '',
    secondaryImei: '',
    storage: '',
    storageUnit: 'GB' as 'GB' | 'TB',
    conditionCode: '' as '' | 'NEW' | 'USED',
    color: '',
    batteryHealth: '',
    originalTotalAmount: '',
    alreadyPaidBeforeImport: '',
    remainingDebt: '',
    monthlyPayment: '',
    nextPaymentDate: '',
    originalSaleDate: '',
    importNote: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const passportSelection = useImageSelection({
    mode: 'single',
    uploadEndpoint: '/api/uploads/passport',
  })

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const moneyToUzs = useCallback(
    (value: string) => {
      const amount = Number(value) || 0
      return currency.currency === 'USD' && currency.usdUzsRate
        ? convertUsdToUzs(amount, currency.usdUzsRate)
        : amount
    },
    [currency.currency, currency.usdUzsRate],
  )

  const remainingDebtUzs = moneyToUzs(form.remainingDebt)
  const monthlyPaymentUzs = moneyToUzs(form.monthlyPayment)

  const preview = useMemo(
    () =>
      previewSchedule(
        remainingDebtUzs,
        monthlyPaymentUzs,
        form.nextPaymentDate ? new Date(form.nextPaymentDate) : new Date(NaN),
      ),
    [remainingDebtUzs, monthlyPaymentUzs, form.nextPaymentDate],
  )

  const canSubmit =
    form.customerName.trim().length >= 2 &&
    isValidPhone(form.customerPhone) &&
    form.deviceModel.trim().length >= 1 &&
    !!form.conditionCode &&
    Number(form.originalTotalAmount) > 0 &&
    Number(form.remainingDebt) > 0 &&
    Number(form.monthlyPayment) > 0 &&
    form.nextPaymentDate.trim().length > 0 &&
    !saving &&
    !passportSelection.hasBlockingErrors

  async function handleSubmit() {
    if (!canSubmit) return
    if (currency.currency === 'USD' && !currency.usdUzsRate) {
      setError('USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko\'ring.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const [passportPhotoUrl] = await passportSelection.uploadAll()
      const payload = {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        passportPhotoUrl,
        deviceModel: form.deviceModel.trim(),
        imei: form.imei.trim() || undefined,
        secondaryImei: form.secondaryImei.trim() || undefined,
        storageAmount: form.storage.trim() ? Number(form.storage) : undefined,
        storageUnit: form.storage.trim() ? form.storageUnit : undefined,
        conditionCode: form.conditionCode,
        color: form.color.trim() || undefined,
        batteryHealth: form.batteryHealth.trim() ? Number(form.batteryHealth) : undefined,
        originalTotalAmount: Number(form.originalTotalAmount),
        alreadyPaidBeforeImport: form.alreadyPaidBeforeImport.trim() ? Number(form.alreadyPaidBeforeImport) : 0,
        remainingDebt: Number(form.remainingDebt),
        monthlyPayment: Number(form.monthlyPayment),
        inputCurrency: currency.currency,
        nextPaymentDate: form.nextPaymentDate,
        originalSaleDate: form.originalSaleDate || undefined,
        importNote: form.importNote.trim() || undefined,
      }
      const res = await fetch('/api/nasiya/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': importCommand.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        importCommand.rejected(res.status)
        throw new Error(json.error || 'Import qilishda xatolik')
      }
      importCommand.committed()
      await navigateAfterMutation(router, can('NASIYA_VIEW') ? `/shop/nasiyalar/${json.data.nasiyaId}` : '/shop/import', {
        kind: 'nasiya.imported',
        nasiyaId: json.data.nasiyaId,
        deviceId: json.data.deviceId,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import qilishda xatolik')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-5 p-6">
      <Link href="/shop/nasiyalar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Nasiyalarga qaytish
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Avvalgi nasiya kiritish</h1>
        <p className="mt-1 text-sm text-zinc-500">Oryx'dan oldingi mavjud nasiyani import qilish</p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Bu avvalgi nasiya sifatida import qilinadi. Importgacha to‘langan pul joriy oy daromadiga qo‘shilmaydi.
        <span className="font-semibold"> Bu yangi sotuv emas.</span>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <Section title="Mijoz">
        <Field label="Mijoz ismi" required>
          <Input value={form.customerName} onChange={(e) => set('customerName')(e.target.value)} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label="Telefon" required>
          <PhoneInput value={form.customerPhone} onChange={set('customerPhone')} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <ImageSelectionField
          inputId="import-nasiya-passport-image"
          label="Pasport rasmi (ixtiyoriy)"
          mode="single"
          selection={passportSelection}
          disabled={saving}
          help="Private saqlanadi; Telegram qurilma rasmlariga qo‘shilmaydi. JPG, PNG yoki WEBP, 5 MB gacha."
          className="sm:col-span-2"
        />
      </Section>

      <Section title="Qurilma">
        <Field label="Model" required>
          <Input value={form.deviceModel} onChange={(e) => set('deviceModel')(e.target.value)} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label="Asosiy IMEI">
          <Input value={form.imei} onChange={(e) => set('imei')(e.target.value)} inputMode="numeric" maxLength={15} className="h-10 rounded-lg border-zinc-200 font-mono" />
        </Field>
        <Field label="Qo‘shimcha IMEI">
          <Input value={form.secondaryImei} onChange={(e) => set('secondaryImei')(e.target.value)} inputMode="numeric" maxLength={15} className="h-10 rounded-lg border-zinc-200 font-mono" />
        </Field>
        <StorageInput
          id="import-storage"
          amount={form.storage}
          unit={form.storageUnit}
          onAmountChange={(value) => set('storage')(value)}
          onUnitChange={(value) => set('storageUnit')(value)}
        />
        <Field label="Holati" required>
          <Select value={form.conditionCode} onValueChange={(value) => value && set('conditionCode')(value)}>
            <SelectTrigger className="h-10"><SelectValue placeholder="Tanlang" /></SelectTrigger>
            <SelectContent><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">Ishlatilgan</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Rang">
          <Input value={form.color} onChange={(e) => set('color')(e.target.value)} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label="Batareya (%)">
          <Input type="number" min="0" max="100" value={form.batteryHealth} onChange={(e) => set('batteryHealth')(e.target.value)} className="h-10 rounded-lg border-zinc-200" />
        </Field>
      </Section>

      <Section title="Moliyaviy ma'lumot">
        <Field label={`Avvalgi nasiya umumiy summasi (${currencyLabel(currency.currency)})`} required>
          <MoneyInput currency={currency.currency} value={form.originalTotalAmount} onChange={set('originalTotalAmount')} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label={`Importgacha to'langan (${currencyLabel(currency.currency)})`}>
          <MoneyInput currency={currency.currency} value={form.alreadyPaidBeforeImport} onChange={set('alreadyPaidBeforeImport')} placeholder="0" className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label={`Hozirgi qolgan qarz (${currencyLabel(currency.currency)})`} required>
          <MoneyInput currency={currency.currency} value={form.remainingDebt} onChange={set('remainingDebt')} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label={`Oylik to'lov (${currencyLabel(currency.currency)})`} required>
          <MoneyInput currency={currency.currency} value={form.monthlyPayment} onChange={set('monthlyPayment')} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label="Keyingi to'lov sanasi" required>
          <DateInput aria-label="Keyingi to'lov sanasi" value={form.nextPaymentDate} onValueChange={set('nextPaymentDate')} className="h-10 rounded-lg border-zinc-200" />
        </Field>
        <Field label="Eski sotuv sanasi">
          <DateInput aria-label="Eski sotuv sanasi" value={form.originalSaleDate} onValueChange={set('originalSaleDate')} className="h-10 rounded-lg border-zinc-200" />
        </Field>
      </Section>

      <Field label="Izoh">
        <Textarea value={form.importNote} onChange={(e) => set('importNote')(e.target.value)} className="min-h-[70px] rounded-lg border-zinc-200 text-sm" />
      </Field>

      {preview && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-sm font-semibold text-zinc-900">Jadval oldindan ko'rish</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
            <Preview label="Qolgan qarz" value={fmt(remainingDebtUzs, currency)} />
            <Preview label="Oylar soni" value={`${preview.count} oy`} />
            <Preview label="Birinchi to'lov" value={uzDate(preview.firstDate)} />
            <Preview label="Oxirgi to'lov" value={uzDate(preview.lastDate)} />
          </div>
          {preview.lastAmount !== Math.round(monthlyPaymentUzs) && (
            <div className="mt-2 text-xs text-zinc-500">
              Oxirgi oy to'lovi: <span className="font-medium text-zinc-800">{fmt(preview.lastAmount, currency)}</span>
            </div>
          )}
          <div className="mt-2 text-xs font-medium text-amber-700">Bu yangi sotuv emas.</div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link href="/shop/nasiyalar">
          <Button variant="outline" className="rounded-lg border-zinc-200 text-zinc-700">Bekor qilish</Button>
        </Link>
        <AsyncButton
          pending={saving}
          pendingLabel="Import qilinmoqda..."
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
        >
          Import qilish
        </AsyncButton>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4">
      <div className="mb-3 text-sm font-semibold text-zinc-900">{title}</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function Preview({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 font-medium text-zinc-900">{value}</div>
    </div>
  )
}
