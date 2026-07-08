-- Native contract-currency ledger for Nasiya — additive only, no drops/renames.
-- creationCurrency/creationExchangeRate (added earlier) are untouched and
-- keep being written by the creation routes for back-compat; these new
-- contract* fields become the source of truth for debt/schedule/allocation
-- math going forward. Legacy UZS fields (totalAmount, finalNasiyaAmount,
-- remainingAmount, monthlyPayment, schedule expectedAmount/paidAmount) stay
-- exactly as they are — a compatibility snapshot every existing
-- report/profit/Telegram-creation-message call site keeps reading unchanged.
-- See docs/currency-accounting-model.md.

ALTER TABLE "Nasiya"
  ADD COLUMN "contractCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  ADD COLUMN "contractExchangeRateAtCreation" DECIMAL(12,4),
  ADD COLUMN "contractTotalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractDownPayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractBaseRemainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractInterestAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractFinalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractMonthlyPayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractRemainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: every existing row is implicitly UZS-native (contractCurrency
-- already defaulted to 'UZS' above) — copy the legacy UZS ledger 1:1 into
-- the new contract fields. Never invents a historical currency or rate.
UPDATE "Nasiya" SET
  "contractTotalAmount" = "totalAmount",
  "contractDownPayment" = "downPayment",
  "contractBaseRemainingAmount" = "baseRemainingAmount",
  "contractInterestAmount" = "interestAmount",
  "contractFinalAmount" = "finalNasiyaAmount",
  "contractMonthlyPayment" = "monthlyPayment",
  "contractRemainingAmount" = "remainingAmount",
  "contractPaidAmount" = "finalNasiyaAmount" - "remainingAmount";

ALTER TABLE "NasiyaSchedule"
  ADD COLUMN "contractCurrency" "CurrencyCode" NOT NULL DEFAULT 'UZS',
  ADD COLUMN "contractExpectedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractPaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "contractRemainingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "NasiyaSchedule" SET
  "contractExpectedAmount" = "expectedAmount",
  "contractPaidAmount" = "paidAmount",
  "contractRemainingAmount" = GREATEST("expectedAmount" - "paidAmount", 0);

ALTER TABLE "NasiyaPayment"
  ADD COLUMN "appliedAmountInContractCurrency" DECIMAL(12,2);

-- Existing payments predate contract-currency tracking. Every pre-existing
-- nasiya is backfilled to contractCurrency='UZS' above, so the already-stored
-- UZS `amount` IS the applied-in-contract-currency figure for these rows.
UPDATE "NasiyaPayment" SET "appliedAmountInContractCurrency" = "amount"
WHERE "appliedAmountInContractCurrency" IS NULL;
