-- One database-maintained search document keeps primary and additional phone
-- values in the same contiguous-substring contract without relying on exact
-- PostgreSQL array membership. Pipes prevent a digit needle from matching
-- across the boundary between two different phone numbers.

ALTER TABLE "Customer"
  ADD COLUMN "phoneSearchDigits" TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION "customer_phone_search_digits"(
  primary_phone TEXT,
  additional_phones TEXT[]
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN ''
    ELSE '|' || string_agg(digits, '|' ORDER BY position) || '|'
  END
  FROM (
    SELECT
      0::BIGINT AS position,
      NULLIF(regexp_replace(COALESCE(primary_phone, ''), '[^0-9]', '', 'g'), '') AS digits
    UNION ALL
    SELECT
      extra.ordinality::BIGINT AS position,
      NULLIF(regexp_replace(COALESCE(extra.phone, ''), '[^0-9]', '', 'g'), '') AS digits
    FROM unnest(COALESCE(additional_phones, ARRAY[]::TEXT[]))
      WITH ORDINALITY AS extra(phone, ordinality)
  ) normalized
  WHERE digits IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION "sync_customer_phone_search_digits"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."phoneSearchDigits" := "customer_phone_search_digits"(
    NEW."phone",
    NEW."additionalPhones"
  );
  RETURN NEW;
END;
$$;

UPDATE "Customer"
SET "phoneSearchDigits" = "customer_phone_search_digits"(
  "phone",
  "additionalPhones"
);

DROP TRIGGER IF EXISTS "Customer_sync_phone_search_digits" ON "Customer";
CREATE TRIGGER "Customer_sync_phone_search_digits"
BEFORE INSERT OR UPDATE ON "Customer"
FOR EACH ROW
EXECUTE FUNCTION "sync_customer_phone_search_digits"();

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Customer_phoneSearchDigits_trgm_active_idx"
ON "Customer" USING gin ("phoneSearchDigits" gin_trgm_ops)
WHERE "deletedAt" IS NULL;

-- Separator-insensitive IMEI lookup uses normalizedValue. The existing B-tree
-- remains useful for exact uniqueness; this additive trigram index serves the
-- leading-wildcard contains path.
CREATE INDEX "DeviceImei_normalizedValue_trgm_active_idx"
ON "DeviceImei" USING gin ("normalizedValue" gin_trgm_ops)
WHERE "deletedAt" IS NULL AND "normalizedValue" IS NOT NULL;
