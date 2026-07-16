-- Stage 1: additive payment receipt provenance.
--
-- This migration is deliberately safe to run before the ledger repair. It
-- adds the information needed for a same-currency USD receipt to say that no
-- FX quote was required, rather than inventing a current or creation rate.
-- New receipts retain a provider + effective/fetched timestamps; historical
-- rates are labelled RECORDED_FROZEN rather than fabricated as CBU quotes.
-- It does *not* install the cross-table ledger trigger; that is stage 2 and
-- is blocked until the dry-run audit is reviewed and repaired.

ALTER TABLE "NasiyaPayment"
  ADD COLUMN IF NOT EXISTS "paymentExchangeRateSource" TEXT;

ALTER TABLE "NasiyaPayment"
  ADD COLUMN IF NOT EXISTS "paymentExchangeRateEffectiveAt" TIMESTAMP(3);

ALTER TABLE "NasiyaPayment"
  ADD COLUMN IF NOT EXISTS "paymentExchangeRateFetchedAt" TIMESTAMP(3);

UPDATE "NasiyaPayment"
SET "paymentExchangeRateSource" = 'RECORDED_FROZEN'
WHERE "paymentExchangeRate" IS NOT NULL
  AND "paymentExchangeRateSource" IS NULL;

-- The original check treated a missing USD quote as an invalid receipt even
-- where both the contract and payment are USD. Native debt can be settled
-- without FX; only the non-authoritative legacy UZS snapshot may use the
-- contract-creation fallback in that exceptional case.
ALTER TABLE "NasiyaPayment"
  DROP CONSTRAINT IF EXISTS "NasiyaPayment_input_snapshot_check";

ALTER TABLE "NasiyaPayment"
  ADD CONSTRAINT "NasiyaPayment_input_snapshot_check"
  CHECK (
    ("paymentInputAmount" IS NULL AND "paymentInputCurrency" IS NULL AND "paymentExchangeRate" IS NULL)
    OR (
      "paymentInputAmount" > 0
      AND "paymentInputCurrency" IS NOT NULL
      AND (
        ("paymentInputCurrency" = 'UZS'
          AND trunc("paymentInputAmount") = "paymentInputAmount"
          AND ("paymentExchangeRate" IS NULL OR "paymentExchangeRate" BETWEEN 1000 AND 100000))
        OR
        ("paymentInputCurrency" = 'USD'
          AND (
            "paymentExchangeRate" BETWEEN 1000 AND 100000
            OR ("paymentExchangeRate" IS NULL AND "paymentExchangeRateSource" = 'UNAVAILABLE_SAME_CURRENCY')
          ))
      )
    )
  ) NOT VALID;

ALTER TABLE "NasiyaPayment"
  ADD CONSTRAINT "NasiyaPayment_exchange_rate_source_check"
  CHECK (
    "paymentExchangeRateSource" IS NULL
    OR "paymentExchangeRateSource" IN ('CBU', 'MANUAL', 'RECORDED_FROZEN', 'UNAVAILABLE_SAME_CURRENCY')
  ) NOT VALID;
