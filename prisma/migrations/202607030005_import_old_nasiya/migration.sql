-- Manual import of existing (pre-Oryx) nasiyas.
-- Imported nasiya = existing debt carried over, NOT a new sale. New columns are
-- informational and kept out of current-period gross/income/profit in code.
-- All additive + defaulted, so existing rows are unaffected (isImported=false).
-- Apply with `npm run prisma:migrate:deploy`.

-- Device
ALTER TABLE "Device" ADD COLUMN "isImported" BOOLEAN NOT NULL DEFAULT false;

-- Nasiya
ALTER TABLE "Nasiya" ADD COLUMN "isImported" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Nasiya" ADD COLUMN "importSource" TEXT;
ALTER TABLE "Nasiya" ADD COLUMN "importedAt" TIMESTAMP(3);
ALTER TABLE "Nasiya" ADD COLUMN "importedById" TEXT;
ALTER TABLE "Nasiya" ADD COLUMN "originalSaleDate" TIMESTAMP(3);
ALTER TABLE "Nasiya" ADD COLUMN "originalTotalAmount" DECIMAL(12,2);
ALTER TABLE "Nasiya" ADD COLUMN "alreadyPaidBeforeImport" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Nasiya" ADD COLUMN "remainingAtImport" DECIMAL(12,2);
ALTER TABLE "Nasiya" ADD COLUMN "importNote" TEXT;

-- Index to keep imported nasiyas cheap to filter out of stats.
CREATE INDEX "Nasiya_shopId_isImported_idx" ON "Nasiya"("shopId", "isImported");
