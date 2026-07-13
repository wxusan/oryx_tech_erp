import { z } from 'zod'
import {
  SHOP_FEATURE_CODES,
  calculateRecurringPackagePrice,
  type PackagePriceBreakdown,
} from '@/lib/access-control'
import { MAX_STORABLE_MONEY } from '@/lib/currency'

export const shopAccessModeSchema = z.enum(['OWNER_ONLY', 'OWNER_AND_STAFF'])
export type ShopAccessMode = z.infer<typeof shopAccessModeSchema>

const packageAmountSchema = z
  .number({ error: 'Narx raqamda kiritilishi shart' })
  .min(0, "Narx manfiy bo'lmasligi kerak")
  .max(MAX_STORABLE_MONEY, 'Narx saqlash chegarasidan oshib ketdi')

const effectiveBusinessDateSchema = z.string().regex(
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  'Kuchga kirish sanasi YYYY-MM-DD formatida bo\'lishi kerak',
).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Kuchga kirish sanasi mavjud sana bo\'lishi kerak')

export const shopPackageDraftSchema = z.object({
  effectiveOn: effectiveBusinessDateSchema,
  basePrice: packageAmountSchema,
  currency: z.enum(['UZS', 'USD']),
  discountAmount: packageAmountSchema.default(0),
  note: z.string().trim().min(5, 'Paket o\'zgarishi sababi kamida 5 ta belgidan iborat bo\'lishi kerak').max(1000),
  features: z.array(z.object({
    featureCode: z.enum(SHOP_FEATURE_CODES),
    enabled: z.boolean(),
    recurringPrice: packageAmountSchema,
  })),
}).superRefine((value, context) => {
  try {
    calculateRecurringPackagePrice(value)
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['features'],
      message: error instanceof Error ? error.message : "Paket ma'lumoti noto'g'ri",
    })
  }
})

export type ShopPackageDraft = z.infer<typeof shopPackageDraftSchema>

export interface ShopPackageDto {
  id: string
  effectiveOn: string
  basePrice: string
  currency: 'UZS' | 'USD'
  discountAmount: string
  pricingNeedsReview: boolean
  note: string
  createdAt: string
  price: PackagePriceBreakdown
  features: Array<{
    featureCode: (typeof SHOP_FEATURE_CODES)[number]
    nameUz: string
    descriptionUz: string | null
    billable: boolean
    enabled: boolean
    recurringPrice: string
  }>
}
