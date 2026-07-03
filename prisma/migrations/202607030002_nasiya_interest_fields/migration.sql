-- Store nasiya interest separately from the original device sale price.
-- Existing records keep their old meaning:
--   totalAmount = original device sale price
--   baseRemainingAmount/finalNasiyaAmount = old debt after down payment
--   interestPercent/interestAmount = 0

ALTER TABLE "Nasiya"
  ADD COLUMN "baseRemainingAmount" DECIMAL(12,2),
  ADD COLUMN "interestPercent" DECIMAL(6,2),
  ADD COLUMN "interestAmount" DECIMAL(12,2),
  ADD COLUMN "finalNasiyaAmount" DECIMAL(12,2);

UPDATE "Nasiya"
SET
  "baseRemainingAmount" = GREATEST("totalAmount" - "downPayment", 0::numeric),
  "interestPercent" = 0,
  "interestAmount" = 0,
  "finalNasiyaAmount" = GREATEST("totalAmount" - "downPayment", 0::numeric)
WHERE
  "baseRemainingAmount" IS NULL
  OR "interestPercent" IS NULL
  OR "interestAmount" IS NULL
  OR "finalNasiyaAmount" IS NULL;

ALTER TABLE "Nasiya"
  ALTER COLUMN "baseRemainingAmount" SET NOT NULL,
  ALTER COLUMN "baseRemainingAmount" SET DEFAULT 0,
  ALTER COLUMN "interestPercent" SET NOT NULL,
  ALTER COLUMN "interestPercent" SET DEFAULT 0,
  ALTER COLUMN "interestAmount" SET NOT NULL,
  ALTER COLUMN "interestAmount" SET DEFAULT 0,
  ALTER COLUMN "finalNasiyaAmount" SET NOT NULL,
  ALTER COLUMN "finalNasiyaAmount" SET DEFAULT 0;

ALTER TABLE "Nasiya" DROP COLUMN "appleIdNote";
