export const SEARCH_MAX_LENGTH = 100

const IDENTIFIER_LIKE_SEARCH = /^[+\d\s().-]+$/

export interface SearchMatchRange {
  start: number
  end: number
}

export interface PreparedSearchNeedle {
  /** Trimmed, literal reader-facing query. Never contains SQL escaping. */
  query: string
  /** Query escaped for PostgreSQL LIKE/ILIKE pattern operators. */
  escapedText: string
  /** Digits-only needle for phone/IMEI values, or null for mixed text. */
  identifierDigits: string | null
  isIdentifierLike: boolean
  exceedsMaxLength: boolean
}

/**
 * Escape PostgreSQL LIKE metacharacters while keeping the search literal.
 * Prisma `contains` maps to LIKE/ILIKE, so the same escaped value is used by
 * both Prisma predicates and the few set-based raw SQL list queries.
 */
export function escapeLikeSearchValue(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Prepare one whole search needle. The query is never split into words or
 * characters: every consumer compares this single contiguous value against
 * each candidate field and ORs the candidate fields together.
 */
export function prepareSearchNeedle(
  input: string | null | undefined,
  maxLength = SEARCH_MAX_LENGTH,
): PreparedSearchNeedle {
  const query = input?.trim() ?? ''
  const isIdentifierLike = query.length > 0 && IDENTIFIER_LIKE_SEARCH.test(query)
  const digits = isIdentifierLike ? query.replace(/\D/g, '') : ''

  return {
    query,
    escapedText: escapeLikeSearchValue(query),
    identifierDigits: digits || null,
    isIdentifierLike,
    exceedsMaxLength: query.length > maxLength,
  }
}

function textMatchRanges(value: string, query: string): SearchMatchRange[] {
  if (!query) return []
  const haystack = value.toLocaleLowerCase('uz')
  const needle = query.toLocaleLowerCase('uz')
  const ranges: SearchMatchRange[] = []
  let from = 0

  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from)
    if (start < 0) break
    ranges.push({ start, end: start + needle.length })
    from = start + Math.max(needle.length, 1)
  }

  return ranges
}

function identifierMatchRanges(value: string, digits: string): SearchMatchRange[] {
  if (!digits) return []
  const digitPositions: number[] = []
  let normalized = ''

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character >= '0' && character <= '9') {
      normalized += character
      digitPositions.push(index)
    }
  }

  const ranges: SearchMatchRange[] = []
  let from = 0
  while (from <= normalized.length - digits.length) {
    const normalizedStart = normalized.indexOf(digits, from)
    if (normalizedStart < 0) break
    const normalizedEnd = normalizedStart + digits.length - 1
    ranges.push({
      start: digitPositions[normalizedStart],
      end: digitPositions[normalizedEnd] + 1,
    })
    from = normalizedStart + Math.max(digits.length, 1)
  }

  return ranges
}

/**
 * Locate literal, contiguous matches in the original display value. Identifier
 * mode ignores phone/IMEI separators but maps the resulting range back to the
 * original string so a UI can highlight exactly what the operator searched.
 */
export function findSearchMatchRanges(
  value: string | null | undefined,
  query: string | null | undefined,
  mode: 'text' | 'identifier' | 'auto' = 'auto',
): SearchMatchRange[] {
  if (!value) return []
  const prepared = prepareSearchNeedle(query)
  if (!prepared.query) return []

  const candidateIsIdentifierLike = IDENTIFIER_LIKE_SEARCH.test(value)
  const useIdentifierMode = candidateIsIdentifierLike && (
    mode === 'identifier' || (
      mode === 'auto' &&
      prepared.isIdentifierLike
    )
  )

  return useIdentifierMode && prepared.identifierDigits
    ? identifierMatchRanges(value, prepared.identifierDigits)
    : textMatchRanges(value, prepared.query)
}

export function matchesSearchValue(
  value: string | null | undefined,
  query: string | null | undefined,
  mode: 'text' | 'identifier' | 'auto' = 'auto',
): boolean {
  return findSearchMatchRanges(value, query, mode).length > 0
}
