-- One Telegram chat may resolve to at most one live application actor.
-- Application prechecks provide friendly errors; these indexes + advisory-lock
-- triggers close the direct-write and concurrent cross-table race.

ALTER TABLE "SuperAdmin"
  ADD CONSTRAINT "SuperAdmin_telegramId_format_check"
  CHECK ("telegramId" IS NULL OR "telegramId" ~ '^[0-9]{5,20}$') NOT VALID;

ALTER TABLE "ShopAdmin"
  ADD CONSTRAINT "ShopAdmin_telegramId_format_check"
  CHECK ("telegramId" IS NULL OR "telegramId" ~ '^[0-9]{5,20}$') NOT VALID;

-- Refuse to claim completion if historic live identities are already
-- ambiguous. Production diagnostics must clear such rows deliberately first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SuperAdmin" sa
    JOIN "ShopAdmin" sha ON sha."telegramId" = sa."telegramId"
    WHERE sa."deletedAt" IS NULL
      AND sha."deletedAt" IS NULL
      AND sa."telegramId" ~ '^[0-9]{5,20}$'
  ) THEN
    RAISE EXCEPTION 'duplicate live Telegram identity exists across admin roles';
  END IF;
END $$;

CREATE UNIQUE INDEX "SuperAdmin_telegramId_live_key"
  ON "SuperAdmin"("telegramId")
  WHERE "deletedAt" IS NULL AND "telegramId" ~ '^[0-9]{5,20}$';

CREATE UNIQUE INDEX "ShopAdmin_telegramId_live_key"
  ON "ShopAdmin"("telegramId")
  WHERE "deletedAt" IS NULL AND "telegramId" ~ '^[0-9]{5,20}$';

CREATE OR REPLACE FUNCTION enforce_cross_role_telegram_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."telegramId" IS NOT NULL THEN
    NEW."telegramId" := btrim(NEW."telegramId");
    IF NEW."telegramId" = '' THEN
      NEW."telegramId" := NULL;
      NEW."telegramVerifiedAt" := NULL;
    ELSIF NEW."telegramId" !~ '^[0-9]{5,20}$' THEN
      RAISE EXCEPTION 'Telegram ID must contain 5 to 20 digits'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."telegramId" IS NULL OR NEW."deletedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Serializes SuperAdmin-vs-ShopAdmin claims for the same value. Same-table
  -- races are additionally protected by the partial unique indexes above.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."telegramId", 0));

  IF TG_TABLE_NAME = 'SuperAdmin' THEN
    IF EXISTS (
      SELECT 1 FROM "ShopAdmin"
      WHERE "telegramId" = NEW."telegramId" AND "deletedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'Telegram ID already belongs to another live actor'
        USING ERRCODE = '23505', CONSTRAINT = 'Telegram_identity_cross_role_key';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM "SuperAdmin"
    WHERE "telegramId" = NEW."telegramId" AND "deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Telegram ID already belongs to another live actor'
      USING ERRCODE = '23505', CONSTRAINT = 'Telegram_identity_cross_role_key';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SuperAdmin_telegram_identity_guard"
BEFORE INSERT OR UPDATE OF "telegramId", "deletedAt" ON "SuperAdmin"
FOR EACH ROW EXECUTE FUNCTION enforce_cross_role_telegram_identity();

CREATE TRIGGER "ShopAdmin_telegram_identity_guard"
BEFORE INSERT OR UPDATE OF "telegramId", "deletedAt" ON "ShopAdmin"
FOR EACH ROW EXECUTE FUNCTION enforce_cross_role_telegram_identity();
