import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { hashPassportIdentifier, isValidPassportIdentifier } from '@/lib/customer-passport'
import { prepareSearchNeedle } from '@/lib/search-needle'

/**
 * One tenant-scoped customer lookup contract. Passport matching is exact
 * HMAC equality only; the raw identifier never enters SQL, logs, or response
 * DTOs. Name and phone remain deliberately partial for normal staff search.
 */
export function customerSearchWhere(
  shopId: string,
  searchValue: string | null | undefined,
  options: { includeNote?: boolean } = {},
): Prisma.CustomerWhereInput {
  const prepared = prepareSearchNeedle(searchValue)
  if (!prepared.query) return { shopId, deletedAt: null }

  const passportSearchHash = isValidPassportIdentifier(prepared.query)
    ? hashPassportIdentifier(prepared.query)
    : null

  return {
    shopId,
    deletedAt: null,
    OR: [
      { name: { contains: prepared.escapedText, mode: 'insensitive' } },
      { phone: { contains: prepared.escapedText, mode: 'insensitive' } },
      ...(options.includeNote
        ? [{ note: { contains: prepared.escapedText, mode: 'insensitive' as const } }]
        : []),
      ...(prepared.identifierDigits
        ? [{ phoneSearchDigits: { contains: prepared.identifierDigits } }]
        : []),
      ...(passportSearchHash
        ? [{ passportIdentifierHash: passportSearchHash }]
        : []),
    ],
  }
}
