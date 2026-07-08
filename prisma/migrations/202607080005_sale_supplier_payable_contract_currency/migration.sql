-- Native contract-currency ledger for Sale and SupplierPayable — additive
-- only, no drops/renames. Sale.creationCurrency/creationExchangeRate (added
-- earlier) are untouched. Minimal, schema-only pass for these two models
-- (no schedule/allocation like Nasiya) — see docs/currency-accounting-model.md.

ALTER TABLE "Sale"
  ADD COLUMN "contractCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  ADD COLUMN "contractExchangeRateAtCreation" DECIMAL(12,4),
  ADD COLUMN "contractSalePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractAmountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractRemainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: every existing row is implicitly UZS-native — copy the legacy
-- UZS ledger 1:1 into the new contract fields. Never invents a historical
-- currency or rate.
UPDATE "Sale" SET
  "contractSalePrice" = "salePrice",
  "contractAmountPaid" = "amountPaid",
  "contractRemainingAmount" = "remainingAmount";

ALTER TABLE "SalePayment"
  ADD COLUMN "appliedAmountInContractCurrency" DECIMAL(12,2);

UPDATE "SalePayment" SET "appliedAmountInContractCurrency" = "amount"
WHERE "appliedAmountInContractCurrency" IS NULL;

ALTER TABLE "SupplierPayable"
  ADD COLUMN "contractCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  ADD COLUMN "contractExchangeRateAtCreation" DECIMAL(12,4),
  ADD COLUMN "contractAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "SupplierPayable" SET "contractAmount" = "amount";
