-- Complete the payment-basis accounting rollout with:
--   * zero-paid Pay Later sales (no invented initial payment method),
--   * immutable Super Admin subscription-payment currency snapshots,
--   * a persisted Super Admin display currency, and
--   * retirement of new write-off permission grants without touching legacy
--     resolution events or written-off contracts.
--
-- Existing ShopPayment rows with NULL currency predate package-currency
-- allocation. Their `amount` was historically stored and displayed as UZS;
-- this is the documented compatibility guarantee from the ERP 2.0 package
-- migration, not a guessed source currency.

BEGIN;

ALTER TABLE "SuperAdmin"
  ADD COLUMN "preferredCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS';

ALTER TABLE "Sale"
  ALTER COLUMN "paymentMethod" DROP NOT NULL,
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT;

CREATE UNIQUE INDEX "Sale_shopId_creationIdempotencyKey_key"
  ON "Sale"("shopId", "creationIdempotencyKey");

ALTER TABLE "ShopPayment"
  ADD COLUMN "exchangeRateAtPayment" DECIMAL(12,4),
  ADD COLUMN "amountUzsSnapshot" DECIMAL(12,2),
  ADD COLUMN "amountUsdSnapshot" DECIMAL(12,2),
  ADD COLUMN "currencyReconstructionStatus" "AccountingReconstructionStatus" NOT NULL DEFAULT 'PENDING';

-- The ERP 2.0 allocation constraint deliberately required NULL currency on
-- LEGACY_UNALLOCATED receipts. Currency is now mandatory for every receipt,
-- so replace that old invariant before backfilling legacy rows. Without this
-- transition, existing production receipts reject the UZS compatibility
-- backfill even though fresh/empty databases migrate successfully.
ALTER TABLE "ShopPayment"
  DROP CONSTRAINT IF EXISTS "ShopPayment_package_allocation_check";

UPDATE "ShopPayment"
SET "currency" = 'UZS'
WHERE "currency" IS NULL;

ALTER TABLE "ShopPayment"
  ADD CONSTRAINT "ShopPayment_currency_not_null_check"
  CHECK ("currency" IS NOT NULL) NOT VALID;

ALTER TABLE "ShopPayment"
  VALIDATE CONSTRAINT "ShopPayment_currency_not_null_check";

-- PostgreSQL can reuse the validated check proof, avoiding another full table
-- scan while taking the brief metadata lock required by SET NOT NULL.
ALTER TABLE "ShopPayment"
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "ShopPayment"
  DROP CONSTRAINT "ShopPayment_currency_not_null_check";

-- Use only a governed rate that already existed when the receipt was written
-- and was still inside the accepted seven-day fallback window. If no such
-- evidence exists, retain the native amount and mark the cross-currency view
-- PARTIAL instead of inventing a historical rate.
WITH payment_rates AS (
  SELECT
    payment."id",
    rate."rate"
  FROM "ShopPayment" payment
  LEFT JOIN LATERAL (
    SELECT candidate."rate"
    FROM "CurrencyRate" candidate
    WHERE candidate."baseCurrency" = 'USD'
      AND candidate."quoteCurrency" = 'UZS'
      AND candidate."fetchedAt" <= payment."paidAt"
      AND candidate."fetchedAt" >= payment."paidAt" - INTERVAL '7 days'
    ORDER BY candidate."fetchedAt" DESC
    LIMIT 1
  ) rate ON TRUE
)
UPDATE "ShopPayment" payment
SET
  "exchangeRateAtPayment" = payment_rates."rate",
  "amountUzsSnapshot" = CASE
    WHEN payment."currency" = 'UZS' THEN payment."amount"
    WHEN payment_rates."rate" IS NOT NULL THEN round(payment."amount" * payment_rates."rate", 2)
    ELSE NULL
  END,
  "amountUsdSnapshot" = CASE
    WHEN payment."currency" = 'USD' THEN payment."amount"
    WHEN payment_rates."rate" IS NOT NULL THEN round(payment."amount" / payment_rates."rate", 2)
    ELSE NULL
  END,
  "currencyReconstructionStatus" = CASE
    WHEN payment_rates."rate" IS NOT NULL THEN 'COMPLETE'::"AccountingReconstructionStatus"
    ELSE 'PARTIAL'::"AccountingReconstructionStatus"
  END
FROM payment_rates
WHERE payment."id" = payment_rates."id";

ALTER TABLE "ShopPayment"
  ADD CONSTRAINT "ShopPayment_currency_snapshot_check" CHECK (
    ("currency" = 'UZS' AND "amountUzsSnapshot" IS NOT NULL)
    OR
    ("currency" = 'USD' AND "amountUsdSnapshot" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "ShopPayment"
  VALIDATE CONSTRAINT "ShopPayment_currency_snapshot_check";

ALTER TABLE "ShopPayment"
  ADD CONSTRAINT "ShopPayment_package_allocation_check" CHECK (
    (
      "allocationStatus" = 'LEGACY_UNALLOCATED'
      AND "packageVersionId" IS NULL
      AND "currency" IS NOT NULL
      AND "packageMonthlyPriceSnapshot" IS NULL
      AND "servicePeriodStart" IS NULL
      AND "servicePeriodEnd" IS NULL
      AND "dueBefore" IS NULL
      AND "dueAfter" IS NULL
      AND "commandHash" IS NULL
    )
    OR
    (
      "allocationStatus" = 'PACKAGE_ALLOCATED'
      AND "packageVersionId" IS NOT NULL
      AND "currency" IS NOT NULL
      AND "packageMonthlyPriceSnapshot" IS NOT NULL
      AND "servicePeriodStart" IS NOT NULL
      AND "servicePeriodEnd" IS NOT NULL
      AND "dueBefore" IS NOT NULL
      AND "dueAfter" IS NOT NULL
      AND "commandHash" IS NOT NULL
      AND "packageMonthlyPriceSnapshot" >= 0
      AND "servicePeriodStart" < "servicePeriodEnd"
    )
  ) NOT VALID;

ALTER TABLE "ShopPayment"
  VALIDATE CONSTRAINT "ShopPayment_package_allocation_check";

-- The legacy permission definition and immutable WRITE_OFF events remain for
-- audit/history reads, but the permission can no longer be newly assigned.
UPDATE "PermissionDefinition"
SET "isActive" = FALSE, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'NASIYA_WRITE_OFF';

COMMIT;
