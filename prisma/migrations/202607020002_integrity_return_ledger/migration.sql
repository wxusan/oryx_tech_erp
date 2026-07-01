-- Active devices may reuse an IMEI after a soft delete, but two active rows in
-- the same shop must never share the same IMEI.
DROP INDEX IF EXISTS "Device_shopId_imei_key";
CREATE UNIQUE INDEX "Device_shopId_imei_active_key"
  ON "Device"("shopId", "imei")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Device_shopId_imei_idx"
  ON "Device"("shopId", "imei");

-- Customer phone matching must be based on digits, not display formatting.
ALTER TABLE "Customer" ADD COLUMN "normalizedPhone" TEXT;

UPDATE "Customer"
SET "normalizedPhone" = NULLIF(regexp_replace("phone", '\D', '', 'g'), '');

-- If historical active duplicates already exist, keep the first one protected
-- by the unique index and leave later duplicates nullable for manual cleanup.
WITH ranked_customers AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "shopId", "normalizedPhone"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS row_number
  FROM "Customer"
  WHERE "deletedAt" IS NULL
    AND "normalizedPhone" IS NOT NULL
)
UPDATE "Customer" AS customer
SET "normalizedPhone" = NULL
FROM ranked_customers
WHERE customer."id" = ranked_customers."id"
  AND ranked_customers.row_number > 1;

CREATE UNIQUE INDEX "Customer_shopId_normalizedPhone_active_key"
  ON "Customer"("shopId", "normalizedPhone")
  WHERE "deletedAt" IS NULL
    AND "normalizedPhone" IS NOT NULL;

CREATE INDEX "Customer_shopId_normalizedPhone_idx"
  ON "Customer"("shopId", "normalizedPhone");

-- Return accounting ledger. Returns/cancellations stay visible with refund
-- amount, method, note, actor, and links to the original sale/nasiya.
CREATE TABLE "DeviceReturn" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "saleId" TEXT,
  "nasiyaId" TEXT,
  "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "refundMethod" "PaymentMethod",
  "note" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeviceReturn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceReturn_shopId_idx" ON "DeviceReturn"("shopId");
CREATE INDEX "DeviceReturn_deviceId_idx" ON "DeviceReturn"("deviceId");
CREATE INDEX "DeviceReturn_saleId_idx" ON "DeviceReturn"("saleId");
CREATE INDEX "DeviceReturn_nasiyaId_idx" ON "DeviceReturn"("nasiyaId");
CREATE INDEX "DeviceReturn_createdAt_idx" ON "DeviceReturn"("createdAt");

ALTER TABLE "DeviceReturn"
  ADD CONSTRAINT "DeviceReturn_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceReturn"
  ADD CONSTRAINT "DeviceReturn_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceReturn"
  ADD CONSTRAINT "DeviceReturn_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceReturn"
  ADD CONSTRAINT "DeviceReturn_nasiyaId_fkey"
  FOREIGN KEY ("nasiyaId") REFERENCES "Nasiya"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
