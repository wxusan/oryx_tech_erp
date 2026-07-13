import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { hashPassportIdentifier, isValidPassportIdentifier } from '@/lib/customer-passport'
import { normalizePhone } from '@/lib/phone'

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
  const search = searchValue?.trim()
  if (!search) return { shopId, deletedAt: null }

  const digits = normalizePhone(search)
  const passportHash = isValidPassportIdentifier(search)
    ? hashPassportIdentifier(search)
    : null

  return {
    shopId,
    deletedAt: null,
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      ...(options.includeNote ? [{ note: { contains: search, mode: 'insensitive' as const } }] : []),
      ...(digits ? [{ normalizedPhone: { contains: digits } }] : []),
      ...(digits ? [{ additionalPhones: { has: digits } }] : []),
      ...(passportHash ? [{ passportIdentifierHash: passportHash }] : []),
    ],
  }
}
