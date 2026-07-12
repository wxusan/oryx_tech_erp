-- Ensure every future valid IMEI row is normalized by PostgreSQL itself, so
-- direct SQL/import paths cannot bypass cross-slot uniqueness with NULL.
CREATE OR REPLACE FUNCTION "normalize_device_imei_value"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := regexp_replace(COALESCE(NEW."value", ''), '[[:space:]-]', '', 'g');
  IF normalized ~ '^[0-9]{15}$' THEN
    NEW."normalizedValue" := normalized;
  ELSE
    NEW."normalizedValue" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Repair ownership deterministically with ACTIVE rows first. Historic active
-- collisions remain reviewable: the oldest active row owns the normalized key;
-- later colliding legacy rows stay NULL, while the trigger prevents any new
-- valid NULL bypass.
WITH ranked AS (
  SELECT
    "id",
    regexp_replace("value", '[[:space:]-]', '', 'g') AS normalized,
    ROW_NUMBER() OVER (
      PARTITION BY "shopId", regexp_replace("value", '[[:space:]-]', '', 'g')
      ORDER BY ("deletedAt" IS NULL) DESC, "createdAt", "id"
    ) AS rank
  FROM "DeviceImei"
  WHERE regexp_replace("value", '[[:space:]-]', '', 'g') ~ '^[0-9]{15}$'
)
UPDATE "DeviceImei" AS imei
SET "normalizedValue" = CASE WHEN ranked.rank = 1 THEN ranked.normalized ELSE NULL END
FROM ranked
WHERE imei."id" = ranked."id";

DROP TRIGGER IF EXISTS "DeviceImei_normalize_value" ON "DeviceImei";
CREATE TRIGGER "DeviceImei_normalize_value"
BEFORE INSERT OR UPDATE OF "value", "normalizedValue", "deletedAt"
ON "DeviceImei"
FOR EACH ROW
EXECUTE FUNCTION "normalize_device_imei_value"();

-- Substring search by either IMEI uses contains/ILIKE; a B-tree cannot serve
-- that access pattern. pg_trgm already exists from the search migration.
CREATE INDEX IF NOT EXISTS "DeviceImei_value_trgm_active_idx"
ON "DeviceImei" USING gin ("value" gin_trgm_ops)
WHERE "deletedAt" IS NULL;
