-- Customer CRM passport privacy foundation. Historic rows remain untouched:
-- no identifier can be reconstructed safely from a passport image.

ALTER TABLE "Customer"
  ADD COLUMN "passportIdentifierCiphertext" TEXT,
  ADD COLUMN "passportIdentifierHash" TEXT,
  ADD COLUMN "passportIdentifierLast4" TEXT,
  ADD COLUMN "passportIdentifierKeyVersion" INTEGER;

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_passport_identifier_bundle_check"
  CHECK (
    ("passportIdentifierCiphertext" IS NULL
      AND "passportIdentifierHash" IS NULL
      AND "passportIdentifierLast4" IS NULL
      AND "passportIdentifierKeyVersion" IS NULL)
    OR
    ("passportIdentifierCiphertext" IS NOT NULL
      AND "passportIdentifierHash" IS NOT NULL
      AND "passportIdentifierLast4" ~ '^[A-Z0-9]{4}$'
      AND "passportIdentifierKeyVersion" = 1)
  );

-- Exact, active-customer collision protection inside one tenant. The HMAC is
-- secret scoped, so this index stores no reversible passport identifier.
CREATE UNIQUE INDEX "Customer_shopId_passportIdentifierHash_active_key"
  ON "Customer"("shopId", "passportIdentifierHash")
  WHERE "deletedAt" IS NULL AND "passportIdentifierHash" IS NOT NULL;

CREATE INDEX "Customer_shopId_passportIdentifierHash_idx"
  ON "Customer"("shopId", "passportIdentifierHash");

INSERT INTO "PermissionDefinition"
  ("code", "nameUz", "descriptionUz", "featureCode", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  ('CUSTOMER_PII_REVEAL', 'Pasport raqamini to''liq ko''rish',
   'Maskalangan pasport raqamini vaqtincha ochish; har bir amal auditga yoziladi',
   'CUSTOMER_CRM', 75, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "nameUz" = EXCLUDED."nameUz",
  "descriptionUz" = EXCLUDED."descriptionUz",
  "featureCode" = EXCLUDED."featureCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;
