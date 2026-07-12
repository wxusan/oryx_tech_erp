CREATE TYPE "StorageUnit" AS ENUM ('GB', 'TB');
CREATE TYPE "DeviceConditionCode" AS ENUM ('NEW', 'USED');
CREATE TYPE "DeviceImeiSlot" AS ENUM ('PRIMARY', 'SECONDARY');

ALTER TABLE "Device"
  ADD COLUMN "storageAmount" DECIMAL(10,2),
  ADD COLUMN "storageUnit" "StorageUnit",
  ADD COLUMN "conditionCode" "DeviceConditionCode";

ALTER TABLE "Device" ADD CONSTRAINT "Device_storage_pair_check"
  CHECK (("storageAmount" IS NULL AND "storageUnit" IS NULL) OR
         ("storageAmount" > 0 AND "storageUnit" IS NOT NULL));

UPDATE "Device"
SET "storageAmount" = (regexp_match(upper(trim("storage")), '^([0-9]+(?:\.[0-9]+)?)\s*(GB|TB)$'))[1]::DECIMAL,
    "storageUnit" = ((regexp_match(upper(trim("storage")), '^([0-9]+(?:\.[0-9]+)?)\s*(GB|TB)$'))[2])::"StorageUnit"
WHERE "storage" IS NOT NULL
  AND upper(trim("storage")) ~ '^[0-9]+(?:\.[0-9]+)?\s*(GB|TB)$';

UPDATE "Device" SET "conditionCode" = 'NEW'
WHERE lower(trim("condition")) = lower('Yangi');
UPDATE "Device" SET "conditionCode" = 'USED'
WHERE upper(trim("condition")) = 'B/U';

CREATE UNIQUE INDEX "Device_id_shopId_key" ON "Device"("id", "shopId");

CREATE TABLE "DeviceImei" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "slot" "DeviceImeiSlot" NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT,
  "isLegacy" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceImei_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceImei_deviceId_shopId_fkey" FOREIGN KEY ("deviceId", "shopId")
    REFERENCES "Device"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Preserve every non-placeholder legacy IMEI. Only 15-digit values receive a
-- protected normalized key; deterministic first-owner ranking avoids a failed
-- migration when old formatting variants collide.
WITH candidates AS (
  SELECT d."id", d."shopId", d."imei", d."createdAt",
         regexp_replace(d."imei", '[^0-9]', '', 'g') AS normalized,
         row_number() OVER (
           PARTITION BY d."shopId", regexp_replace(d."imei", '[^0-9]', '', 'g')
           ORDER BY d."createdAt", d."id"
         ) AS owner_rank
  FROM "Device" d
  WHERE d."imei" NOT LIKE 'IMPORT-%' AND d."imei" NOT LIKE 'NOIMEI-%'
)
INSERT INTO "DeviceImei" ("id", "shopId", "deviceId", "slot", "value", "normalizedValue", "isLegacy", "createdAt", "updatedAt", "deletedAt")
SELECT 'legacy-' || "id", "shopId", "id", 'PRIMARY', "imei",
       CASE WHEN length(normalized) = 15 AND owner_rank = 1 THEN normalized ELSE NULL END,
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       (SELECT d."deletedAt" FROM "Device" d WHERE d."id" = candidates."id")
FROM candidates;

CREATE INDEX "DeviceImei_deviceId_slot_idx" ON "DeviceImei"("deviceId", "slot");
CREATE INDEX "DeviceImei_shopId_normalizedValue_idx" ON "DeviceImei"("shopId", "normalizedValue");
CREATE UNIQUE INDEX "DeviceImei_deviceId_slot_active_key"
  ON "DeviceImei"("deviceId", "slot") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "DeviceImei_shopId_normalizedValue_active_key"
  ON "DeviceImei"("shopId", "normalizedValue")
  WHERE "deletedAt" IS NULL AND "normalizedValue" IS NOT NULL;

CREATE OR REPLACE FUNCTION soft_delete_device_imeis() RETURNS trigger AS $$
BEGIN
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
    UPDATE "DeviceImei" SET "deletedAt" = NEW."deletedAt", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "deviceId" = NEW."id" AND "deletedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Device_soft_delete_imeis"
AFTER UPDATE OF "deletedAt" ON "Device"
FOR EACH ROW EXECUTE FUNCTION soft_delete_device_imeis();
