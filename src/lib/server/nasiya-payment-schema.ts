/**
 * Additive database capability checks for the staged Nasiya ledger rollout.
 *
 * The payment-rate quote columns are intentionally introduced before the
 * deferred ledger trigger. Older local databases must still be able to read
 * existing contracts while operators review the dry-run repair, so callers
 * may only select/write the new columns once the full quote shape exists.
 *
 * A deployment restarts the server after the additive migration. Caching the
 * answer for the process lifetime is therefore safe and avoids a schema query
 * on every detail-page request.
 */

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

let paymentFxQuoteColumns: Promise<boolean> | null = null

/**
 * The database constraint deliberately accepts a small, governed vocabulary.
 * `CurrencyRate.source` predates that contract and is a free-form string, so
 * an old or manually imported row must never make a new payment impossible to
 * persist. Preserve the rate itself, but label unknown provenance as a frozen
 * historical receipt instead of asserting it came from CBU or an approved
 * manual quote.
 */
export function nasiyaPaymentFxSourceForPersistence(source: string | null | undefined) {
  if (source === 'CBU' || source === 'MANUAL') return source
  return source ? 'RECORDED_FROZEN' : null
}

export function hasNasiyaPaymentFxQuoteColumns(): Promise<boolean> {
  paymentFxQuoteColumns ??= prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::integer AS count
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'NasiyaPayment'
      AND column_name IN (
        'paymentExchangeRateSource',
        'paymentExchangeRateEffectiveAt',
        'paymentExchangeRateFetchedAt'
      )
  `)
    .then(([row]) => Number(row?.count) === 3)
    // Never make a read-only capability probe prevent legacy database reads.
    // A genuine cross-currency payment will still fail safely if it lacks a
    // governed quote; only the new no-rate USD receipt path needs this column.
    .catch(() => false)

  return paymentFxQuoteColumns
}

/** @deprecated Use `hasNasiyaPaymentFxQuoteColumns` for all new callers. */
export const hasNasiyaPaymentExchangeRateSourceColumn = hasNasiyaPaymentFxQuoteColumns
