ALTER TABLE "SuperAdmin"
DROP CONSTRAINT IF EXISTS "SuperAdmin_email_key";

DROP INDEX IF EXISTS "SuperAdmin_email_key";

UPDATE "SuperAdmin"
SET "login" = lower(regexp_replace(coalesce("email", id), '[^a-zA-Z0-9_]+', '_', 'g'))
WHERE "login" IS NULL;

ALTER TABLE "SuperAdmin"
ALTER COLUMN "login" SET NOT NULL,
DROP COLUMN "email";
