import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  computeCustomerTrustRatingFromFactors,
  isValidTrustTier,
  type CustomerTrustFactors,
} from '@/lib/nasiya-customer-trust'
import { customerSearchWhere } from '@/lib/server/customer-search'
import { getCustomerTrustFactorsForList } from '@/lib/server/customer-trust-queries'
import { isPrivateUploadStoredKey } from '@/lib/server/private-upload-reference'

const EMPTY_TRUST_FACTORS: CustomerTrustFactors = {
  totalNasiyaCount: 0,
  completedNasiyaCount: 0,
  activeNasiyaCount: 0,
  cancelledNasiyaCount: 0,
  paidInstallmentCount: 0,
  onTimeRatio: null,
  lateInstallmentCount: 0,
  maxDaysLate: 0,
  currentOverdueScheduleCount: 0,
  hasCurrentOverdue: false,
}

export interface CustomerListInput {
  shopId: string
  search?: string | null
  skip: number
  take: number
}

/**
 * Authoritative paginated customer-list query shared by the unfiltered GET
 * and privacy-preserving POST search endpoints. The caller owns permission
 * and tenant resolution; this function always constrains the SQL to shopId.
 */
export async function getCustomerList(input: CustomerListInput) {
  const where = customerSearchWhere(input.shopId, input.search, { includeNote: true })
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.take,
      skip: input.skip,
      select: {
        id: true,
        shopId: true,
        name: true,
        phone: true,
        phoneNormalizationNeedsReview: true,
        additionalPhones: true,
        passportIdentifierLast4: true,
        passportPhotoUrl: true,
        note: true,
        createdAt: true,
        trustOverride: true,
        _count: {
          select: {
            sales: { where: { deletedAt: null } },
            nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
          },
        },
      },
    }),
    prisma.customer.count({ where }),
  ])

  const trustFactors = await getCustomerTrustFactorsForList({
    shopId: input.shopId,
    customerIds: customers.map((customer) => customer.id),
  })
  const items = customers.map(({ trustOverride, ...rest }) => {
    const override = isValidTrustTier(trustOverride) ? trustOverride : null
    const trust = computeCustomerTrustRatingFromFactors(
      trustFactors.get(rest.id) ?? EMPTY_TRUST_FACTORS,
      override,
    )
    return {
      ...rest,
      passportMasked: rest.passportIdentifierLast4 ? `••••${rest.passportIdentifierLast4}` : null,
      hasPassportPhoto: isPrivateUploadStoredKey({ key: rest.passportPhotoUrl, shopId: rest.shopId, kind: 'passport' }),
      passportIdentifierLast4: undefined,
      passportPhotoUrl: undefined,
      trust: { tier: trust.tier, label: trust.label, color: trust.color },
    }
  })

  return { items, total, skip: input.skip, take: input.take }
}
