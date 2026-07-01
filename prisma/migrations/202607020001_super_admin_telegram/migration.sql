ALTER TABLE "SuperAdmin"
ADD COLUMN "telegramId" TEXT,
ADD COLUMN "telegramVerifiedAt" TIMESTAMP(3);

CREATE INDEX "SuperAdmin_telegramId_idx" ON "SuperAdmin"("telegramId");
CREATE INDEX "ShopAdmin_telegramId_idx" ON "ShopAdmin"("telegramId");
