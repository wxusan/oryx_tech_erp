-- Native purchase-currency context for Device — additive only, no drops or
-- renames. Device.purchasePrice stays exactly as-is (UZS compatibility
-- snapshot, dual-written in lockstep going forward). See
-- docs/currency-accounting-model.md.

ALTER TABLE "Device"
  ADD COLUMN "purchaseCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  ADD COLUMN "purchaseInputAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "purchaseExchangeRateAtCreation" DECIMAL(12,4),
  ADD COLUMN "purchaseAmountUzsSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: every existing row is implicitly UZS-native — copy the legacy
-- purchasePrice 1:1 into the new purchase-currency fields. Never invents a
-- historical currency or rate.
UPDATE "Device" SET
  "purchaseInputAmount" = "purchasePrice",
  "purchaseAmountUzsSnapshot" = "purchasePrice";
