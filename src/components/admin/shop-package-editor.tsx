'use client'

import * as React from 'react'
import { CheckCircle2, Info, ShieldCheck } from 'lucide-react'
import {
  SHOP_FEATURE_CATALOG,
  SHOP_FEATURE_CODES,
  calculateRecurringPackagePrice,
  type PackagePriceBreakdown,
  type ShopFeatureCode,
} from '@/lib/access-control'
import { formatUserFacingMoney, hasValidMinorUnits, type CurrencyCode } from '@/lib/currency'
import {
  shopPackageDraftSchema,
  type ShopAccessMode,
  type ShopPackageDraft,
} from '@/lib/shop-package-contract'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'

interface EditableFeature {
  featureCode: ShopFeatureCode
  enabled: boolean
  recurringPrice: string
}

interface EditorState {
  effectiveOn: string
  basePrice: string
  currency: CurrencyCode
  discountAmount: string
  note: string
  features: EditableFeature[]
}

export interface ShopPackageEditorProps {
  /** Used to initialize the local form. Remount with a new key to reset it. */
  initialValue: ShopPackageDraft
  onSubmit: (value: ShopPackageDraft) => void | Promise<void>
  disabled?: boolean
  isSaving?: boolean
  submitLabel?: string
  /** Optional earliest business date accepted by the calling page/API. */
  minimumEffectiveOn?: string
  error?: string | null
  className?: string
  onAccessModeChange?: (mode: ShopAccessMode) => void
}

const featureByCode = new Map(SHOP_FEATURE_CATALOG.map((feature) => [feature.code, feature]))

function moneyString(value: number | string | undefined) {
  return value === undefined ? '0' : String(value)
}

function editorStateFrom(value: ShopPackageDraft): EditorState {
  const submittedFeatures = new Map(value.features.map((feature) => [feature.featureCode, feature]))
  return {
    effectiveOn: value.effectiveOn,
    basePrice: moneyString(value.basePrice),
    currency: value.currency,
    discountAmount: moneyString(value.discountAmount),
    note: value.note,
    features: SHOP_FEATURE_CODES.map((featureCode) => {
      const submitted = submittedFeatures.get(featureCode)
      return {
        featureCode,
        enabled: submitted?.enabled ?? false,
        recurringPrice: featureCode === 'STAFF_ACCESS' ? '0' : moneyString(submitted?.recurringPrice),
      }
    }),
  }
}

function numberFromMoneyDraft(value: string) {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function packageDraftFrom(state: EditorState): ShopPackageDraft {
  return {
    effectiveOn: state.effectiveOn,
    basePrice: numberFromMoneyDraft(state.basePrice),
    currency: state.currency,
    discountAmount: numberFromMoneyDraft(state.discountAmount),
    note: state.note,
    features: state.features.map((feature) => ({
      featureCode: feature.featureCode,
      enabled: feature.enabled,
      recurringPrice: feature.featureCode === 'STAFF_ACCESS'
        ? 0
        : numberFromMoneyDraft(feature.recurringPrice),
    })),
  }
}

function accessModeFrom(features: readonly EditableFeature[]): ShopAccessMode {
  return features.find((feature) => feature.featureCode === 'STAFF_ACCESS')?.enabled
    ? 'OWNER_AND_STAFF'
    : 'OWNER_ONLY'
}

function formatPackageMoney(value: number, currency: CurrencyCode) {
  return formatUserFacingMoney({
    amount: value,
    amountCurrency: currency,
    displayCurrency: currency,
  })
}

function moneyError(value: string, currency: CurrencyCode) {
  if (value.trim() === '') return 'Narxni kiriting'
  const parsed = Number(value)
  if (hasValidMinorUnits(parsed, currency)) return null
  return currency === 'UZS'
    ? "UZS narxi butun so'mda va saqlash chegarasida bo'lishi kerak"
    : "USD narxi ko'pi bilan 2 kasr xonali va saqlash chegarasida bo'lishi kerak"
}

function calculateLivePrice(state: EditorState): { price: PackagePriceBreakdown | null; error: string | null } {
  try {
    return { price: calculateRecurringPackagePrice(packageDraftFrom(state)), error: null }
  } catch (error) {
    return {
      price: null,
      error: error instanceof Error ? error.message : "Paket narxini hisoblab bo'lmadi",
    }
  }
}

function findEnabledDependents(features: readonly EditableFeature[], featureCode: ShopFeatureCode) {
  const enabled = new Set(features.filter((feature) => feature.enabled).map((feature) => feature.featureCode))
  const affected = new Set<ShopFeatureCode>()
  let changed = true
  while (changed) {
    changed = false
    for (const definition of SHOP_FEATURE_CATALOG) {
      if (!enabled.has(definition.code) || affected.has(definition.code)) continue
      if (definition.prerequisites.some((required) => required === featureCode || affected.has(required))) {
        affected.add(definition.code)
        changed = true
      }
    }
  }
  return affected
}

function requiredFeaturesFor(featureCode: ShopFeatureCode) {
  const required = new Set<ShopFeatureCode>()
  const visit = (code: ShopFeatureCode) => {
    for (const prerequisite of featureByCode.get(code)?.prerequisites ?? []) {
      if (required.has(prerequisite)) continue
      required.add(prerequisite)
      visit(prerequisite)
    }
  }
  visit(featureCode)
  return required
}

export function ShopPackageEditor({
  initialValue,
  onSubmit,
  disabled = false,
  isSaving = false,
  submitLabel = 'Paket versiyasini saqlash',
  minimumEffectiveOn,
  error,
  className,
  onAccessModeChange,
}: ShopPackageEditorProps) {
  const [state, setState] = React.useState<EditorState>(() => editorStateFrom(initialValue))
  const [submitAttempted, setSubmitAttempted] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [dependencyNotice, setDependencyNotice] = React.useState<string | null>(null)
  const errorSummaryRef = React.useRef<HTMLDivElement>(null)
  const accessMode = accessModeFrom(state.features)
  const livePrice = React.useMemo(() => calculateLivePrice(state), [state])
  const busy = isSaving || submitting
  const locked = disabled || busy

  const basePriceError = moneyError(state.basePrice, state.currency)
  const discountError = moneyError(state.discountAmount, state.currency)
  const dateError = !state.effectiveOn
    ? 'Kuchga kirish sanasini kiriting'
    : minimumEffectiveOn && state.effectiveOn < minimumEffectiveOn
      ? `Sana ${minimumEffectiveOn} dan oldin bo'lishi mumkin emas`
      : null
  const noteError = state.note.trim().length < 5
    ? "Paket o'zgarishi sababi kamida 5 ta belgidan iborat bo'lishi kerak"
    : state.note.length > 1000
      ? "Sabab 1000 ta belgidan oshmasligi kerak"
      : null
  const visibleGlobalError = submitError ?? error ?? (submitAttempted ? livePrice.error : null)

  function setAccessMode(mode: ShopAccessMode) {
    setState((current) => ({
      ...current,
      features: current.features.map((feature) => feature.featureCode === 'STAFF_ACCESS'
        ? { ...feature, enabled: mode === 'OWNER_AND_STAFF', recurringPrice: '0' }
        : feature),
    }))
    setDependencyNotice(mode === 'OWNER_AND_STAFF'
      ? "Xodimlar profili yoqildi. Bu bepul va paket narxini o'zgartirmadi."
      : "Faqat do'kon egasi kirishi mumkin. Xodimlar profili paket narxiga ta'sir qilmadi.")
    onAccessModeChange?.(mode)
  }

  function setFeatureEnabled(featureCode: ShopFeatureCode, enabled: boolean) {
    if (featureCode === 'STAFF_ACCESS') {
      setAccessMode(enabled ? 'OWNER_AND_STAFF' : 'OWNER_ONLY')
      return
    }

    if (enabled) {
      const prerequisites = requiredFeaturesFor(featureCode)
      const newlyEnabled = state.features
        .filter((feature) => prerequisites.has(feature.featureCode) && !feature.enabled)
        .map((feature) => featureByCode.get(feature.featureCode)?.label ?? feature.featureCode)
      setDependencyNotice(newlyEnabled.length
        ? `${featureByCode.get(featureCode)?.label} uchun bog'liq modullar ham yoqildi: ${newlyEnabled.join(', ')}.`
        : null)
      setState((current) => ({
        ...current,
        features: current.features.map((feature) => ({
          ...feature,
          enabled: feature.featureCode === featureCode || prerequisites.has(feature.featureCode)
            ? true
            : feature.enabled,
        })),
      }))
      return
    }

    const dependents = findEnabledDependents(state.features, featureCode)
    const disabledNames = [...dependents].map((code) => featureByCode.get(code)?.label ?? code)
    setDependencyNotice(disabledNames.length
      ? `${featureByCode.get(featureCode)?.label} o'chirilgani uchun bog'liq modullar ham o'chirildi: ${disabledNames.join(', ')}.`
      : null)
    setState((current) => ({
      ...current,
      features: current.features.map((feature) => ({
        ...feature,
        enabled: feature.featureCode === featureCode || dependents.has(feature.featureCode)
          ? false
          : feature.enabled,
      })),
    }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    setSubmitError(null)

    const candidate = packageDraftFrom(state)
    const parsed = shopPackageDraftSchema.safeParse(candidate)
    const minimumDateInvalid = Boolean(minimumEffectiveOn && candidate.effectiveOn < minimumEffectiveOn)
    if (!parsed.success || minimumDateInvalid) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus())
      return
    }

    try {
      setSubmitting(true)
      await onSubmit(parsed.data)
    } catch (submissionError) {
      setSubmitError(submissionError instanceof Error ? submissionError.message : "Paketni saqlab bo'lmadi")
      requestAnimationFrame(() => errorSummaryRef.current?.focus())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className={cn('space-y-6', className)} onSubmit={handleSubmit} noValidate>
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5" aria-labelledby="package-settings-heading">
        <div className="mb-4">
          <h2 id="package-settings-heading" className="text-base font-semibold text-zinc-950">Paket sozlamalari</h2>
          <p className="mt-1 text-sm text-zinc-600">Yangi versiya qachondan kuchga kirishi va qaysi valyutada hisoblanishini belgilang.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Kuchga kirish sanasi"
            required
            error={submitAttempted ? dateError : null}
            help={minimumEffectiveOn ? `Eng erta ruxsat etilgan sana: ${minimumEffectiveOn}` : 'Sana Toshkent ish kuni bo‘yicha saqlanadi.'}
          >
            <DateInput
              value={state.effectiveOn}
              onValueChange={(effectiveOn) => setState((current) => ({ ...current, effectiveOn }))}
              disabled={locked}
            />
          </Field>

          <Field label="Paket valyutasi" required help="Barcha paket narxlari bitta valyutada bo‘lishi shart.">
            <select
              value={state.currency}
              onChange={(event) => setState((current) => ({ ...current, currency: event.target.value as CurrencyCode }))}
              disabled={locked}
              className="h-8 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="UZS">UZS — so‘m</option>
              <option value="USD">USD — AQSh dollari</option>
            </select>
          </Field>

          <Field
            label="Asosiy oylik narx"
            required
            error={submitAttempted ? basePriceError : null}
            help={state.currency === 'UZS' ? "Faqat butun so'm kiriting." : 'Ko‘pi bilan 2 kasr xonasi.'}
          >
            <MoneyInput
              value={state.basePrice}
              onChange={(basePrice) => setState((current) => ({ ...current, basePrice }))}
              currency={state.currency}
              disabled={locked}
              aria-label="Asosiy oylik narx"
            />
          </Field>

          <Field
            label="Oylik chegirma"
            required
            error={submitAttempted ? discountError : null}
            help="Chegirma asosiy narx va yoqilgan pullik modullar yig‘indisidan oshmasligi kerak."
          >
            <MoneyInput
              value={state.discountAmount}
              onChange={(discountAmount) => setState((current) => ({ ...current, discountAmount }))}
              currency={state.currency}
              disabled={locked}
              aria-label="Oylik chegirma"
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5" aria-labelledby="access-mode-heading">
        <fieldset disabled={locked}>
          <legend id="access-mode-heading" className="text-base font-semibold text-zinc-950">Kirish turi</legend>
          <p className="mt-1 text-sm text-zinc-600">Do‘kon portaliga kimlar kirishini aniq tanlang.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([
              {
                value: 'OWNER_ONLY' as const,
                label: 'Faqat do‘kon egasi',
                description: 'OWNER_ONLY — xodim profillari kira olmaydi.',
              },
              {
                value: 'OWNER_AND_STAFF' as const,
                label: 'Egasi va xodimlar',
                description: 'OWNER_AND_STAFF — qo‘shimcha xodim profillari ham kiradi.',
              },
            ]).map((option) => (
              <label
                key={option.value}
                htmlFor={`shop-access-mode-${option.value.toLowerCase()}`}
                className={cn(
                  'flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-3 focus-within:ring-zinc-400/30',
                  accessMode === option.value ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:bg-zinc-50',
                )}
              >
                <input
                  id={`shop-access-mode-${option.value.toLowerCase()}`}
                  type="radio"
                  name="shop-access-mode"
                  value={option.value}
                  checked={accessMode === option.value}
                  onChange={() => setAccessMode(option.value)}
                  className="mt-1 size-4 accent-zinc-950"
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-900">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-600">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 text-emerald-950" role="note">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Xodimlar profili doimo bepul</p>
            <p className="mt-1 text-sm leading-5">STAFF_ACCESS narxi 0. Uni yoqish yoki o‘chirish paketning oylik jami narxini hech qachon o‘zgartirmaydi.</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5" aria-labelledby="features-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="features-heading" className="text-base font-semibold text-zinc-950">Modullar</h2>
            <p className="mt-1 text-sm text-zinc-600">To‘liq ro‘yxatdan kerakli imkoniyatlarni tanlang. Bog‘liq modullar avtomatik moslashtiriladi.</p>
          </div>
          <span className="w-fit rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
            {state.features.filter((feature) => feature.enabled).length} / {SHOP_FEATURE_CODES.length} yoqilgan
          </span>
        </div>

        {dependencyNotice && (
          <div className="mt-4 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status" aria-live="polite">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{dependencyNotice}</p>
          </div>
        )}

        <div className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200">
          {SHOP_FEATURE_CATALOG.map((definition) => {
            const feature = state.features.find((item) => item.featureCode === definition.code)!
            const featurePriceError = definition.billable ? moneyError(feature.recurringPrice, state.currency) : null
            const prerequisites = definition.prerequisites.map((code) => featureByCode.get(code)?.label ?? code)
            const descriptionId = `package-feature-${definition.code.toLowerCase()}-description`
            return (
              <div key={definition.code} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)] sm:items-center sm:p-4">
                <label htmlFor={`package-feature-${definition.code.toLowerCase()}-enabled`} className="flex min-h-11 cursor-pointer items-start gap-3">
                  <input
                    id={`package-feature-${definition.code.toLowerCase()}-enabled`}
                    type="checkbox"
                    checked={feature.enabled}
                    onChange={(event) => setFeatureEnabled(definition.code, event.target.checked)}
                    disabled={locked}
                    aria-label={definition.label}
                    aria-describedby={descriptionId}
                    className="mt-1 size-4 shrink-0 accent-zinc-950"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{definition.label}</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        definition.billable ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900',
                      )}>
                        {definition.billable ? 'Pullik modul' : 'Bepul'}
                      </span>
                    </span>
                    <span id={descriptionId} className="mt-1 block text-xs leading-5 text-zinc-600">
                      {definition.description}
                      {prerequisites.length > 0 && ` Bog‘liq: ${prerequisites.join(', ')}.`}
                    </span>
                  </span>
                </label>

                {definition.billable ? (
                  <div>
                    <label htmlFor={`package-feature-${definition.code.toLowerCase()}-price`} className="mb-1 block text-xs font-medium text-zinc-700">
                      Yoqilgandagi oylik narx
                    </label>
                    <MoneyInput
                      id={`package-feature-${definition.code.toLowerCase()}-price`}
                      value={feature.recurringPrice}
                      onChange={(recurringPrice) => setState((current) => ({
                        ...current,
                        features: current.features.map((item) => item.featureCode === definition.code
                          ? { ...item, recurringPrice }
                          : item),
                      }))}
                      currency={state.currency}
                      disabled={locked}
                      aria-invalid={submitAttempted && featurePriceError ? true : undefined}
                      aria-describedby={submitAttempted && featurePriceError ? `package-feature-${definition.code.toLowerCase()}-price-error` : undefined}
                    />
                    {submitAttempted && featurePriceError && (
                      <p id={`package-feature-${definition.code.toLowerCase()}-price-error`} role="alert" className="mt-1 text-xs text-red-600">{featurePriceError}</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    <span className="font-semibold">0 {state.currency}</span>
                    <span className="ml-2">— jami narxga qo‘shilmaydi</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5" aria-labelledby="package-reason-heading">
        <h2 id="package-reason-heading" className="text-base font-semibold text-zinc-950">O‘zgarish sababi</h2>
        <div className="mt-4">
          <Field
            // Package pricing and entitlement changes are an auditable,
            // high-risk operation.  This is intentionally not an ordinary
            // optional Izoh field: Field renders the visible required marker.
            label="Sabab"
            required
            error={submitAttempted ? noteError : null}
            help="Audit tarixida tushunarli bo‘lishi uchun kamida 5 ta belgi yozing."
          >
            <Textarea
              value={state.note}
              onChange={(event) => setState((current) => ({ ...current, note: event.target.value }))}
              disabled={locked}
              maxLength={1000}
              rows={3}
              placeholder="Masalan: Hisobotlar moduli keyingi to‘lov davridan qo‘shildi"
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border-2 border-zinc-900 bg-zinc-950 p-4 text-white sm:p-5" aria-labelledby="package-total-heading" aria-live="polite">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 id="package-total-heading" className="text-base font-semibold">Oylik paket jami</h2>
            {livePrice.price ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:max-w-md">
                <dt className="text-zinc-400">Asosiy narx</dt>
                <dd className="text-right">{formatPackageMoney(livePrice.price.basePrice, state.currency)}</dd>
                <dt className="text-zinc-400">Yoqilgan modullar</dt>
                <dd className="text-right">+ {formatPackageMoney(livePrice.price.addOnPrice, state.currency)}</dd>
                <dt className="text-zinc-400">Chegirma</dt>
                <dd className="text-right">− {formatPackageMoney(livePrice.price.discountAmount, state.currency)}</dd>
                <dt className="border-t border-zinc-700 pt-2 font-semibold">Har oy</dt>
                <dd className="border-t border-zinc-700 pt-2 text-right text-xl font-bold">{formatPackageMoney(livePrice.price.recurringPrice, state.currency)}</dd>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-amber-300">Hisoblash uchun narxlar va bog‘liqliklarni tekshiring.</p>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              STAFF_ACCESS: 0 {state.currency}; jami narxga ta’sir qilmaydi.
            </p>
          </div>

          <Button type="submit" size="lg" disabled={locked} className="w-full bg-white text-zinc-950 hover:bg-zinc-200 sm:w-auto">
            {busy ? 'Saqlanmoqda…' : submitLabel}
          </Button>
        </div>
      </section>

      {(visibleGlobalError || (submitAttempted && (basePriceError || discountError || dateError || noteError))) && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 outline-none focus:ring-3 focus:ring-red-300"
        >
          <p className="font-semibold">Paket saqlanmadi</p>
          <p className="mt-1">{visibleGlobalError ?? 'Belgilangan maydonlardagi xatolarni tuzating.'}</p>
        </div>
      )}
    </form>
  )
}
