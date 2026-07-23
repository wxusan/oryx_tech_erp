import {
  findSearchMatchRanges,
  type SearchMatchRange,
} from '@/lib/search-needle'

export type SearchMatchField =
  | 'MODEL'
  | 'PRIMARY_IMEI'
  | 'SECONDARY_IMEI'
  | 'COLOR'
  | 'STORAGE'
  | 'SUPPLIER_NAME'
  | 'SUPPLIER_PHONE'
  | 'CUSTOMER_NAME'
  | 'CUSTOMER_PHONE'
  | 'ADDITIONAL_PHONE'
  | 'NOTE'
  | 'PASSPORT'

export interface SearchMatchEvidence {
  field: SearchMatchField
  /**
   * Present only when the value is already authorized for the surrounding DTO.
   * Protected passport data and otherwise hidden notes never enter this field.
   */
  value?: string
  displayText?: string
  mode?: 'text' | 'identifier' | 'auto' | 'phone' | 'imei' | 'masked'
  highlightable?: boolean
  ranges?: SearchMatchRange[]
}

export interface SearchMatchCandidate {
  field: SearchMatchField
  value: string | null | undefined
  mode?: 'text' | 'identifier' | 'auto'
  exposeValue?: boolean
}

/**
 * Return the first deterministic match sidecar. Callers order candidates in
 * the same priority in which they want a match explained to the reader.
 */
export function firstSearchMatchEvidence(
  query: string | null | undefined,
  candidates: readonly SearchMatchCandidate[],
): SearchMatchEvidence | undefined {
  for (const candidate of candidates) {
    if (!candidate.value) continue
    const ranges = findSearchMatchRanges(candidate.value, query, candidate.mode)
    if (ranges.length === 0) continue
    if (candidate.exposeValue === false) return { field: candidate.field }
    return {
      field: candidate.field,
      displayText: candidate.value,
      mode: candidate.mode === 'identifier'
        ? candidate.field.includes('PHONE') ? 'phone' : 'imei'
        : candidate.mode,
      ranges,
    }
  }
  return undefined
}

/** DTO-friendly array form consumed by the shared result renderer. */
export function searchMatchEvidence(
  query: string | null | undefined,
  candidates: readonly SearchMatchCandidate[],
): SearchMatchEvidence[] {
  const evidence = firstSearchMatchEvidence(query, candidates)
  return evidence ? [evidence] : []
}
