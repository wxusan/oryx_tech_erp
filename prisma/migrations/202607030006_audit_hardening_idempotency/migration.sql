-- Add durable idempotency for subscription payments and nasiya deferrals.

ALTER TABLE "ShopPayment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ShopPayment_shopId_idempotencyKey_key"
ON "ShopPayment"("shopId", "idempotencyKey");

CREATE TABLE "NasiyaDeferral" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "nasiyaId" TEXT NOT NULL,
  "nasiyaScheduleId" TEXT NOT NULL,
  "delayedUntil" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NasiyaDeferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NasiyaDeferral_shopId_idempotencyKey_key"
ON "NasiyaDeferral"("shopId", "idempotencyKey");

CREATE INDEX "NasiyaDeferral_nasiyaId_idx" ON "NasiyaDeferral"("nasiyaId");
CREATE INDEX "NasiyaDeferral_nasiyaScheduleId_idx" ON "NasiyaDeferral"("nasiyaScheduleId");
CREATE INDEX "NasiyaDeferral_shopId_idx" ON "NasiyaDeferral"("shopId");
