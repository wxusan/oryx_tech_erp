ALTER TABLE "Customer" ADD COLUMN "phoneNormalizationNeedsReview" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "Customer_shopId_normalizedPhone_active_key";

WITH canonical AS (
  SELECT "id", "shopId", "createdAt",
    CASE
      WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^998[0-9]{9}$'
        THEN regexp_replace("phone", '[^0-9]', '', 'g')
      WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
        THEN '998' || regexp_replace("phone", '[^0-9]', '', 'g')
      WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^8[0-9]{9}$'
        THEN '998' || substring(regexp_replace("phone", '[^0-9]', '', 'g') from 2)
      ELSE NULL
    END AS normalized
  FROM "Customer"
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY "shopId", normalized ORDER BY "createdAt", "id") AS owner_rank
  FROM canonical
)
UPDATE "Customer" customer
SET "normalizedPhone" = CASE WHEN ranked.owner_rank = 1 THEN ranked.normalized ELSE NULL END,
    "phoneNormalizationNeedsReview" = ranked.normalized IS NULL OR ranked.owner_rank > 1
FROM ranked
WHERE customer."id" = ranked."id";

CREATE UNIQUE INDEX "Customer_shopId_normalizedPhone_active_key"
  ON "Customer"("shopId", "normalizedPhone")
  WHERE "deletedAt" IS NULL AND "normalizedPhone" IS NOT NULL;
