-- Retire the unused device-reservation status. Preserve existing devices by
-- treating any legacy reservation as normal inventory before removing the
-- enum value.

UPDATE "Device"
SET "status" = 'IN_STOCK'::"DeviceStatus"
WHERE "status" = 'RESERVED'::"DeviceStatus";

ALTER TYPE "DeviceStatus" RENAME TO "DeviceStatus_old";

CREATE TYPE "DeviceStatus" AS ENUM ('IN_STOCK', 'SOLD_CASH', 'SOLD_NASIYA', 'RETURNED', 'DELETED');

ALTER TABLE "Device"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DeviceStatus" USING ("status"::text::"DeviceStatus"),
  ALTER COLUMN "status" SET DEFAULT 'IN_STOCK'::"DeviceStatus";

DROP TYPE "DeviceStatus_old";
