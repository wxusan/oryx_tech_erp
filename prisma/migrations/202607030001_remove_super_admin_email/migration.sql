ALTER TABLE "SuperAdmin"
DROP CONSTRAINT IF EXISTS "SuperAdmin_email_key";

DROP INDEX IF EXISTS "SuperAdmin_email_key";

WITH duplicate_admins AS (
  SELECT
    old_admin.id AS old_id,
    target_admin.id AS target_id,
    old_admin."telegramId" AS old_telegram_id,
    old_admin."telegramVerifiedAt" AS old_telegram_verified_at
  FROM "SuperAdmin" old_admin
  JOIN "SuperAdmin" target_admin
    ON target_admin.login = lower(regexp_replace(coalesce(old_admin.email, old_admin.id), '[^a-zA-Z0-9_]+', '_', 'g'))
  WHERE old_admin.login IS NULL
    AND old_admin.id <> target_admin.id
)
UPDATE "Shop" shop
SET "createdById" = duplicate_admins.target_id
FROM duplicate_admins
WHERE shop."createdById" = duplicate_admins.old_id;

WITH duplicate_admins AS (
  SELECT
    old_admin.id AS old_id,
    target_admin.id AS target_id,
    old_admin."telegramId" AS old_telegram_id,
    old_admin."telegramVerifiedAt" AS old_telegram_verified_at
  FROM "SuperAdmin" old_admin
  JOIN "SuperAdmin" target_admin
    ON target_admin.login = lower(regexp_replace(coalesce(old_admin.email, old_admin.id), '[^a-zA-Z0-9_]+', '_', 'g'))
  WHERE old_admin.login IS NULL
    AND old_admin.id <> target_admin.id
)
UPDATE "ShopPayment" payment
SET "recordedById" = duplicate_admins.target_id
FROM duplicate_admins
WHERE payment."recordedById" = duplicate_admins.old_id;

WITH duplicate_admins AS (
  SELECT
    old_admin.id AS old_id,
    target_admin.id AS target_id,
    old_admin."telegramId" AS old_telegram_id,
    old_admin."telegramVerifiedAt" AS old_telegram_verified_at
  FROM "SuperAdmin" old_admin
  JOIN "SuperAdmin" target_admin
    ON target_admin.login = lower(regexp_replace(coalesce(old_admin.email, old_admin.id), '[^a-zA-Z0-9_]+', '_', 'g'))
  WHERE old_admin.login IS NULL
    AND old_admin.id <> target_admin.id
)
UPDATE "Log" log
SET "actorId" = duplicate_admins.target_id
FROM duplicate_admins
WHERE log."actorType" = 'SUPER_ADMIN'
  AND log."actorId" = duplicate_admins.old_id;

WITH duplicate_admins AS (
  SELECT
    old_admin.id AS old_id,
    target_admin.id AS target_id,
    old_admin."telegramId" AS old_telegram_id,
    old_admin."telegramVerifiedAt" AS old_telegram_verified_at
  FROM "SuperAdmin" old_admin
  JOIN "SuperAdmin" target_admin
    ON target_admin.login = lower(regexp_replace(coalesce(old_admin.email, old_admin.id), '[^a-zA-Z0-9_]+', '_', 'g'))
  WHERE old_admin.login IS NULL
    AND old_admin.id <> target_admin.id
)
UPDATE "SuperAdmin" target_admin
SET
  "telegramId" = coalesce(target_admin."telegramId", duplicate_admins.old_telegram_id),
  "telegramVerifiedAt" = coalesce(target_admin."telegramVerifiedAt", duplicate_admins.old_telegram_verified_at),
  "updatedAt" = now()
FROM duplicate_admins
WHERE target_admin.id = duplicate_admins.target_id;

WITH duplicate_admins AS (
  SELECT old_admin.id AS old_id
  FROM "SuperAdmin" old_admin
  JOIN "SuperAdmin" target_admin
    ON target_admin.login = lower(regexp_replace(coalesce(old_admin.email, old_admin.id), '[^a-zA-Z0-9_]+', '_', 'g'))
  WHERE old_admin.login IS NULL
    AND old_admin.id <> target_admin.id
)
DELETE FROM "SuperAdmin" admin
USING duplicate_admins
WHERE admin.id = duplicate_admins.old_id;

UPDATE "SuperAdmin"
SET "login" = lower(regexp_replace(coalesce("email", id), '[^a-zA-Z0-9_]+', '_', 'g'))
WHERE "login" IS NULL;

ALTER TABLE "SuperAdmin"
ALTER COLUMN "login" SET NOT NULL,
DROP COLUMN "email";
