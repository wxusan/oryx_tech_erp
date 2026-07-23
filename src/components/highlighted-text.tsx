import { Fragment, type ReactNode } from 'react'
import { findSearchMatchRanges } from '@/lib/search-needle'
import { cn } from '@/lib/utils'

export type SearchMatchMode = 'text' | 'identifier' | 'auto'

interface HighlightedTextProps {
  value: string | number | null | undefined
  query: string
  mode?: SearchMatchMode
  className?: string
  markClassName?: string
}

/**
 * Renders the original value as React text nodes and semantic <mark> elements.
 * It never builds HTML from the value or query.
 */
export function HighlightedText({
  value,
  query,
  mode = 'auto',
  className,
  markClassName,
}: HighlightedTextProps) {
  const text = value == null ? '' : String(value)
  const ranges = query ? findSearchMatchRanges(text, query, mode) : []
  let cursor = 0
  const content: ReactNode[] = []

  for (const [index, range] of ranges.entries()) {
    const start = Math.max(cursor, Math.min(text.length, range.start))
    const end = Math.max(start, Math.min(text.length, range.end))
    if (end <= start) continue
    if (start > cursor) content.push(text.slice(cursor, start))
    content.push(
      <mark
        key={`${start}-${end}-${index}`}
        className={cn(
          'rounded-[2px] bg-sky-200 px-0 text-inherit decoration-clone',
          markClassName,
        )}
      >
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  }

  if (cursor < text.length) content.push(text.slice(cursor))
  const rendered = content.length ? content.map((node, index) => <Fragment key={index}>{node}</Fragment>) : text
  return className ? <span className={className}>{rendered}</span> : <>{rendered}</>
}

export interface SearchMatchEvidence {
  field?: string
  label?: string
  value?: string | number | null
  displayValue?: string | number | null
  displayText?: string | number | null
  text?: string | number | null
  mode?: SearchMatchMode | 'phone' | 'imei' | 'masked'
  highlightable?: boolean
  ranges?: Array<{ start: number; end: number }>
}

export interface SearchEvidenceCarrier {
  matchEvidence?: unknown
  searchEvidence?: unknown
  matchedOn?: unknown
}

const evidenceLabels: Record<string, string> = {
  ADDITIONAL_PHONE: "Qo'shimcha telefon",
  COLOR: 'Rang',
  CUSTOMER_NAME: 'Mijoz',
  CUSTOMER_PHONE: 'Mijoz telefoni',
  MODEL: 'Model',
  NOTE: 'Izoh',
  PASSPORT: 'Pasport',
  PRIMARY_IMEI: 'IMEI',
  RAW_LOG_FIELD: 'Mos maydon',
  SECONDARY_IMEI: "Qo'shimcha IMEI",
  STORAGE: 'Xotira',
  SUPPLIER_NAME: 'Yetkazib beruvchi',
  SUPPLIER_PHONE: 'Yetkazib beruvchi telefoni',
  color: 'Rang',
  customerAdditionalPhone: "Qo'shimcha telefon",
  customerName: 'Mijoz',
  customerPhone: 'Mijoz telefoni',
  model: 'Model',
  note: 'Izoh',
  passport: 'Pasport',
  primaryImei: 'IMEI',
  secondaryImei: "Qo'shimcha IMEI",
  storage: 'Xotira',
  supplierName: 'Yetkazib beruvchi',
  supplierPhone: 'Yetkazib beruvchi telefoni',
}

function evidenceArray(value: unknown): SearchMatchEvidence[] {
  const entries = Array.isArray(value) ? value : value == null ? [] : [value]
  return entries.flatMap((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return [{ value: entry }]
    return entry && typeof entry === 'object' ? [entry as SearchMatchEvidence] : []
  })
}

export function searchEvidenceFor(
  id: string,
  item: SearchEvidenceCarrier | null | undefined,
  envelope?: (SearchEvidenceCarrier & { matchEvidenceById?: unknown }) | null,
): SearchMatchEvidence[] {
  const direct = evidenceArray(item?.matchedOn ?? item?.matchEvidence ?? item?.searchEvidence)
  if (direct.length) return direct
  const byId = envelope?.matchEvidenceById
  if (!byId || typeof byId !== 'object' || Array.isArray(byId)) return []
  return evidenceArray((byId as Record<string, unknown>)[id])
}

function evidenceMode(mode: SearchMatchEvidence['mode']): SearchMatchMode {
  if (mode === 'phone' || mode === 'imei') return 'identifier'
  if (mode === 'text' || mode === 'identifier') return mode
  return 'auto'
}

function evidenceText(evidence: SearchMatchEvidence) {
  const value = evidence.displayText ?? evidence.displayValue ?? evidence.value ?? evidence.text
  return value == null ? '' : String(value)
}

export function SearchEvidence({
  evidence,
  query,
  className,
}: {
  evidence: readonly SearchMatchEvidence[]
  query: string
  className?: string
}) {
  if (!query || evidence.length === 0) return null

  const visible = evidence.flatMap((entry) => {
    const text = evidenceText(entry)
    const rawField = entry.field
    const normalizedField = rawField?.toUpperCase()
    const knownFieldLabel = (rawField ? evidenceLabels[rawField] : undefined)
      || (normalizedField ? evidenceLabels[normalizedField] : undefined)
    const label = entry.label
      || knownFieldLabel
      || 'Mos kelgan'
    // Field-only evidence deliberately explains a match without reproducing
    // hidden notes, phone numbers, passport identifiers, or the raw query.
    // Unknown fields stay suppressed until their label is reviewed and added.
    if (!text && !knownFieldLabel) return []
    return [{ entry, text, label, field: normalizedField }]
  })
  if (!visible.length) return null

  return (
    <div className={cn('mt-1 flex flex-wrap gap-1.5 text-[11px] text-zinc-600', className)}>
      {visible.map(({ entry, text, label, field }, index) => (
        <span key={`${field ?? label}-${index}`} className="inline-flex max-w-full items-baseline gap-1 rounded bg-sky-50 px-1.5 py-0.5">
          <span className="shrink-0">{label}:</span>
          {text ? (
            <HighlightedText
              value={text}
              query={entry.highlightable === false || entry.mode === 'masked' ? '' : query}
              mode={evidenceMode(entry.mode)}
              className="truncate"
            />
          ) : (
            <span>bo&apos;yicha mos</span>
          )}
        </span>
      ))}
    </div>
  )
}
